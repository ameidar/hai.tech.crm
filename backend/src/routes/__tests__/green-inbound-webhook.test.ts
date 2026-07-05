import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    customer: {
      findFirst: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    waConversation: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    waMessage: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    leadActivity: {
      create: vi.fn(),
    },
    leadAppointment: {
      update: vi.fn(),
    },
  },
}));

vi.mock('../../services/notifications.js', () => ({
  sendWelcomeNotifications: vi.fn(),
  notifyAdminNewLead: vi.fn(),
}));

vi.mock('../../utils/lead-dedup.js', () => ({
  findOrCreateLeadAppointment: vi.fn(),
}));

vi.mock('../../services/whatsapp-reminder.service.js', () => ({
  handleStatusReply: vi.fn(),
}));

vi.mock('../../utils/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../../services/lead-welcome.js', () => ({
  sendLeadWelcomeTemplate: vi.fn(),
}));

vi.mock('../../services/wa-events.js', () => ({
  broadcastWaSSE: vi.fn(),
}));

vi.mock('../../utils/revenue.js', () => ({
  meetingRevenueFromRegistrations: vi.fn(),
  revenueRegistrationCount: vi.fn(),
  roundMoney: vi.fn(),
}));

vi.mock('../../services/instructor-payment.js', () => ({
  calculateInstructorPayment: vi.fn(),
  recalculateDailyInstructorPaymentsForMeeting: vi.fn(),
}));

import { prisma } from '../../utils/prisma.js';
import { broadcastWaSSE } from '../../services/wa-events.js';
import { webhookRouter } from '../webhook.js';

const app = express();
app.use(express.json());
app.use('/api/webhook', webhookRouter);

const greenPayload = {
  typeWebhook: 'incomingMessageReceived',
  idMessage: 'green-msg-1',
  senderData: { chatId: '972528746137@c.us' },
  messageData: {
    typeMessage: 'textMessage',
    textMessageData: { textMessage: 'היי, אשמח לפרטים' },
  },
};

async function waitForWebhookWork() {
  await new Promise(resolve => setImmediate(resolve));
}

describe('POST /api/webhook/whatsapp-incoming — Green inbound CRM routing', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    (prisma.customer.findFirst as any).mockResolvedValue(null);
    (prisma.auditLog.create as any).mockResolvedValue({ id: 'audit-1' });
    (prisma.waConversation.findFirst as any).mockResolvedValue({ id: 'conv-1', businessPhone: null });
    (prisma.waConversation.create as any).mockResolvedValue({ id: 'conv-1', businessPhone: 'Green API' });
    (prisma.waConversation.update as any).mockResolvedValue({ id: 'conv-1' });
    (prisma.waMessage.findUnique as any).mockResolvedValue(null);
    (prisma.waMessage.create as any).mockResolvedValue({
      id: 'wa-message-1',
      conversationId: 'conv-1',
      direction: 'inbound',
      content: 'היי, אשמח לפרטים',
      waMessageId: 'green:green-msg-1',
      status: 'received',
      isAiGenerated: false,
      createdAt: new Date(),
    });
    (prisma.leadActivity.create as any).mockResolvedValue({ id: 'activity-1' });
    (prisma.leadAppointment.update as any).mockResolvedValue({ id: 'lead-1' });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('stores Green inbound replies on the customer and marks a recent open lead as replied', async () => {
    const customer = { id: 'customer-1', name: 'עמי', phone: '+972528746137', email: null };
    const lead = {
      id: 'lead-1',
      customer_id: null,
      customer_name: 'עמי',
      customer_phone: '052-874-6137',
      sales_status: 'new',
    };

    (prisma.$queryRaw as any)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([customer])
      .mockResolvedValueOnce([lead]);

    await request(app).post('/api/webhook/whatsapp-incoming').send(greenPayload).expect(200);
    await waitForWebhookWork();

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userName: 'Green API',
        action: 'CREATE',
        entity: 'communication_whatsapp',
        entityId: 'customer-1',
        newValue: expect.objectContaining({
          direction: 'inbound',
          provider: 'green',
          source: 'green_webhook',
          phone: '972528746137',
          chatId: '972528746137@c.us',
          message: 'היי, אשמח לפרטים',
          greenMessageId: 'green-msg-1',
          customerId: 'customer-1',
          leadAppointmentId: 'lead-1',
        }),
      }),
    });
    expect(prisma.waConversation.findFirst).toHaveBeenCalledWith({
      where: { phone: '972528746137' },
      orderBy: { lastMessageAt: 'desc' },
    });
    expect(prisma.waMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        conversationId: 'conv-1',
        direction: 'inbound',
        content: 'היי, אשמח לפרטים',
        waMessageId: 'green:green-msg-1',
        status: 'received',
      }),
    });
    expect(prisma.waConversation.update).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: expect.objectContaining({
        unreadCount: { increment: 1 },
        lastMessagePreview: 'היי, אשמח לפרטים',
        contactName: 'עמי',
        businessPhone: 'Green API',
        aiEnabled: false,
      }),
    });
    expect(broadcastWaSSE).toHaveBeenCalledWith('new_message', expect.objectContaining({
      conversationId: 'conv-1',
      phone: '972528746137',
      contactName: 'עמי',
      provider: 'green',
    }));
    expect(prisma.leadActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leadAppointmentId: 'lead-1',
        type: 'whatsapp',
        result: 'green_reply',
        note: expect.stringContaining('היי, אשמח לפרטים'),
      }),
    });
    expect(prisma.leadAppointment.update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: expect.objectContaining({
        customerId: 'customer-1',
        salesStatus: 'follow_up',
        lastContactResult: 'green_reply',
      }),
    });
  });

  it('stores the customer message without creating lead activity when no recent open lead exists', async () => {
    const customer = { id: 'customer-1', name: 'עמי', phone: '+972528746137', email: null };

    (prisma.$queryRaw as any)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([customer])
      .mockResolvedValueOnce([]);

    await request(app).post('/api/webhook/whatsapp-incoming').send(greenPayload).expect(200);
    await waitForWebhookWork();

    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.waMessage.create).toHaveBeenCalledTimes(1);
    expect(prisma.leadActivity.create).not.toHaveBeenCalled();
    expect(prisma.leadAppointment.update).not.toHaveBeenCalled();
  });

  it('ignores duplicate Green messages by greenMessageId', async () => {
    (prisma.$queryRaw as any).mockResolvedValueOnce([{ id: 'audit-existing' }]);

    await request(app).post('/api/webhook/whatsapp-incoming').send(greenPayload).expect(200);
    await waitForWebhookWork();

    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(prisma.waMessage.create).not.toHaveBeenCalled();
    expect(prisma.leadActivity.create).not.toHaveBeenCalled();
    expect(prisma.leadAppointment.update).not.toHaveBeenCalled();
  });
});
