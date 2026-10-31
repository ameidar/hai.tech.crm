import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/wa/webhook → website click attribution ("🔹CODE" in the first message) and Meta CTWA channel.
 * Real wa-lead-source service; Prisma, SDKs and side-effect services are mocked. Bot is off (aiEnabled=false).
 */

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

import whatsappRouter from '../whatsapp.js';

const app = express();
app.use(express.json());
app.use('/api/wa', whatsappRouter);

const PHONE = '972500000077';
const baseConv = {
  id: 'conv-new',
  phone: PHONE,
  contactName: 'הורה',
  aiEnabled: false,
  businessPhone: '+972533009742',
  phoneNumberId: 'pn-2',
  referralSourceType: null,
};

let n = 0;
function inbound(text: string, extra: Record<string, unknown> = {}) {
  n += 1;
  return {
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        value: {
          metadata: { display_phone_number: '972533009742', phone_number_id: 'pn-2' },
          contacts: [{ profile: { name: 'הורה' } }],
          messages: [{ from: PHONE, id: `wamid.src.${n}`, type: 'text', text: { body: text }, ...extra }],
        },
      }],
    }],
  };
}

const flush = () => new Promise((r) => setTimeout(r, 30));

describe('WhatsApp webhook — lead source attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.prisma.$queryRaw.mockResolvedValue([]);
    h.prisma.customer.findFirst.mockResolvedValue(null);
    h.prisma.instructor.findFirst.mockResolvedValue(null);
    h.prisma.instructor.findMany.mockResolvedValue([]);
    h.prisma.waMessage.findUnique.mockResolvedValue(null);
    h.prisma.waMessage.findFirst.mockResolvedValue({ createdAt: new Date() });
    h.prisma.waMessage.create.mockImplementation(async ({ data }: any) => ({ id: 'db-msg', ...data }));
    h.prisma.waConversation.findFirst.mockResolvedValue(null); // brand-new conversation
    h.prisma.waConversation.create.mockImplementation(async ({ data }: any) => ({ ...baseConv, ...data }));
    h.prisma.waConversation.update.mockImplementation(async ({ data }: any) => ({ ...baseConv, ...data }));
    h.findOrCreateCustomer.mockResolvedValue({ customerId: 'cust-1', isNew: true });
    h.findOrCreateLeadAppointment.mockResolvedValue({});
  });

  it('matches the website ref code, stores the source and strips the code from the stored message', async () => {
    h.prisma.waClickRef.findFirst.mockResolvedValue({
      id: 'ref-1',
      code: 'K7Q2MZ',
      pageUrl: 'https://hai.tech/roblox',
      pageTitle: 'קורס רובלוקס',
      utmSource: 'google',
      utmMedium: 'cpc',
      utmCampaign: 'roblox-oct',
      gclid: 'abc',
      firstTouch: null,
      landingPath: '/roblox',
    });
    h.prisma.waClickRef.updateMany.mockResolvedValue({ count: 1 });

    await request(app).post('/api/wa/webhook').send(inbound('היי, מעוניינים בקורס רובלוקס\n🔹K7Q2MZ')).expect(200);
    await flush();

    expect(h.prisma.waClickRef.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ code: 'K7Q2MZ' }),
    }));
    expect(h.prisma.waClickRef.updateMany.mock.calls[0][0].data.matchedConversationId).toBe('conv-new');

    const sourceUpdate = h.prisma.waConversation.update.mock.calls.find(([arg]: any) => arg.data.referralSourceType === 'website');
    expect(sourceUpdate?.[0].data).toMatchObject({
      referralSourceId: 'K7Q2MZ',
      referralSourceUrl: 'https://hai.tech/roblox',
      referralHeadline: 'roblox-oct',
      leadSourceChannel: 'google_ads',
    });

    const stored = h.prisma.waMessage.create.mock.calls[0][0].data;
    expect(stored.content).toBe('היי, מעוניינים בקורס רובלוקס');
    const preview = h.prisma.waConversation.update.mock.calls.find(([arg]: any) => arg.data.lastMessagePreview);
    expect(preview?.[0].data.lastMessagePreview).not.toContain('K7Q2MZ');

    const notes = h.findOrCreateLeadAppointment.mock.calls[0][0].appointmentNotes;
    expect(notes).toContain('google_ads');
  });

  it('Meta CTWA referral wins: channel meta_ctwa, code is not looked up but still stripped', async () => {
    await request(app)
      .post('/api/wa/webhook')
      .send(inbound('פרטים?\n🔹K7Q2MZ', { referral: { source_id: 'ad-1', source_type: 'ad', headline: 'מודעה', ctwa_clid: 'clid' } }))
      .expect(200);
    await flush();

    expect(h.prisma.waConversation.create.mock.calls[0][0].data).toMatchObject({
      referralSourceType: 'ad',
      leadSourceChannel: 'meta_ctwa',
    });
    expect(h.prisma.waClickRef.findFirst).not.toHaveBeenCalled();
    expect(h.prisma.waMessage.create.mock.calls[0][0].data.content).toBe('פרטים?');
  });

  it('messages without a code are untouched and never hit wa_click_refs', async () => {
    await request(app).post('/api/wa/webhook').send(inbound('שלום')).expect(200);
    await flush();
    expect(h.prisma.waClickRef.findFirst).not.toHaveBeenCalled();
    expect(h.prisma.waMessage.create.mock.calls[0][0].data.content).toBe('שלום');
  });
});
