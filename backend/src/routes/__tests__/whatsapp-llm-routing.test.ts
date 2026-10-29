import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/wa/webhook → generateAIReply wiring for the multi-provider bot (services/llm-reply.ts)
 * and Jev reply-complexity routing (JEV_MODEL_ROUTING). Real llm-reply + jev-intent code; SDKs, axios
 * (Meta sends + TypeSafe) and Prisma are mocked.
 */

const h = vi.hoisted(() => ({
  prisma: {
    $queryRaw: vi.fn(async () => []),
    customer: { findFirst: vi.fn() },
    instructor: { findFirst: vi.fn() },
    waMessage: { findUnique: vi.fn(), create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    waConversation: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    waCallbackRequest: { findFirst: vi.fn(), create: vi.fn() },
  },
  axiosPost: vi.fn(),
  openaiCreate: vi.fn(),
  anthropicCreate: vi.fn(),
  sendEmail: vi.fn(),
  sendWhatsAppToChat: vi.fn(),
}));

vi.mock('../../utils/prisma.js', () => ({ prisma: h.prisma }));
vi.mock('axios', () => ({ default: { post: h.axiosPost, get: vi.fn() } }));
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: h.openaiCreate } };
  },
}));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: h.anthropicCreate };
  },
}));
vi.mock('../../services/email/sender.js', () => ({ sendEmail: h.sendEmail }));
vi.mock('../../services/messaging.js', () => ({ sendWhatsAppToChat: h.sendWhatsAppToChat }));
vi.mock('../../services/wa-events.js', () => ({
  addWaSseClient: vi.fn(),
  removeWaSseClient: vi.fn(),
  broadcastWaSSE: vi.fn(),
}));
vi.mock('../../services/whatsapp-reminder.service.js', () => ({
  handleStatusReply: vi.fn(),
  parseInstructorStatusReply: vi.fn(() => null),
}));
vi.mock('../../utils/lead-customer.js', () => ({ findOrCreateCustomer: vi.fn() }));
vi.mock('../../utils/lead-dedup.js', () => ({ findOrCreateLeadAppointment: vi.fn() }));
const BOT_PROMPT = 'אתה הבוט של דרך ההייטק.';
const BOT_KB = { courses: [{ id: 'roblox', name: 'רובלוקס' }] };
vi.mock('../../services/wa-bot-config.js', () => ({
  initBotConfigFromDB: vi.fn(),
  getSystemPrompt: () => BOT_PROMPT,
  getKnowledgeBase: () => BOT_KB,
  getBotConfig: vi.fn(),
  updateBotConfig: vi.fn(),
}));

import whatsappRouter from '../whatsapp.js';
import { CLAUDE_WHATSAPP_FORMAT_NOTE, resetLlmClients } from '../../services/llm-reply.js';

const app = express();
app.use(express.json());
app.use('/api/wa', whatsappRouter);

const conv = {
  id: 'conv-1',
  phone: '972500000001',
  contactName: 'הורה',
  childName: null,
  summary: null,
  aiEnabled: true,
  intent: 'new_lead',
  businessPhone: '+972533027763',
  phoneNumberId: 'pn-1',
};

/** The single system prompt generateAIReply sent to gpt-4o before this change (copied verbatim). */
function legacyFullSystemPrompt(c: any): string {
  return `${BOT_PROMPT}

---
## Knowledge Base (מידע על דרך ההייטק)

${JSON.stringify(BOT_KB, null, 2)}

---
## הקשר שיחה

מספר טלפון: ${c.phone}
${c.contactName ? `שם: ${c.contactName}` : ''}
${c.childName ? `שם הילד: ${c.childName}` : ''}
${c.summary ? `סיכום קודם: ${c.summary}` : ''}


---
## כלל אנטי-לופ (חובה!)
אל תחזור על תשובה שכבר נתת בשיחה הזו. אם שאלתם אותך משהו שכבר ענית עליו — ענה אחרת או הפנה לנציג. אם הלקוח אמר שלא שאל על נושא מסוים — אל תחזור לאותו נושא. הסתכל על ההיסטוריה ותן תשובה שלא כבר נאמרה.
`;
}

let msgCounter = 0;
function inbound(text: string) {
  msgCounter += 1;
  return {
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        value: {
          metadata: { display_phone_number: '972533027763', phone_number_id: 'pn-1' },
          contacts: [{ profile: { name: 'הורה' } }],
          messages: [{ from: conv.phone, id: `wamid.llm.${msgCounter}`, type: 'text', text: { body: text } }],
        },
      }],
    }],
  };
}

const flush = () => new Promise((r) => setTimeout(r, 30));
async function post(text: string, history: Array<{ direction: string; content: string }>) {
  // findMany is called with orderBy desc and reversed by the bot → return newest first.
  h.prisma.waMessage.findMany.mockResolvedValue(
    [...history, { direction: 'inbound', content: text }].map((m, i) => ({ id: `m${i}`, createdAt: new Date(), ...m })).reverse(),
  );
  await request(app).post('/api/wa/webhook').send(inbound(text)).expect(200);
  await flush();
  await flush();
}

const metaSends = () => h.axiosPost.mock.calls.filter(([url]) => String(url).includes('graph.facebook.com'));
const sentTexts = () => metaSends().map(([, body]) => body?.text?.body);
const jevCalls = () => h.axiosPost.mock.calls.filter(([url]) => String(url).includes('typesafe.ai'));
const outboundRows = () =>
  h.prisma.waMessage.create.mock.calls.map(([arg]: any) => arg.data).filter((d: any) => d.direction === 'outbound');
const CONFIRMATION = 'תודה! קיבלנו את בקשתך 😊 נציג מדרך ההייטק יחזור אליך בהקדם האפשרי.';

let jevAnswer: { choice: string; confidence: number } | null = null;

const ENV_KEYS = [
  'BOT_LLM_PROVIDER', 'BOT_OPENAI_MODEL', 'BOT_ANTHROPIC_MODEL_STRONG', 'BOT_ANTHROPIC_MODEL_FAST', 'BOT_LLM_FALLBACK',
  'ANTHROPIC_API_KEY', 'JEV_MODEL_ROUTING', 'JEV_MODEL_ROUTING_HUMAN', 'JEV_ROUTING_ENABLED', 'TYPESAFE_API_KEY',
];
const savedEnv: Record<string, string | undefined> = {};

describe('WhatsApp webhook — LLM provider + Jev complexity routing', () => {
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    vi.clearAllMocks();
    resetLlmClients();
    jevAnswer = null;
    h.prisma.$queryRaw.mockResolvedValue([]);
    h.prisma.customer.findFirst.mockResolvedValue(null);
    h.prisma.waMessage.findUnique.mockResolvedValue(null);
    h.prisma.waMessage.create.mockImplementation(async ({ data }: any) => ({ id: `db-${data.direction}`, ...data }));
    h.prisma.waMessage.findFirst.mockResolvedValue({ createdAt: new Date() });
    h.prisma.waConversation.findFirst.mockResolvedValue({ ...conv });
    h.prisma.waConversation.update.mockResolvedValue({ ...conv });
    h.prisma.waConversation.findUnique.mockResolvedValue({ ...conv });
    h.prisma.waCallbackRequest.findFirst.mockResolvedValue(null);
    h.prisma.waCallbackRequest.create.mockResolvedValue({});
    h.axiosPost.mockImplementation(async (url: string) => {
      if (String(url).includes('typesafe.ai')) {
        if (!jevAnswer) throw new Error('jev down');
        return { data: { answers: { complexity: { type: 'choice', ...jevAnswer } } } };
      }
      return { data: { messages: [{ id: 'wamid.out' }] } };
    });
    h.openaiCreate.mockResolvedValue({
      choices: [{ message: { content: 'תשובת gpt' } }],
      usage: { prompt_tokens: 1000, completion_tokens: 50 },
    });
    h.anthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'תשובת קלוד' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 20, output_tokens: 40, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 },
    });
    h.sendEmail.mockResolvedValue(undefined);
    h.sendWhatsAppToChat.mockResolvedValue({ success: true });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    vi.restoreAllMocks();
  });

  it('default env: exactly today\'s OpenAI request (byte-identical), no Jev / Anthropic calls', async () => {
    const history = [
      { direction: 'outbound', content: 'שלום! (תבנית פתיחה)' },
      { direction: 'inbound', content: 'היי' },
      { direction: 'outbound', content: 'קיבלנו את בקשתך 😊 נציג מדרך ההייטק יחזור אליך' }, // BOT_SKIP_PHRASES
      { direction: 'outbound', content: 'שלום! (תבנית פתיחה)' }, // duplicate outbound → deduped
    ];
    await post('כמה עולה החוג?', history);

    expect(h.openaiCreate).toHaveBeenCalledTimes(1);
    expect(h.openaiCreate.mock.calls[0]).toHaveLength(1); // no per-request options, as before
    const expected = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: legacyFullSystemPrompt(conv) },
        { role: 'assistant', content: 'שלום! (תבנית פתיחה)' },
        { role: 'user', content: 'היי' },
        { role: 'user', content: 'כמה עולה החוג?' },
      ],
      max_tokens: 500,
      temperature: 0.7,
    };
    expect(JSON.stringify(h.openaiCreate.mock.calls[0][0])).toBe(JSON.stringify(expected));
    expect(h.anthropicCreate).not.toHaveBeenCalled();
    expect(jevCalls()).toHaveLength(0);
    expect(sentTexts()).toEqual(['תשובת gpt']);
    expect(outboundRows()[0]).toMatchObject({ content: 'תשובת gpt', isAiGenerated: true, aiModel: 'gpt-4o', aiRoute: null, tokensUsed: 1050 });
  });

  it('shadow: classifies + records the would-be tier but keeps the default model', async () => {
    process.env.JEV_MODEL_ROUTING = 'shadow';
    process.env.TYPESAFE_API_KEY = 'k';
    jevAnswer = { choice: 'simple', confidence: 0.91 };
    await post('תודה רבה!', [{ direction: 'outbound', content: 'בשמחה' }]);
    expect(jevCalls()).toHaveLength(1);
    expect(jevCalls()[0][1]).toMatchObject({ model: 'jev-1.13.0' });
    expect(h.openaiCreate).toHaveBeenCalledTimes(1);
    expect(h.anthropicCreate).not.toHaveBeenCalled();
    expect(outboundRows()[0]).toMatchObject({
      aiModel: 'gpt-4o',
      aiRoute: 'routing=shadow jev=simple@0.91 tier=strong would=fast',
    });
  });

  it('on + anthropic: simple → Haiku, stored on the outbound row', async () => {
    process.env.BOT_LLM_PROVIDER = 'anthropic';
    process.env.ANTHROPIC_API_KEY = 'ak';
    process.env.JEV_MODEL_ROUTING = 'on';
    process.env.TYPESAFE_API_KEY = 'k';
    jevAnswer = { choice: 'simple', confidence: 0.95 };
    await post('תודה 🙏', []);
    expect(h.anthropicCreate.mock.calls[0][0].model).toBe('claude-haiku-4-5');
    expect(h.openaiCreate).not.toHaveBeenCalled();
    expect(sentTexts()).toEqual(['תשובת קלוד']);
    expect(outboundRows()[0]).toMatchObject({ aiModel: 'claude-haiku-4-5', aiRoute: 'routing=on jev=simple@0.95 tier=fast', tokensUsed: 1060 });
  });

  it('on + anthropic: Jev down → Sonnet (fail-open to the strong model)', async () => {
    process.env.BOT_LLM_PROVIDER = 'anthropic';
    process.env.ANTHROPIC_API_KEY = 'ak';
    process.env.JEV_MODEL_ROUTING = 'on';
    process.env.TYPESAFE_API_KEY = 'k';
    jevAnswer = null;
    await post('מתי מתחיל החוג?', []);
    const req = h.anthropicCreate.mock.calls[0][0];
    expect(req.model).toBe('claude-sonnet-5');
    expect(req.thinking).toEqual({ type: 'disabled' });
    expect(req).not.toHaveProperty('temperature');
    // Cached block = prompt + KB (+ WhatsApp format note); tail carries the conversation context.
    expect(req.system[0].cache_control).toEqual({ type: 'ephemeral' });
    const legacy = legacyFullSystemPrompt(conv);
    const split = legacy.indexOf('\n---\n## הקשר שיחה');
    expect(req.system[0].text).toBe(legacy.slice(0, split) + CLAUDE_WHATSAPP_FORMAT_NOTE);
    expect(req.system[1].text).toBe(legacy.slice(split));
    expect(outboundRows()[0].aiRoute).toBe('routing=on jev=none tier=strong');
  });

  it('on + human + JEV_MODEL_ROUTING_HUMAN=escalate: no AI reply, bot off, callback alert + one confirmation', async () => {
    process.env.JEV_MODEL_ROUTING = 'on';
    process.env.JEV_MODEL_ROUTING_HUMAN = 'escalate';
    process.env.TYPESAFE_API_KEY = 'k';
    jevAnswer = { choice: 'human', confidence: 0.92 };
    await post('שילמתי ועדיין אין לי גישה לשיעור', []);
    expect(h.openaiCreate).not.toHaveBeenCalled();
    expect(h.anthropicCreate).not.toHaveBeenCalled();
    expect(h.prisma.waConversation.update).toHaveBeenCalledWith({ where: { id: 'conv-1' }, data: { aiEnabled: false } });
    expect(h.prisma.waCallbackRequest.create).toHaveBeenCalledTimes(1);
    expect(h.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'info@hai.tech' }));
    expect(sentTexts()).toEqual([CONFIRMATION]);
  });

  it('on + human with the default JEV_MODEL_ROUTING_HUMAN=reply: bot answers with the strong model', async () => {
    process.env.JEV_MODEL_ROUTING = 'on';
    process.env.TYPESAFE_API_KEY = 'k';
    jevAnswer = { choice: 'human', confidence: 0.92 };
    await post('שילמתי ועדיין אין לי גישה לשיעור', []);
    expect(h.openaiCreate).toHaveBeenCalledTimes(1);
    expect(h.prisma.waCallbackRequest.create).not.toHaveBeenCalled();
    expect(sentTexts()).toEqual(['תשובת gpt']);
  });

  it('contact-loop guardrail still rewrites Claude output', async () => {
    process.env.BOT_LLM_PROVIDER = 'anthropic';
    process.env.ANTHROPIC_API_KEY = 'ak';
    h.anthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'מומלץ לפנות לצוות התמיכה שלנו בוואטסאפ: wa.me/972533009742' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await post('אני לא מצליח להתחבר לקורס', []);
    expect(sentTexts()).toHaveLength(1);
    expect(sentTexts()[0]).toContain('אני מעביר/ה את זה לנציג אנושי');
    expect(sentTexts()[0]).not.toContain('wa.me');
  });

  it('fallback on: OpenAI 500 → Claude reply is sent, no credit alert', async () => {
    process.env.BOT_LLM_FALLBACK = 'on';
    process.env.ANTHROPIC_API_KEY = 'ak';
    h.openaiCreate.mockRejectedValue(Object.assign(new Error('server error'), { status: 500 }));
    await post('כמה עולה החוג?', []);
    expect(sentTexts()).toEqual(['תשובת קלוד']);
    expect(outboundRows()[0]).toMatchObject({ aiModel: 'claude-sonnet-5', aiRoute: 'fellBack=anthropic' });
    expect(h.sendWhatsAppToChat).not.toHaveBeenCalled();
  });

  it('both providers out of credit: no customer message, one credit alert per provider', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.BOT_LLM_FALLBACK = 'on';
    process.env.ANTHROPIC_API_KEY = 'ak';
    h.openaiCreate.mockRejectedValue(Object.assign(new Error('You exceeded your current quota'), { status: 429, code: 'insufficient_quota' }));
    h.anthropicCreate.mockRejectedValue(Object.assign(new Error('Your credit balance is too low to access the Anthropic API.'), { status: 400 }));
    await post('כמה עולה החוג?', []);
    expect(sentTexts()).toEqual([]);
    const alerts = h.sendWhatsAppToChat.mock.calls.map(([, msg]) => String(msg)).filter((m) => m.includes('תקלה קריטית בבוט'));
    expect(alerts).toHaveLength(2);
    expect(alerts.some((m) => m.includes('OpenAI'))).toBe(true);
    expect(alerts.some((m) => m.includes('Anthropic'))).toBe(true);

    // Throttled: a second failure inside the cooldown doesn't alert again.
    h.sendWhatsAppToChat.mockClear();
    await post('הלו?', []);
    expect(h.sendWhatsAppToChat.mock.calls.filter(([, msg]) => String(msg).includes('תקלה קריטית'))).toHaveLength(0);
  });
});
