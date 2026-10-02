/**
 * Jev intent classification for inbound WhatsApp messages.
 *
 * Uses TypeSafe's System One classifier (model pinned to jev-1.13.0 — aliases can
 * move and routing depends on the confidence threshold) to classify the FIRST
 * inbound message of a conversation, stores the result on the conversation, and
 * optionally routes the AI bot:
 *
 *   JEV_ROUTING_ENABLED unset/false → feature off, no API call, no DB writes.
 *   JEV_ROUTING_ENABLED=shadow      → classify + store only, routing unchanged.
 *   JEV_ROUTING_ENABLED=true        → classify + store + route (confidence ≥ 0.7):
 *       new_lead / purchase        → bot continues as today
 *       human / support / job      → bot stopped, staff callback alert, one callback confirmation reply
 *       irrelevant                 → bot stopped (no auto-responder loops), one confirmation reply, no alert
 *
 * Fails open: missing key, API error, timeout, malformed response or low
 * confidence all fall back to the current bot behavior.
 */
import axios from 'axios';
import { prisma } from '../utils/prisma.js';

export const JEV_API_URL = 'https://api.typesafe.ai/v1/systemone';
export const JEV_MODEL = 'jev-1.13.0';
export const JEV_TIMEOUT_MS = 3000;
export const JEV_CONFIDENCE_THRESHOLD = 0.7;

export const JEV_INTENTS = ['new_lead', 'purchase', 'human', 'support', 'job', 'irrelevant'] as const;
export type JevIntent = (typeof JEV_INTENTS)[number];

export type JevMode = 'off' | 'shadow' | 'on';

/**
 * continue    = current behavior
 * escalate    = bot off + staff callback alert + one confirmation reply
 * acknowledge = bot off + one confirmation reply, no staff alert
 */
export type JevRouteAction = 'continue' | 'escalate' | 'acknowledge';

export interface JevClassification {
  intent: JevIntent;
  confidence: number;
  needsHuman: number | null;
}

// Question definitions validated in the 63-message pilot (jev-pilot/run_pilot.py). Keep verbatim.
export const JEV_QUESTIONS = {
  intent: {
    type: 'choice',
    instructions:
      "This is the first WhatsApp message a business received. The business is " +
      "'Derech HaHaitech' (HaiTech), which sells coding, AI and Minecraft/Roblox courses " +
      "for kids and teens. What is the sender's main intent?",
    criteria: {
      new_lead: 'A prospective customer asking for information, prices, suitability, or location of courses',
      purchase: 'Wants to buy or get access to a course right now',
      human: 'Explicitly asks to talk to a person / representative or to be called back',
      support: 'An existing customer with a problem or question about a course they already bought',
      job: 'Job seeker, instructor offer, or business/partnership proposal',
      irrelevant: 'Automated reply from another business, spam, or unrelated to HaiTech',
    },
  },
  needs_human: {
    type: 'noul',
    instructions: 'Should a human staff member handle this message rather than an automated bot?',
  },
};

export function getJevMode(): JevMode {
  const raw = (process.env.JEV_ROUTING_ENABLED || '').trim().toLowerCase();
  if (raw === 'shadow') return 'shadow';
  if (raw === 'true' || raw === '1' || raw === 'on') return 'on';
  return 'off';
}

/** Returns null on any failure (missing key, network error, timeout, unexpected payload). */
export async function classifyWhatsAppIntent(text: string): Promise<JevClassification | null> {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey || !text.trim()) return null;

  try {
    const res = await axios.post(
      JEV_API_URL,
      { model: JEV_MODEL, state: text, questions: JEV_QUESTIONS },
      {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: JEV_TIMEOUT_MS,
      },
    );
    const answer = res.data?.answers?.intent;
    const intent = answer?.choice;
    const confidence = answer?.confidence;
    if (!JEV_INTENTS.includes(intent) || typeof confidence !== 'number' || !Number.isFinite(confidence)) {
      console.warn('[WA][Jev] Unexpected classifier response shape');
      return null;
    }
    const noul = res.data?.answers?.needs_human?.noul;
    return {
      intent,
      confidence,
      needsHuman: typeof noul === 'number' && Number.isFinite(noul) ? noul : null,
    };
  } catch (err: any) {
    console.warn('[WA][Jev] Classification failed, falling back:', err?.code || err?.response?.status || err?.message);
    return null;
  }
}

export function decideJevRoute(result: JevClassification | null, mode: JevMode): JevRouteAction {
  if (mode !== 'on' || !result || result.confidence < JEV_CONFIDENCE_THRESHOLD) return 'continue';
  switch (result.intent) {
    case 'human':
    case 'support':
    case 'job':
      return 'escalate';
    case 'irrelevant':
      return 'acknowledge';
    default:
      return 'continue';
  }
}

interface JevConversationRef {
  id: string;
  aiEnabled: boolean;
  intent?: string | null;
}

/**
 * Classify (when appropriate), persist, and decide routing for one inbound message.
 * Never throws; any failure → 'continue' (current behavior).
 *
 * Only classifies while the conversation has no stored intent AND this is its first
 * inbound message, so long-running conversations that predate the feature are left alone.
 * Routing only applies while the bot is enabled for the conversation.
 */
export async function applyJevRouting(
  conv: JevConversationRef,
  text: string,
  currentMessageId: string,
): Promise<JevRouteAction> {
  const mode = getJevMode();
  if (mode === 'off') return 'continue';

  try {
    if (conv.intent) return 'continue';

    const priorInbound = await prisma.waMessage.count({
      where: { conversationId: conv.id, direction: 'inbound', NOT: { id: currentMessageId } },
    });
    if (priorInbound > 0) return 'continue';

    const result = await classifyWhatsAppIntent(text);
    if (!result) return 'continue';

    const action = conv.aiEnabled ? decideJevRoute(result, mode) : 'continue';

    await prisma.waConversation.update({
      where: { id: conv.id },
      data: {
        intent: result.intent,
        intentConfidence: result.confidence,
        intentNeedsHuman: result.needsHuman,
        intentClassifiedAt: new Date(),
        ...(action !== 'continue' ? { aiEnabled: false } : {}),
      },
    });

    console.log(
      `[WA][Jev] conv=${conv.id} mode=${mode} intent=${result.intent} conf=${result.confidence.toFixed(2)} action=${action}`,
    );
    return action;
  } catch (err) {
    console.error('[WA][Jev] Routing error, falling back:', err);
    return 'continue';
  }
}
