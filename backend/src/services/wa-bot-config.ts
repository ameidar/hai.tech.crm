// WhatsApp bot configuration (system prompt + knowledge base) — single in-memory source of
// truth shared by the WhatsApp bot (routes/whatsapp.ts), the internal admin endpoint
// (/api/wa/bot-config) and the v1 ops API (/api/v1/bot-config).
//
// Load order (unchanged from the original routes/whatsapp.ts implementation):
//   1. files in src/data (wa_system_prompt.md, wa_knowledge_base.json) — always, as fallback
//   2. bot_config table rows override at startup
// What's new: the KB load is *tracked*. Previously a DB knowledge_base that wasn't valid
// JSON was swallowed by an empty catch and the bot silently kept answering from the old
// file KB. getBotConfigStatus() now reports exactly which source is live and why.

import * as fs from 'fs';
import * as path from 'path';
import crypto from 'crypto';
import type { Request } from 'express';
import { prisma } from '../utils/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { logAudit } from '../utils/audit.js';
import { actorLabel } from '../utils/request-actor.js';

export type BotConfigSource = 'file' | 'db' | 'none';

interface KnowledgeBaseLoadStatus {
  /** Where the raw text shown to admins came from. */
  rawSource: BotConfigSource;
  /** Where the parsed object the bot actually uses came from. */
  effectiveSource: BotConfigSource;
  /** Did the raw text parse as a JSON object? false = the bot is NOT using the raw text. */
  parsed: boolean;
  parseError: string | null;
}

interface BotConfigState {
  systemPrompt: string;
  systemPromptSource: BotConfigSource;
  knowledgeBase: Record<string, any>;
  knowledgeBaseRaw: string;
  kb: KnowledgeBaseLoadStatus;
  dbLoadedAt: Date | null;
  dbLoadError: string | null;
  lastUpdatedAt: Date | null;
  lastUpdatedBy: string | null;
}

const DATA_DIR = path.join(__dirname, '../data');

const state: BotConfigState = {
  systemPrompt: '',
  systemPromptSource: 'none',
  knowledgeBase: {},
  knowledgeBaseRaw: '{}',
  kb: { rawSource: 'none', effectiveSource: 'none', parsed: false, parseError: null },
  dbLoadedAt: null,
  dbLoadError: null,
  lastUpdatedAt: null,
  lastUpdatedBy: null,
};

/**
 * Parse a knowledge-base string. The bot dereferences fields like `knowledgeBase.courses`,
 * so only a JSON object is acceptable (not an array / string / number).
 */
export function parseKnowledgeBase(raw: string): { ok: true; value: Record<string, any> } | { ok: false; error: string } {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'Knowledge base must be a JSON object' };
  }
  return { ok: true, value: value as Record<string, any> };
}

// 1. Files (sync, always as fallback)
export function loadBotConfigFromFiles(dataDir: string = DATA_DIR) {
  try {
    state.systemPrompt = fs.readFileSync(path.join(dataDir, 'wa_system_prompt.md'), 'utf8');
    state.systemPromptSource = 'file';
    const raw = fs.readFileSync(path.join(dataDir, 'wa_knowledge_base.json'), 'utf8');
    state.knowledgeBaseRaw = raw;
    const parsed = parseKnowledgeBase(raw);
    if (parsed.ok) {
      state.knowledgeBase = parsed.value;
      state.kb = { rawSource: 'file', effectiveSource: 'file', parsed: true, parseError: null };
    } else {
      state.kb = { rawSource: 'file', effectiveSource: 'none', parsed: false, parseError: parsed.error };
    }
    console.log('[WA] System prompt and knowledge base loaded from files');
  } catch (e) {
    console.warn('[WA] Could not load system prompt / knowledge base from files:', e);
  }
}

// 2. DB overrides (admin-saved values)
export async function initBotConfigFromDB() {
  try {
    const rows = await prisma.$queryRaw<{ key: string; value: string }[]>`
      SELECT key, value FROM bot_config WHERE key IN ('system_prompt', 'knowledge_base')
    `;
    for (const row of rows) {
      if (row.key === 'system_prompt') {
        state.systemPrompt = row.value;
        state.systemPromptSource = 'db';
        console.log('[WA] System prompt loaded from DB');
      }
      if (row.key === 'knowledge_base') {
        // Keep the DB text as the editable raw value (so an admin sees — and can fix —
        // what is stored), but only switch the live KB if it actually parses.
        state.knowledgeBaseRaw = row.value;
        const parsed = parseKnowledgeBase(row.value);
        if (parsed.ok) {
          state.knowledgeBase = parsed.value;
          state.kb = { rawSource: 'db', effectiveSource: 'db', parsed: true, parseError: null };
          console.log('[WA] Knowledge base loaded from DB');
        } else {
          state.kb = { rawSource: 'db', effectiveSource: state.kb.effectiveSource, parsed: false, parseError: parsed.error };
          console.error(
            `[WA] Knowledge base in DB is NOT valid JSON (${parsed.error}) — bot keeps using the ${state.kb.effectiveSource} knowledge base`,
          );
        }
      }
    }
    state.dbLoadedAt = new Date();
    state.dbLoadError = null;
  } catch (e) {
    state.dbLoadError = e instanceof Error ? e.message : String(e);
    console.warn('[WA] Could not load bot config from DB:', e);
  }
}

/** Live values used by the bot when building a reply. */
export function getSystemPrompt(): string {
  return state.systemPrompt;
}

export function getKnowledgeBase(): Record<string, any> {
  return state.knowledgeBase;
}

/** Same payload the internal admin GET has always returned. */
export function getBotConfig() {
  return { systemPrompt: state.systemPrompt, knowledgeBase: state.knowledgeBaseRaw };
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/** Health/status of the live in-memory config (no prompt/KB text). */
export function getBotConfigStatus() {
  const topLevelKeys = Object.keys(state.knowledgeBase || {});
  return {
    systemPrompt: {
      source: state.systemPromptSource,
      length: state.systemPrompt.length,
      sha256: sha256(state.systemPrompt),
    },
    knowledgeBase: {
      ...state.kb,
      // true = the raw KB text (what admins see/edit) is exactly what the bot uses
      inSync: state.kb.parsed && state.kb.rawSource === state.kb.effectiveSource,
      rawLength: state.knowledgeBaseRaw.length,
      rawSha256: sha256(state.knowledgeBaseRaw),
      topLevelKeys,
    },
    dbLoadedAt: state.dbLoadedAt,
    dbLoadError: state.dbLoadError,
    lastUpdatedAt: state.lastUpdatedAt,
    lastUpdatedBy: state.lastUpdatedBy,
  };
}

export interface BotConfigUpdate {
  systemPrompt?: unknown;
  knowledgeBase?: unknown;
}

/**
 * Persist and live-apply a new system prompt and/or knowledge base.
 * Everything is validated BEFORE anything is written, so an invalid KB never leaves a
 * half-applied update (new prompt saved, KB rejected).
 */
export async function updateBotConfig(input: BotConfigUpdate, req?: Request) {
  const newPrompt = typeof input.systemPrompt === 'string' ? input.systemPrompt : undefined;
  const newKB = typeof input.knowledgeBase === 'string' ? input.knowledgeBase : undefined;

  let parsedKB: Record<string, any> | undefined;
  if (newKB !== undefined) {
    const parsed = parseKnowledgeBase(newKB);
    if (!parsed.ok) {
      throw new AppError(400, 'Knowledge base must be valid JSON', { parseError: parsed.error });
    }
    parsedKB = parsed.value;
  }

  const updatedBy = actorLabel(req);
  const changed: string[] = [];

  if (newPrompt !== undefined) {
    const before = state.systemPrompt;
    await prisma.$executeRaw`
      INSERT INTO bot_config (key, value, updated_at, updated_by)
      VALUES ('system_prompt', ${newPrompt}, NOW(), ${updatedBy})
      ON CONFLICT (key) DO UPDATE SET value = ${newPrompt}, updated_at = NOW(), updated_by = ${updatedBy}
    `;
    state.systemPrompt = newPrompt;
    state.systemPromptSource = 'db';
    changed.push('system_prompt');
    await logAudit({
      action: 'UPDATE',
      entity: 'BotConfig',
      entityId: 'system_prompt',
      oldValue: { length: before.length, sha256: sha256(before) },
      newValue: { length: newPrompt.length, sha256: sha256(newPrompt) },
      req,
    });
  }

  if (newKB !== undefined && parsedKB) {
    const before = state.knowledgeBaseRaw;
    await prisma.$executeRaw`
      INSERT INTO bot_config (key, value, updated_at, updated_by)
      VALUES ('knowledge_base', ${newKB}, NOW(), ${updatedBy})
      ON CONFLICT (key) DO UPDATE SET value = ${newKB}, updated_at = NOW(), updated_by = ${updatedBy}
    `;
    state.knowledgeBaseRaw = newKB;
    state.knowledgeBase = parsedKB;
    state.kb = { rawSource: 'db', effectiveSource: 'db', parsed: true, parseError: null };
    changed.push('knowledge_base');
    await logAudit({
      action: 'UPDATE',
      entity: 'BotConfig',
      entityId: 'knowledge_base',
      oldValue: { length: before.length, sha256: sha256(before) },
      newValue: { length: newKB.length, sha256: sha256(newKB), topLevelKeys: Object.keys(parsedKB) },
      req,
    });
  }

  if (changed.length) {
    state.lastUpdatedAt = new Date();
    state.lastUpdatedBy = updatedBy;
    console.log(`[WA] Bot config updated by ${updatedBy}: ${changed.join(', ')}`);
  }
  return { changed };
}

/** Test-only: reset in-memory state. */
export function __resetBotConfigStateForTests() {
  state.systemPrompt = '';
  state.systemPromptSource = 'none';
  state.knowledgeBase = {};
  state.knowledgeBaseRaw = '{}';
  state.kb = { rawSource: 'none', effectiveSource: 'none', parsed: false, parseError: null };
  state.dbLoadedAt = null;
  state.dbLoadError = null;
  state.lastUpdatedAt = null;
  state.lastUpdatedBy = null;
}

// Load file defaults at import time (same as before, when this lived in routes/whatsapp.ts).
loadBotConfigFromFiles();
