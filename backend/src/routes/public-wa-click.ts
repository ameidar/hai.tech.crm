/**
 * POST /api/public/wa-click — WhatsApp-button click beacon from hai.tech (no auth).
 *
 * Sent with navigator.sendBeacon, so the body usually arrives as text/plain;charset=UTF-8
 * containing JSON; application/json is accepted too. Always answers 204 for valid payloads
 * (the beacon can't read the response anyway). Mounted in index.ts before global CORS/auth.
 */

import crypto from 'crypto';
import express, { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { isValidWaRefCode, safeDecodeURIComponent } from '../services/wa-lead-source.js';

export const publicWaClickRouter = Router();

const MAX_BODY = '8kb';
const STR_MAX = 500;
const URL_MAX = 1000;
const PREFILL_MAX = 1000;
const UA_MAX = 300;

const ALLOWED_ORIGINS = new Set(['https://hai.tech', 'https://www.hai.tech']);
const PAGES_DEV_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*hai-tech-website\.pages\.dev$/i;
const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

export function isAllowedWaClickOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  return ALLOWED_ORIGINS.has(origin) || PAGES_DEV_ORIGIN.test(origin) || LOCALHOST_ORIGIN.test(origin);
}

/** Optional string, truncated to `max`; non-strings / empty become undefined (never rejects). */
const optStr = (max: number) =>
  z.preprocess((v) => {
    if (typeof v === 'number' || typeof v === 'boolean') v = String(v);
    if (typeof v !== 'string') return undefined;
    const t = v.trim();
    return t ? t.slice(0, max) : undefined;
  }, z.string().optional());

/** Like optStr, but percent-decodes first (Hebrew paths arrive URL-encoded). */
const optPath = (max: number) =>
  z.preprocess((v) => (typeof v === 'string' ? safeDecodeURIComponent(v) : v), optStr(max));

const optDate = z.preprocess((v) => {
  if (typeof v !== 'string' || !v.trim()) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}, z.string().optional());

const touchShape = {
  utmSource: optStr(STR_MAX),
  utmMedium: optStr(STR_MAX),
  utmCampaign: optStr(STR_MAX),
  utmContent: optStr(STR_MAX),
  utmTerm: optStr(STR_MAX),
  gclid: optStr(STR_MAX),
  gbraid: optStr(STR_MAX),
  wbraid: optStr(STR_MAX),
  fbclid: optStr(STR_MAX),
  referrer: optStr(URL_MAX),
  landingPath: optPath(URL_MAX),
};

const firstTouchSchema = z.object({ ...touchShape, at: optDate }).strip();

export const waClickSchema = z
  .object({
    code: z.string().trim().refine(isValidWaRefCode, 'invalid code'),
    pageUrl: optStr(URL_MAX),
    pagePath: optPath(URL_MAX),
    pageTitle: optStr(STR_MAX),
    waNumber: optStr(50),
    prefill: optStr(PREFILL_MAX),
    ...touchShape,
    firstTouch: z.preprocess(
      (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : undefined),
      firstTouchSchema.optional(),
    ),
    clickedAt: optDate,
  })
  .strip();

export type WaClickPayload = z.infer<typeof waClickSchema>;

function clientIp(req: Request): string {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf) return cf.trim();
  const xff = req.headers['x-forwarded-for'];
  const first = (Array.isArray(xff) ? xff[0] : xff || '').split(',')[0].trim();
  return first || req.ip || req.socket.remoteAddress || 'unknown';
}

function hashIp(ip: string): string {
  return crypto.createHash('sha256').update(ip).digest('hex');
}

// ── CORS (own handling — this route is mounted before the global credentialed CORS)
publicWaClickRouter.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (isAllowedWaClickOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin!);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

publicWaClickRouter.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => clientIp(req as Request),
    validate: false,
    message: { error: 'Too many requests' },
  }),
);

// Body parsing: sendBeacon → text/plain JSON; also accept application/json. Capped at ~8KB.
publicWaClickRouter.use(express.text({ type: 'text/plain', limit: MAX_BODY }));
publicWaClickRouter.use(express.json({ limit: MAX_BODY }));

publicWaClickRouter.post('/', async (req: Request, res: Response) => {
  let raw: unknown = req.body;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return res.status(400).json({ error: 'invalid JSON' });
    }
  }

  const parsed = waClickSchema.safeParse(raw);
  if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
  const p = parsed.data;

  const ua = req.headers['user-agent'];
  const data = {
    pageUrl: p.pageUrl,
    pagePath: p.pagePath,
    pageTitle: p.pageTitle,
    waNumber: p.waNumber,
    prefill: p.prefill,
    utmSource: p.utmSource,
    utmMedium: p.utmMedium,
    utmCampaign: p.utmCampaign,
    utmContent: p.utmContent,
    utmTerm: p.utmTerm,
    gclid: p.gclid,
    gbraid: p.gbraid,
    wbraid: p.wbraid,
    fbclid: p.fbclid,
    referrer: p.referrer,
    landingPath: p.landingPath,
    firstTouch: p.firstTouch ? (p.firstTouch as Prisma.InputJsonValue) : undefined,
    clickedAt: p.clickedAt ? new Date(p.clickedAt) : undefined,
    ipHash: hashIp(clientIp(req)),
    userAgent: typeof ua === 'string' ? ua.slice(0, UA_MAX) : undefined,
  };

  try {
    // Duplicate beacons for the same code: refresh data unless the code is already matched.
    const existing = await prisma.waClickRef.findUnique({ where: { code: p.code }, select: { id: true, matchedConversationId: true } });
    if (!existing) {
      await prisma.waClickRef.create({ data: { code: p.code, ...data } });
    } else if (!existing.matchedConversationId) {
      await prisma.waClickRef.update({ where: { id: existing.id }, data });
    }
  } catch (err) {
    // P2002 = concurrent duplicate create; harmless.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) {
      console.error('[wa-click] store failed:', err);
      return res.sendStatus(500);
    }
  }

  return res.sendStatus(204);
});

// Body-parser errors (too large / malformed JSON) → 4xx without hitting the global handler.
publicWaClickRouter.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'payload too large' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid JSON' });
  next(err);
});
