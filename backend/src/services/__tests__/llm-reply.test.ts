import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  openaiCreate: vi.fn(),
  anthropicCreate: vi.fn(),
  anthropicCtorOpts: [] as any[],
}));

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: h.openaiCreate } };
  },
}));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: h.anthropicCreate };
    constructor(opts: any) {
      h.anthropicCtorOpts.push(opts);
    }
  },
}));

import {
  buildAnthropicRequest,
  buildOpenAIRequest,
  CLAUDE_WHATSAPP_FORMAT_NOTE,
  generateReply,
  isAnthropicCreditError,
  LlmBothProvidersFailedError,
  resetLlmClients,
  shouldFallBack,
  toAnthropicMessages,
  type ChatTurn,
} from '../llm-reply.js';

const ENV_KEYS = [
  'BOT_LLM_PROVIDER',
  'BOT_OPENAI_MODEL',
  'BOT_ANTHROPIC_MODEL_STRONG',
  'BOT_ANTHROPIC_MODEL_FAST',
  'BOT_LLM_FALLBACK',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
];
const savedEnv: Record<string, string | undefined> = {};

const system = { head: 'PROMPT\n\n---\n## Knowledge Base\n\n{}\n', tail: '\n---\n## הקשר שיחה\n\nמספר טלפון: 972500000001\n' };
const history: ChatTurn[] = [
  { role: 'assistant', content: 'שלום! (template)' },
  { role: 'user', content: 'היי' },
  { role: 'user', content: 'כמה עולה?' },
  { role: 'assistant', content: '999 ש״ח' },
  { role: 'user', content: 'תודה' },
];

function openaiOk(text = 'תשובת gpt') {
  return { choices: [{ message: { content: text } }], usage: { prompt_tokens: 100, completion_tokens: 20 } };
}
function anthropicOk(text = 'תשובת קלוד', stop_reason = 'end_turn') {
  return {
    content: text ? [{ type: 'text', text }] : [],
    stop_reason,
    usage: { input_tokens: 10, output_tokens: 30, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 },
  };
}
function httpError(status: number, message = 'err') {
  return Object.assign(new Error(message), { status });
}

describe('llm-reply', () => {
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    process.env.OPENAI_API_KEY = 'sk-test';
    vi.clearAllMocks();
    h.anthropicCtorOpts.length = 0;
    resetLlmClients();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    vi.restoreAllMocks();
  });

  describe('request shaping', () => {
    it('OpenAI request is exactly the legacy body (system = head + tail, history as-is)', () => {
      expect(buildOpenAIRequest({ system, history })).toEqual({
        model: 'gpt-4o',
        messages: [{ role: 'system', content: system.head + system.tail }, ...history],
        max_tokens: 500,
        temperature: 0.7,
      });
    });

    it('Anthropic messages: drop leading assistant, merge same-role runs, alternate starting with user', () => {
      expect(toAnthropicMessages(history)).toEqual([
        { role: 'user', content: 'היי\nכמה עולה?' },
        { role: 'assistant', content: '999 ש״ח' },
        { role: 'user', content: 'תודה' },
      ]);
      expect(toAnthropicMessages([{ role: 'assistant', content: 'a' }])).toEqual([]);
    });

    it('does not mutate the caller history when merging', () => {
      const copy = JSON.parse(JSON.stringify(history));
      toAnthropicMessages(history);
      expect(history).toEqual(copy);
    });

    it('Sonnet 5: no temperature, thinking disabled, cached prompt+KB block + WhatsApp format note, tail separate', () => {
      const req = buildAnthropicRequest({ system, history }, 'claude-sonnet-5');
      expect(req).not.toHaveProperty('temperature');
      expect(req.thinking).toEqual({ type: 'disabled' });
      expect(req.max_tokens).toBe(500);
      expect(req.system).toEqual([
        { type: 'text', text: system.head + CLAUDE_WHATSAPP_FORMAT_NOTE, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: system.tail },
      ]);
      expect(CLAUDE_WHATSAPP_FORMAT_NOTE).toContain('WhatsApp formatting: no Markdown');
    });

    it('Haiku 4.5: no temperature (rejected by the API via SDK 1.x), no thinking param', () => {
      const req = buildAnthropicRequest({ system, history }, 'claude-haiku-4-5');
      expect(req).not.toHaveProperty('temperature');
      expect(req).not.toHaveProperty('thinking');
    });
  });

  describe('defaults = today', () => {
    it('one gpt-4o call with exactly the legacy body and no per-request options', async () => {
      h.openaiCreate.mockResolvedValue(openaiOk());
      const res = await generateReply({ system, history });
      expect(h.openaiCreate).toHaveBeenCalledTimes(1);
      expect(h.openaiCreate.mock.calls[0]).toHaveLength(1);
      expect(JSON.stringify(h.openaiCreate.mock.calls[0][0])).toBe(
        JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'system', content: system.head + system.tail }, ...history],
          max_tokens: 500,
          temperature: 0.7,
        }),
      );
      expect(h.anthropicCreate).not.toHaveBeenCalled();
      expect(res).toEqual({
        text: 'תשובת gpt',
        provider: 'openai',
        model: 'gpt-4o',
        usage: { inputTokens: 100, outputTokens: 20 },
        fellBack: false,
      });
    });

    it('OpenAI error is rethrown untouched when fallback is off (even with an Anthropic key)', async () => {
      process.env.ANTHROPIC_API_KEY = 'ak';
      const err = httpError(429, 'You exceeded your current quota');
      h.openaiCreate.mockRejectedValue(err);
      await expect(generateReply({ system, history })).rejects.toBe(err);
      expect(h.anthropicCreate).not.toHaveBeenCalled();
    });

    it('tier is ignored by the OpenAI provider', async () => {
      h.openaiCreate.mockResolvedValue(openaiOk());
      await generateReply({ system, history, tier: 'fast' });
      expect(h.openaiCreate.mock.calls[0][0].model).toBe('gpt-4o');
    });
  });

  describe('anthropic provider', () => {
    beforeEach(() => {
      process.env.BOT_LLM_PROVIDER = 'anthropic';
      process.env.ANTHROPIC_API_KEY = 'ak';
    });

    it('strong tier → Sonnet; usage counts cached input tokens', async () => {
      h.anthropicCreate.mockResolvedValue(anthropicOk());
      const res = await generateReply({ system, history });
      expect(h.anthropicCreate.mock.calls[0][0].model).toBe('claude-sonnet-5');
      expect(h.anthropicCtorOpts[0]).toMatchObject({ apiKey: 'ak', timeout: 12_000 });
      expect(res).toMatchObject({
        text: 'תשובת קלוד',
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        usage: { inputTokens: 910, outputTokens: 30, cacheReadTokens: 900 },
        fellBack: false,
      });
    });

    it('fast tier → Haiku (configurable)', async () => {
      process.env.BOT_ANTHROPIC_MODEL_FAST = 'claude-haiku-4-5-20251001';
      h.anthropicCreate.mockResolvedValue(anthropicOk());
      const res = await generateReply({ system, history, tier: 'fast' });
      expect(res.model).toBe('claude-haiku-4-5-20251001');
      expect(h.anthropicCreate.mock.calls[0][0]).not.toHaveProperty("temperature");
    });

    it('refusal with fallback off → throws, no OpenAI call', async () => {
      h.anthropicCreate.mockResolvedValue(anthropicOk('', 'refusal'));
      await expect(generateReply({ system, history })).rejects.toThrow(/refused/);
      expect(h.openaiCreate).not.toHaveBeenCalled();
    });
  });

  describe('fallback (BOT_LLM_FALLBACK=on)', () => {
    beforeEach(() => {
      process.env.BOT_LLM_FALLBACK = 'on';
      process.env.ANTHROPIC_API_KEY = 'ak';
    });

    it.each([
      ['500', httpError(500)],
      ['529 overloaded', httpError(529, 'Overloaded')],
      ['429', httpError(429)],
      ['timeout', Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' })],
    ])('anthropic %s → gpt-4o once', async (_label, err) => {
      process.env.BOT_LLM_PROVIDER = 'anthropic';
      h.anthropicCreate.mockRejectedValue(err);
      h.openaiCreate.mockResolvedValue(openaiOk());
      const res = await generateReply({ system, history, tier: 'fast' });
      expect(h.anthropicCreate).toHaveBeenCalledTimes(1);
      expect(h.openaiCreate).toHaveBeenCalledTimes(1);
      // Fallback OpenAI call keeps the legacy body, adds only a timeout so a hung call can't block the reply.
      expect(h.openaiCreate.mock.calls[0][0]).toEqual(buildOpenAIRequest({ system, history }));
      expect(h.openaiCreate.mock.calls[0][1]).toMatchObject({ timeout: 12_000 });
      expect(res).toMatchObject({ provider: 'openai', model: 'gpt-4o', fellBack: true });
    });

    it('anthropic refusal → gpt-4o', async () => {
      process.env.BOT_LLM_PROVIDER = 'anthropic';
      h.anthropicCreate.mockResolvedValue(anthropicOk('', 'refusal'));
      h.openaiCreate.mockResolvedValue(openaiOk());
      const res = await generateReply({ system, history });
      expect(res).toMatchObject({ provider: 'openai', fellBack: true });
    });

    it('openai 429/5xx → Claude strong model (never fast)', async () => {
      h.openaiCreate.mockRejectedValue(httpError(503));
      h.anthropicCreate.mockResolvedValue(anthropicOk());
      const res = await generateReply({ system, history, tier: 'fast' });
      expect(h.anthropicCreate.mock.calls[0][0].model).toBe('claude-sonnet-5');
      expect(res).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-5', fellBack: true });
    });

    it('both fail → LlmBothProvidersFailedError carrying both errors', async () => {
      const oErr = httpError(429, 'You exceeded your current quota');
      const aErr = httpError(400, 'Your credit balance is too low to access the Anthropic API.');
      h.openaiCreate.mockRejectedValue(oErr);
      h.anthropicCreate.mockRejectedValue(aErr);
      const err = await generateReply({ system, history }).catch((e) => e);
      expect(err).toBeInstanceOf(LlmBothProvidersFailedError);
      expect(err.primaryError).toBe(oErr);
      expect(err.fallbackError).toBe(aErr);
    });

    it('non-retryable 400 (bad request) does not fall back', async () => {
      const err = httpError(400, 'invalid_request_error: messages: field required');
      h.openaiCreate.mockRejectedValue(err);
      await expect(generateReply({ system, history })).rejects.toBe(err);
      expect(h.anthropicCreate).not.toHaveBeenCalled();
    });

    it('fallback skipped when the other provider has no key', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      const err = httpError(500);
      h.openaiCreate.mockRejectedValue(err);
      await expect(generateReply({ system, history })).rejects.toBe(err);
      expect(h.anthropicCreate).not.toHaveBeenCalled();
      // No fallback possible → the OpenAI call stays exactly as today (no options).
      expect(h.openaiCreate.mock.calls[0]).toHaveLength(1);
    });
  });

  describe('error classification', () => {
    it('Anthropic credit errors', () => {
      expect(isAnthropicCreditError(httpError(400, 'Your credit balance is too low to access the Anthropic API.'))).toBe(true);
      expect(isAnthropicCreditError(httpError(400, 'messages: field required'))).toBe(false);
      expect(isAnthropicCreditError(httpError(429, 'rate limit'))).toBe(false);
    });

    it('shouldFallBack', () => {
      expect(shouldFallBack(httpError(401))).toBe(true);
      expect(shouldFallBack(httpError(502))).toBe(true);
      expect(shouldFallBack(Object.assign(new Error('fetch failed'), {}))).toBe(true);
      expect(shouldFallBack(httpError(400, 'bad'))).toBe(false);
      expect(shouldFallBack(new Error('some bug'))).toBe(false);
    });
  });
});
