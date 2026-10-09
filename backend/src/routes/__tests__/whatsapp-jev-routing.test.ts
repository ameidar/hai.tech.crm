import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Route-level wiring of Jev intent routing in POST /api/wa/webhook.
 * The Jev service itself is covered in services/__tests__/jev-intent.test.ts;
 * here we only verify how each routing action changes the bot's behavior.
 */

const h = vi.hoisted(() => ({
  prisma: {
    $queryRaw: vi.fn(async () => []),
    customer: { findFirst: vi.fn() },
    instructor: { findFirst: vi.fn() },
    waMessage: { findUnique: vi.fn(), create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    waConversation: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    waCallbackRequest: { findFirst: vi.fn(), create: vi.fn() },
  },
  axiosPost: vi.fn(),
  openaiCreate: vi.fn(),
  sendEmail: vi.fn(),
  sendWhatsAppToChat: vi.fn(),
  getJevMode: vi.fn(),
  applyJevRouting: vi.fn(),
}));

vi.mock('../../utils/prisma.js', () => ({ prisma: h.prisma }));
vi.mock('axios', () => ({ default: { post: h.axiosPost, get: vi.fn() } }));
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: h.openaiCreate } };
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
vi.mock('../../services/jev-intent.js', () => ({
  getJevMode: h.getJevMode,
  applyJevRouting: h.applyJevRouting,
}));

import whatsappRouter from '../whatsapp.js';

const app = express();
app.use(express.json());
app.use('/api/wa', whatsappRouter);

const conv = {
  id: 'conv-1',
  phone: '972500000001',
  contactName: 'הורה',
  aiEnabled: true,
  intent: null,
  businessPhone: '+972533027763',
  phoneNumberId: 'pn-1',
};

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
          messages: [{ from: conv.phone, id: `wamid.${msgCounter}`, type: 'text', text: { body: text } }],
        },
      }],
    }],
  };
}

const flush = () => new Promise((r) => setTimeout(r, 30));

async function post(text: string) {
  await request(app).post('/api/wa/webhook').send(inbound(text)).expect(200);
  // Webhook responds immediately; let the async processing (and reply lock) settle.
  await flush();
  await flush();
}

const metaSends = () => h.axiosPost.mock.calls.filter(([url]) => String(url).includes('graph.facebook.com'));
const sentTexts = () => metaSends().map(([, body]) => body?.text?.body);
const CONFIRMATION = 'תודה! קיבלנו את בקשתך 😊 נציג מדרך ההייטק יחזור אליך בהקדם האפשרי.';

describe('WhatsApp webhook — Jev intent routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.prisma.$queryRaw.mockResolvedValue([]);
    h.prisma.customer.findFirst.mockResolvedValue(null);
    h.prisma.waMessage.findUnique.mockResolvedValue(null);
    h.prisma.waMessage.create.mockImplementation(async ({ data }: any) => ({ id: `db-${data.direction}`, ...data }));
    h.prisma.waMessage.findFirst.mockResolvedValue({ createdAt: new Date() }); // no quiet-wakeup alert
    h.prisma.waMessage.findMany.mockResolvedValue([{ direction: 'inbound', content: 'hi', createdAt: new Date() }]);
    h.prisma.waConversation.findFirst.mockResolvedValue({ ...conv });
    h.prisma.waConversation.update.mockResolvedValue({ ...conv });
    h.prisma.waConversation.findUnique.mockResolvedValue({ ...conv });
    h.prisma.waCallbackRequest.findFirst.mockResolvedValue(null);
    h.prisma.waCallbackRequest.create.mockResolvedValue({});
    h.axiosPost.mockResolvedValue({ data: { messages: [{ id: 'wamid.out' }] } });
    h.openaiCreate.mockResolvedValue({ choices: [{ message: { content: 'שלום! איך אפשר לעזור?' } }] });
    h.sendEmail.mockResolvedValue(undefined);
    h.getJevMode.mockReturnValue('off');
    h.applyJevRouting.mockResolvedValue('continue');
  });

  it('flag off: Jev is never invoked and the bot replies exactly as today', async () => {
    await post('כמה עולה קורס פייתון?');
    expect(h.applyJevRouting).not.toHaveBeenCalled();
    expect(h.openaiCreate).toHaveBeenCalledTimes(1);
    expect(metaSends()).toHaveLength(1);
    expect(h.prisma.waCallbackRequest.create).not.toHaveBeenCalled();
  });

  it('continue (new_lead/purchase, shadow, low confidence, errors): bot replies as today', async () => {
    h.getJevMode.mockReturnValue('on');
    h.applyJevRouting.mockResolvedValue('continue');
    await post('כמה עולה קורס פייתון?');
    expect(h.applyJevRouting).toHaveBeenCalledWith(expect.objectContaining({ id: 'conv-1' }), 'כמה עולה קורס פייתון?', 'db-inbound');
    expect(h.openaiCreate).toHaveBeenCalledTimes(1);
    expect(metaSends()).toHaveLength(1);
  });

  it('escalate (human/support/job): one confirmation reply + staff callback alert, no AI reply', async () => {
    h.getJevMode.mockReturnValue('on');
    h.applyJevRouting.mockResolvedValue('escalate');
    await post('אני מחפשת עבודה כמדריכה');
    expect(h.openaiCreate).not.toHaveBeenCalled();
    expect(sentTexts()).toEqual([CONFIRMATION]);
    expect(h.prisma.waCallbackRequest.create).toHaveBeenCalledTimes(1);
    expect(h.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'info@hai.tech' }));
  });

  it('escalate + callback keyword in the same message: confirmation sent exactly once', async () => {
    h.getJevMode.mockReturnValue('on');
    h.applyJevRouting.mockResolvedValue('escalate');
    await post('אפשר לדבר עם נציג?');
    expect(sentTexts()).toEqual([CONFIRMATION]);
    expect(h.prisma.waCallbackRequest.create).toHaveBeenCalledTimes(1);
  });

  it('after escalation the bot is off: a later callback-keyword message gets no second confirmation', async () => {
    h.getJevMode.mockReturnValue('on');
    h.applyJevRouting.mockResolvedValue('continue'); // intent already stored
    h.prisma.waConversation.findFirst.mockResolvedValue({ ...conv, aiEnabled: false, intent: 'human' });
    await post('אפשר שיחזרו אליי?');
    expect(sentTexts()).toEqual([]);
    expect(h.openaiCreate).not.toHaveBeenCalled();
  });

  it('acknowledge (irrelevant): one confirmation reply, no AI reply, no staff alert', async () => {
    h.getJevMode.mockReturnValue('on');
    h.applyJevRouting.mockResolvedValue('acknowledge');
    await post('Thank you for contacting us. We will reply soon.');
    expect(h.openaiCreate).not.toHaveBeenCalled();
    expect(sentTexts()).toEqual([CONFIRMATION]);
    expect(h.prisma.waCallbackRequest.create).not.toHaveBeenCalled();
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it('keyword callback path is unchanged when Jev says continue', async () => {
    h.getJevMode.mockReturnValue('shadow');
    h.applyJevRouting.mockResolvedValue('continue');
    await post('אפשר לדבר עם נציג?');
    expect(h.prisma.waCallbackRequest.create).toHaveBeenCalledTimes(1);
    expect(sentTexts()).toEqual([CONFIRMATION]); // confirmation message, as today
    expect(h.openaiCreate).not.toHaveBeenCalled();
  });
});
