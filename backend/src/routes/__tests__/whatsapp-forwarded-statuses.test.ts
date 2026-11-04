import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/wa/webhook for the phone number routed to the external agent: inbound messages are
 * forwarded and skipped, but delivery statuses of CRM-sent messages are still applied.
 */

vi.hoisted(() => {
  process.env.WA_INBOUND_FORWARD_PHONE_NUMBER_ID = 'pn-agent';
  process.env.WA_INBOUND_FORWARD_WEBHOOK_URL = 'https://agent.example/webhook';
});

const h = vi.hoisted(() => ({
  prisma: {
    $queryRaw: vi.fn(async () => []),
    customer: { findFirst: vi.fn() },
    instructor: { findFirst: vi.fn(), findMany: vi.fn() },
    waMessage: { findUnique: vi.fn(), create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    waConversation: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    waCallbackRequest: { findFirst: vi.fn(), create: vi.fn() },
    waClickRef: { findFirst: vi.fn(), updateMany: vi.fn() },
  },
  findOrCreateCustomer: vi.fn(),
  findOrCreateLeadAppointment: vi.fn(),
}));

vi.mock('../../utils/prisma.js', () => ({ prisma: h.prisma }));
vi.mock('axios', () => ({ default: { post: vi.fn(async () => ({ data: {} })), get: vi.fn() } }));
vi.mock('openai', () => ({ default: class { chat = { completions: { create: vi.fn() } }; } }));
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: vi.fn() }; } }));
vi.mock('../../services/email/sender.js', () => ({ sendEmail: vi.fn() }));
vi.mock('../../services/messaging.js', () => ({ sendWhatsAppToChat: vi.fn() }));
vi.mock('../../services/wa-events.js', () => ({ addWaSseClient: vi.fn(), removeWaSseClient: vi.fn(), broadcastWaSSE: vi.fn() }));
vi.mock('../../services/whatsapp-reminder.service.js', () => ({ handleStatusReply: vi.fn(), parseInstructorStatusReply: vi.fn(() => null) }));
vi.mock('../../utils/lead-customer.js', () => ({ findOrCreateCustomer: h.findOrCreateCustomer }));
vi.mock('../../utils/lead-dedup.js', () => ({ findOrCreateLeadAppointment: h.findOrCreateLeadAppointment }));
vi.mock('../../services/jev-intent.js', () => ({
  getJevMode: () => 'off',
  applyJevRouting: vi.fn(),
  getJevModelRoutingMode: () => 'off',
  getJevModelRoutingHumanMode: () => 'reply',
  buildComplexityState: () => null,
  classifyReplyComplexity: async () => null,
  decideModelTier: () => ({ tier: 'strong', escalate: false }),
}));
vi.mock('../../services/wa-bot-config.js', () => ({
  initBotConfigFromDB: vi.fn(),
  getSystemPrompt: () => '',
  getKnowledgeBase: () => ({}),
  getBotConfig: vi.fn(),
  updateBotConfig: vi.fn(),
}));

import axios from 'axios';
import whatsappRouter from '../whatsapp.js';

const app = express();
app.use(express.json());
app.use('/api/wa', whatsappRouter);

function change(value: Record<string, unknown>) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'waba', changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'pn-agent', display_phone_number: '972533027763' }, ...value } }] }],
  };
}

async function settle() {
  for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
}

describe('webhook statuses for the agent-forwarded number', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.prisma.waMessage.updateMany.mockResolvedValue({ count: 1 });
    h.prisma.waMessage.findFirst.mockResolvedValue(null);
  });

  it('forwards the change and still records delivered/read statuses', async () => {
    await request(app).post('/api/wa/webhook').send(change({ statuses: [{ id: 'wamid.A', status: 'delivered' }, { id: 'wamid.B', status: 'read' }] }));
    await settle();

    expect(vi.mocked(axios.post)).toHaveBeenCalledWith('https://agent.example/webhook', expect.anything(), expect.anything());
    expect(h.prisma.waMessage.updateMany).toHaveBeenCalledWith({ where: { waMessageId: 'wamid.A' }, data: { status: 'delivered' } });
    expect(h.prisma.waMessage.updateMany).toHaveBeenCalledWith({ where: { waMessageId: 'wamid.B' }, data: { status: 'read' } });
  });

  it('records failures with Meta\'s reason', async () => {
    await request(app).post('/api/wa/webhook').send(change({ statuses: [{ id: 'wamid.F', status: 'failed', errors: [{ code: 131049, title: 'ecosystem' }] }] }));
    await settle();

    expect(h.prisma.waMessage.updateMany).toHaveBeenCalledWith({
      where: { waMessageId: 'wamid.F' },
      data: { status: 'failed', errorCode: 131049, errorMessage: '131049: ecosystem' },
    });
  });

  it('does not process inbound messages for the forwarded number in the CRM', async () => {
    await request(app).post('/api/wa/webhook').send(change({ messages: [{ from: '972500000001', id: 'wamid.in', type: 'text', text: { body: 'היי' } }] }));
    await settle();

    expect(h.prisma.waConversation.findFirst).not.toHaveBeenCalled();
    expect(h.prisma.waMessage.create).not.toHaveBeenCalled();
  });
});
