import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.GREEN_API_INSTANCE_ID = '7103104732';
  process.env.GREEN_API_TOKEN = 'token';
  process.env.GREEN_API_FALLBACK_INSTANCE_ID = '7103320181';
  process.env.GREEN_API_FALLBACK_TOKEN = 'fallback-token';
});

vi.mock('../../middleware/auth.js', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1', id: 'user-1', name: 'עמי', email: 'ami@example.com', role: 'admin' };
    next();
  },
}));

vi.mock('../../utils/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../../services/wa-events.js', () => ({
  broadcastWaSSE: vi.fn(),
}));

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    customer: {
      findFirst: vi.fn(),
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
  },
}));

import { prisma } from '../../utils/prisma.js';
import { logAudit } from '../../utils/audit.js';
import { broadcastWaSSE } from '../../services/wa-events.js';
import { clearGreenApiHealthCacheForTests } from '../../services/green-api-client.js';
import { communicationRouter } from '../communication.js';

const app = express();
app.use(express.json());
app.use('/api/communication', communicationRouter);

describe('POST /api/communication/whatsapp — Green outbound CRM thread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearGreenApiHealthCacheForTests();

    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/getStateInstance/')) {
        return { ok: true, status: 200, json: async () => ({ stateInstance: 'authorized' }) };
      }
      if (url.includes('/getStatusInstance/')) {
        return { ok: true, status: 200, json: async () => ({ statusInstance: 'online' }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ idMessage: 'outbound-green-1' }),
      };
    }) as any;

    (prisma.customer.findFirst as any).mockResolvedValue({ name: 'ישראל ישראלי' });
    (prisma.waMessage.findUnique as any).mockResolvedValue(null);
    (prisma.waConversation.findFirst as any).mockResolvedValue({
      id: 'conv-1',
      contactName: 'ישראל ישראלי',
      businessPhone: 'Green API',
    });
    (prisma.waMessage.create as any).mockResolvedValue({
      id: 'msg-1',
      conversationId: 'conv-1',
      direction: 'outbound',
      content: 'בודק שליחה',
      waMessageId: 'green:outbound-green-1',
      status: 'sent',
      isAiGenerated: false,
      createdAt: new Date(),
    });
    (prisma.waConversation.update as any).mockResolvedValue({ id: 'conv-1' });
  });

  it('stores successful Green outbound sends as WhatsApp Green thread messages', async () => {
    await request(app)
      .post('/api/communication/whatsapp')
      .send({
        phone: '052-123-4567',
        message: 'בודק שליחה',
        customerId: 'customer-1',
        customerName: 'ישראל ישראלי',
      })
      .expect(200);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.green-api.com/waInstance7103104732/sendMessage/token',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ chatId: '972521234567@c.us', message: 'בודק שליחה' }),
      }),
    );
    expect(prisma.waConversation.findFirst).toHaveBeenCalledWith({
      where: { phone: '972521234567' },
      orderBy: { lastMessageAt: 'desc' },
    });
    expect(prisma.waMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        conversationId: 'conv-1',
        direction: 'outbound',
        content: 'בודק שליחה',
        waMessageId: 'green:outbound-green-1',
        status: 'sent',
        isAiGenerated: false,
      }),
    });
    expect(prisma.waConversation.update).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: expect.objectContaining({
        lastMessagePreview: 'בודק שליחה',
        contactName: 'ישראל ישראלי',
        businessPhone: 'Green API',
        aiEnabled: false,
      }),
    });
    expect(broadcastWaSSE).toHaveBeenCalledWith('new_message', expect.objectContaining({
      conversationId: 'conv-1',
      provider: 'green',
      phone: '972521234567',
    }));
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      entity: 'communication_whatsapp',
      entityId: 'customer-1',
    }));
  });

  it('falls back to the second Green instance when the primary is yellowCard/offline', async () => {
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/waInstance7103104732/getStateInstance/')) {
        return { ok: true, status: 200, json: async () => ({ stateInstance: 'yellowCard' }) };
      }
      if (url.includes('/waInstance7103104732/getStatusInstance/')) {
        return { ok: true, status: 200, json: async () => ({ statusInstance: 'offline' }) };
      }
      if (url.includes('/waInstance7103320181/getStateInstance/')) {
        return { ok: true, status: 200, json: async () => ({ stateInstance: 'authorized' }) };
      }
      if (url.includes('/waInstance7103320181/getStatusInstance/')) {
        return { ok: true, status: 200, json: async () => ({ statusInstance: 'online' }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ idMessage: 'fallback-green-1' }),
      };
    }) as any;

    await request(app)
      .post('/api/communication/whatsapp')
      .send({
        phone: '052-123-4567',
        message: 'בודק fallback',
        customerId: 'customer-1',
        customerName: 'ישראל ישראלי',
      })
      .expect(200);

    expect(global.fetch).not.toHaveBeenCalledWith(
      'https://api.green-api.com/waInstance7103104732/sendMessage/token',
      expect.anything(),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.green-api.com/waInstance7103320181/sendMessage/fallback-token',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ chatId: '972521234567@c.us', message: 'בודק fallback' }),
      }),
    );
    expect(prisma.waMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        waMessageId: 'green:fallback-green-1',
      }),
    });
  });
});
