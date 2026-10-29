import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockPost, mockCount, mockUpdate } = vi.hoisted(() => ({
  mockPost: vi.fn(),
  mockCount: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock('axios', () => ({ default: { post: mockPost } }));
vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    waMessage: { count: mockCount },
    waConversation: { update: mockUpdate },
  },
}));

import {
  applyJevRouting,
  classifyWhatsAppIntent,
  decideJevRoute,
  getJevMode,
  JEV_API_URL,
  JEV_MODEL,
  JEV_QUESTIONS,
  JEV_TIMEOUT_MS,
  JEV_COMPLEXITY_QUESTION,
  buildComplexityState,
  classifyReplyComplexity,
  decideModelTier,
  getJevModelRoutingHumanMode,
  getJevModelRoutingMode,
} from '../jev-intent.js';

function jevResponse(choice: string, confidence: number, noul = 0.5) {
  return {
    data: {
      model: JEV_MODEL,
      answers: {
        intent: { type: 'choice', choice, confidence, probabilities: { [choice]: confidence } },
        needs_human: { type: 'noul', noul },
      },
      usage: { input_tokens: 120 },
    },
  };
}

const conv = { id: 'conv-1', aiEnabled: true, intent: null };

describe('Jev WhatsApp intent routing', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TYPESAFE_API_KEY = 'test-key';
    process.env.JEV_ROUTING_ENABLED = 'true';
    mockCount.mockResolvedValue(0);
    mockUpdate.mockResolvedValue({});
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  describe('getJevMode', () => {
    it('defaults to off', () => {
      delete process.env.JEV_ROUTING_ENABLED;
      expect(getJevMode()).toBe('off');
      process.env.JEV_ROUTING_ENABLED = 'false';
      expect(getJevMode()).toBe('off');
      process.env.JEV_ROUTING_ENABLED = '';
      expect(getJevMode()).toBe('off');
    });

    it('parses shadow and on', () => {
      process.env.JEV_ROUTING_ENABLED = 'shadow';
      expect(getJevMode()).toBe('shadow');
      process.env.JEV_ROUTING_ENABLED = 'true';
      expect(getJevMode()).toBe('on');
      process.env.JEV_ROUTING_ENABLED = 'TRUE';
      expect(getJevMode()).toBe('on');
    });
  });

  describe('classifyWhatsAppIntent', () => {
    it('calls TypeSafe with pinned model, verbatim questions and a short timeout', async () => {
      mockPost.mockResolvedValue(jevResponse('new_lead', 0.98, 0.1));
      const result = await classifyWhatsAppIntent('היי, כמה עולה קורס פייתון?');

      expect(result).toEqual({ intent: 'new_lead', confidence: 0.98, needsHuman: 0.1 });
      expect(mockPost).toHaveBeenCalledWith(
        JEV_API_URL,
        { model: 'jev-1.13.0', state: 'היי, כמה עולה קורס פייתון?', questions: JEV_QUESTIONS },
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
          timeout: JEV_TIMEOUT_MS,
        }),
      );
      expect(JEV_TIMEOUT_MS).toBeLessThanOrEqual(3000);
      expect(Object.keys(JEV_QUESTIONS.intent.criteria)).toEqual([
        'new_lead', 'purchase', 'human', 'support', 'job', 'irrelevant',
      ]);
    });

    it('returns null without calling the API when the key is missing', async () => {
      delete process.env.TYPESAFE_API_KEY;
      expect(await classifyWhatsAppIntent('hello')).toBeNull();
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('returns null on API error', async () => {
      mockPost.mockRejectedValue(Object.assign(new Error('Request failed with status code 500'), { response: { status: 500 } }));
      expect(await classifyWhatsAppIntent('hello')).toBeNull();
    });

    it('returns null on timeout', async () => {
      mockPost.mockRejectedValue(Object.assign(new Error('timeout of 3000ms exceeded'), { code: 'ECONNABORTED' }));
      expect(await classifyWhatsAppIntent('hello')).toBeNull();
    });

    it('returns null on an unknown intent or malformed payload', async () => {
      mockPost.mockResolvedValue(jevResponse('something_else', 0.99));
      expect(await classifyWhatsAppIntent('hello')).toBeNull();
      mockPost.mockResolvedValue({ data: { answers: {} } });
      expect(await classifyWhatsAppIntent('hello')).toBeNull();
    });
  });

  describe('decideJevRoute', () => {
    it.each([
      ['new_lead', 'continue'],
      ['purchase', 'continue'],
      ['human', 'escalate'],
      ['support', 'escalate'],
      ['job', 'escalate'],
      ['irrelevant', 'acknowledge'],
    ] as const)('%s at high confidence → %s', (intent, action) => {
      expect(decideJevRoute({ intent, confidence: 0.9, needsHuman: null }, 'on')).toBe(action);
    });

    it('threshold is inclusive at 0.7', () => {
      expect(decideJevRoute({ intent: 'job', confidence: 0.7, needsHuman: null }, 'on')).toBe('escalate');
      expect(decideJevRoute({ intent: 'job', confidence: 0.69, needsHuman: null }, 'on')).toBe('continue');
    });

    it('never routes in shadow/off mode or without a result', () => {
      expect(decideJevRoute({ intent: 'human', confidence: 0.99, needsHuman: null }, 'shadow')).toBe('continue');
      expect(decideJevRoute({ intent: 'human', confidence: 0.99, needsHuman: null }, 'off')).toBe('continue');
      expect(decideJevRoute(null, 'on')).toBe('continue');
    });
  });

  describe('applyJevRouting', () => {
    it('flag off: no API call, no DB access, current behavior', async () => {
      delete process.env.JEV_ROUTING_ENABLED;
      expect(await applyJevRouting(conv, 'אני רוצה לדבר עם נציג', 'msg-1')).toBe('continue');
      expect(mockPost).not.toHaveBeenCalled();
      expect(mockCount).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it.each(['new_lead', 'purchase'])('%s → bot continues, intent stored', async (intent) => {
      mockPost.mockResolvedValue(jevResponse(intent, 0.95, 0.2));
      expect(await applyJevRouting(conv, 'msg', 'msg-1')).toBe('continue');
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: expect.objectContaining({ intent, intentConfidence: 0.95, intentNeedsHuman: 0.2 }),
      });
      expect(mockUpdate.mock.calls[0][0].data).not.toHaveProperty('aiEnabled');
    });

    it.each(['human', 'support', 'job'])('%s → escalate and stop the bot', async (intent) => {
      mockPost.mockResolvedValue(jevResponse(intent, 0.9, 0.9));
      expect(await applyJevRouting(conv, 'msg', 'msg-1')).toBe('escalate');
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: expect.objectContaining({ intent, intentConfidence: 0.9, aiEnabled: false }),
      });
    });

    it('irrelevant → acknowledge and stop the bot (no auto-responder loops)', async () => {
      mockPost.mockResolvedValue(jevResponse('irrelevant', 0.92));
      expect(await applyJevRouting(conv, 'Thank you for contacting XYZ Ltd.', 'msg-1')).toBe('acknowledge');
      expect(mockUpdate.mock.calls[0][0].data).toMatchObject({ intent: 'irrelevant', aiEnabled: false });
    });

    it('irrelevant below threshold → current behavior, bot flag untouched', async () => {
      mockPost.mockResolvedValue(jevResponse('irrelevant', 0.6));
      expect(await applyJevRouting(conv, 'msg', 'msg-1')).toBe('continue');
      expect(mockUpdate.mock.calls[0][0].data).not.toHaveProperty('aiEnabled');
    });

    it('low confidence → current behavior, result still stored', async () => {
      mockPost.mockResolvedValue(jevResponse('human', 0.55));
      expect(await applyJevRouting(conv, 'msg', 'msg-1')).toBe('continue');
      expect(mockUpdate.mock.calls[0][0].data).toMatchObject({ intent: 'human', intentConfidence: 0.55 });
      expect(mockUpdate.mock.calls[0][0].data).not.toHaveProperty('aiEnabled');
    });

    it('API error → current behavior, nothing stored', async () => {
      mockPost.mockRejectedValue(new Error('boom'));
      expect(await applyJevRouting(conv, 'msg', 'msg-1')).toBe('continue');
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('timeout → current behavior, nothing stored', async () => {
      mockPost.mockRejectedValue(Object.assign(new Error('timeout of 3000ms exceeded'), { code: 'ECONNABORTED' }));
      expect(await applyJevRouting(conv, 'msg', 'msg-1')).toBe('continue');
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('missing key → current behavior, no API call', async () => {
      delete process.env.TYPESAFE_API_KEY;
      expect(await applyJevRouting(conv, 'msg', 'msg-1')).toBe('continue');
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('DB failure while storing → fails open', async () => {
      mockPost.mockResolvedValue(jevResponse('job', 0.95));
      mockUpdate.mockRejectedValue(new Error('db down'));
      expect(await applyJevRouting(conv, 'msg', 'msg-1')).toBe('continue');
    });

    it('shadow mode: classifies and stores but never changes routing', async () => {
      process.env.JEV_ROUTING_ENABLED = 'shadow';
      mockPost.mockResolvedValue(jevResponse('human', 0.99, 0.95));
      expect(await applyJevRouting(conv, 'msg', 'msg-1')).toBe('continue');
      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockUpdate.mock.calls[0][0].data).toMatchObject({ intent: 'human', intentConfidence: 0.99, intentNeedsHuman: 0.95 });
      expect(mockUpdate.mock.calls[0][0].data).not.toHaveProperty('aiEnabled');
    });

    it('skips conversations that already have an intent', async () => {
      expect(await applyJevRouting({ ...conv, intent: 'new_lead' }, 'msg', 'msg-2')).toBe('continue');
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('skips when this is not the first inbound message', async () => {
      mockCount.mockResolvedValue(3);
      expect(await applyJevRouting(conv, 'msg', 'msg-4')).toBe('continue');
      expect(mockCount).toHaveBeenCalledWith({
        where: { conversationId: 'conv-1', direction: 'inbound', NOT: { id: 'msg-4' } },
      });
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('bot already disabled by staff: stores intent but does not route', async () => {
      mockPost.mockResolvedValue(jevResponse('irrelevant', 0.99));
      expect(await applyJevRouting({ ...conv, aiEnabled: false }, 'msg', 'msg-1')).toBe('continue');
      expect(mockUpdate.mock.calls[0][0].data).toMatchObject({ intent: 'irrelevant' });
    });
  });
});

describe('Jev reply-complexity routing (JEV_MODEL_ROUTING)', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TYPESAFE_API_KEY = 'test-key';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    vi.restoreAllMocks();
  });

  function complexityResponse(choice: string, confidence: number) {
    return { data: { answers: { complexity: { type: 'choice', choice, confidence } } } };
  }

  describe('modes', () => {
    it('JEV_MODEL_ROUTING defaults to off; parses shadow/on', () => {
      delete process.env.JEV_MODEL_ROUTING;
      expect(getJevModelRoutingMode()).toBe('off');
      process.env.JEV_MODEL_ROUTING = 'shadow';
      expect(getJevModelRoutingMode()).toBe('shadow');
      process.env.JEV_MODEL_ROUTING = 'ON';
      expect(getJevModelRoutingMode()).toBe('on');
      process.env.JEV_MODEL_ROUTING = 'nonsense';
      expect(getJevModelRoutingMode()).toBe('off');
    });

    it('JEV_MODEL_ROUTING_HUMAN defaults to reply', () => {
      delete process.env.JEV_MODEL_ROUTING_HUMAN;
      expect(getJevModelRoutingHumanMode()).toBe('reply');
      process.env.JEV_MODEL_ROUTING_HUMAN = 'escalate';
      expect(getJevModelRoutingHumanMode()).toBe('escalate');
    });
  });

  describe('decideModelTier', () => {
    const strong = { tier: 'strong', escalate: false };
    it('simple → fast, complex → strong (mode on)', () => {
      expect(decideModelTier({ complexity: 'simple', confidence: 0.9 }, 'on')).toEqual({ tier: 'fast', escalate: false });
      expect(decideModelTier({ complexity: 'complex', confidence: 0.9 }, 'on')).toEqual(strong);
    });

    it('human → escalate only when JEV_MODEL_ROUTING_HUMAN=escalate', () => {
      expect(decideModelTier({ complexity: 'human', confidence: 0.9 }, 'on', 'reply')).toEqual(strong);
      expect(decideModelTier({ complexity: 'human', confidence: 0.9 }, 'on')).toEqual(strong);
      expect(decideModelTier({ complexity: 'human', confidence: 0.9 }, 'on', 'escalate')).toEqual({ tier: 'strong', escalate: true });
    });

    it('confidence < 0.7 or null → strong', () => {
      expect(decideModelTier({ complexity: 'simple', confidence: 0.69 }, 'on')).toEqual(strong);
      expect(decideModelTier({ complexity: 'human', confidence: 0.5 }, 'on', 'escalate')).toEqual(strong);
      expect(decideModelTier(null, 'on', 'escalate')).toEqual(strong);
    });

    it('off / shadow never change the model', () => {
      for (const mode of ['off', 'shadow'] as const) {
        expect(decideModelTier({ complexity: 'simple', confidence: 0.99 }, mode)).toEqual(strong);
        expect(decideModelTier({ complexity: 'human', confidence: 0.99 }, mode, 'escalate')).toEqual(strong);
      }
    });
  });

  describe('buildComplexityState', () => {
    it('last 6 messages before the latest inbound + the latest inbound', () => {
      const msgs = Array.from({ length: 9 }, (_, i) => ({ direction: i % 2 ? 'outbound' : 'inbound', content: `m${i}` }));
      const state = buildComplexityState(msgs)!;
      expect(state).toBe(
        'Recent conversation (oldest first):\n' +
          'Customer: m2\nBot: m3\nCustomer: m4\nBot: m5\nCustomer: m6\nBot: m7' +
          '\n\nLATEST customer message:\nm8',
      );
    });

    it('first message → no earlier messages; no inbound → null', () => {
      expect(buildComplexityState([{ direction: 'inbound', content: 'היי' }])).toBe(
        'Recent conversation (oldest first):\n(no earlier messages)\n\nLATEST customer message:\nהיי',
      );
      expect(buildComplexityState([{ direction: 'outbound', content: 'x' }])).toBeNull();
    });
  });

  describe('classifyReplyComplexity', () => {
    it('pinned model, complexity question, 3s timeout', async () => {
      mockPost.mockResolvedValue(complexityResponse('simple', 0.93));
      expect(await classifyReplyComplexity('state')).toEqual({ complexity: 'simple', confidence: 0.93 });
      expect(mockPost).toHaveBeenCalledWith(
        JEV_API_URL,
        { model: 'jev-1.13.0', state: 'state', questions: JEV_COMPLEXITY_QUESTION },
        expect.objectContaining({ timeout: JEV_TIMEOUT_MS }),
      );
    });

    it('simple criterion is small talk only — factual questions belong to complex', () => {
      const { simple, complex } = JEV_COMPLEXITY_QUESTION.complexity.criteria;
      expect(simple).toMatch(/greeting, thanks, ok, emoji/);
      expect(simple).not.toMatch(/price|schedule|trial/);
      expect(complex).toMatch(/any factual question \(price, age, schedule/);
    });

    it('fails open: no key, error, bad payload → null', async () => {
      delete process.env.TYPESAFE_API_KEY;
      expect(await classifyReplyComplexity('state')).toBeNull();
      expect(mockPost).not.toHaveBeenCalled();

      process.env.TYPESAFE_API_KEY = 'k';
      mockPost.mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }));
      expect(await classifyReplyComplexity('state')).toBeNull();
      mockPost.mockResolvedValueOnce(complexityResponse('weird', 0.9));
      expect(await classifyReplyComplexity('state')).toBeNull();
      expect(await classifyReplyComplexity(null)).toBeNull();
    });
  });
});
