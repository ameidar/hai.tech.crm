import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    customer: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    paymentLink: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    payment: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock('../../services/notifications.js', () => ({
  sendWhatsAppMessage: vi.fn(),
}));

import { morningWebhookRouter } from '../morning-webhook.js';
import { prisma } from '../../utils/prisma.js';
import { sendWhatsAppMessage } from '../../services/notifications.js';

const mockPrisma = vi.mocked(prisma);
const mockSendWhatsAppMessage = vi.mocked(sendWhatsAppMessage);

const app = express();
app.use(express.json());
app.use('/api/morning-webhook', morningWebhookRouter);

const paidPayload = {
  event: 'payment/received',
  data: {
    id: 'morning-doc-1',
    amount: 400,
    currency: 'ILS',
    description: 'חבילת שיעורים',
    type: 400,
    client: {
      name: 'שם מהסולק',
      phone: '0501234567',
      email: 'payer@example.com',
    },
  },
};

describe('Morning webhook payment-link sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.payment.findFirst.mockResolvedValue(null);
    mockPrisma.payment.create.mockResolvedValue({ id: 'payment-id' } as any);
    mockSendWhatsAppMessage.mockResolvedValue(undefined as any);
  });

  it('attaches the paid payment to the CRM customer selected on the payment link', async () => {
    mockPrisma.paymentLink.findUnique.mockResolvedValue({
      id: 'link-id',
      code: 'abc23',
      customerId: 'selected-customer-id',
      clientName: 'לקוח מהלינק',
      clientPhone: '0500000000',
      clientEmail: 'link@example.com',
    } as any);
    mockPrisma.customer.findUnique.mockResolvedValue({
      id: 'selected-customer-id',
      name: 'לקוח קיים',
      phone: null,
      email: null,
    } as any);
    mockPrisma.customer.update.mockResolvedValue({
      id: 'selected-customer-id',
      name: 'לקוח קיים',
      phone: '972501234567',
      email: 'payer@example.com',
    } as any);

    const res = await request(app)
      .post('/api/morning-webhook?paymentLinkCode=abc23')
      .send(paidPayload);

    expect(res.status).toBe(200);
    expect(res.body.customerId).toBe('selected-customer-id');
    expect(mockPrisma.customer.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        customerId: 'selected-customer-id',
        status: 'paid',
        amount: 400,
        description: expect.stringContaining('[payment-link:abc23]'),
      }),
    }));
  });

  it('creates a customer and connects the payment when the link was not tied to a CRM customer', async () => {
    mockPrisma.paymentLink.findUnique.mockResolvedValue({
      id: 'link-id',
      code: 'def45',
      customerId: null,
      clientName: 'לקוח חדש מהלינק',
      clientPhone: '0507654321',
      clientEmail: 'new@example.com',
    } as any);
    mockPrisma.customer.findFirst.mockResolvedValue(null);
    mockPrisma.customer.create.mockResolvedValue({
      id: 'new-customer-id',
      name: 'שם מהסולק',
      phone: '972501234567',
      email: 'payer@example.com',
    } as any);

    const res = await request(app)
      .post('/api/morning-webhook?paymentLinkCode=def45')
      .send(paidPayload);

    expect(res.status).toBe(200);
    expect(res.body.customerId).toBe('new-customer-id');
    expect(res.body.isNewCustomer).toBe(true);
    expect(mockPrisma.customer.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        name: 'שם מהסולק',
        phone: '972501234567',
        email: 'payer@example.com',
        source: 'payment_link',
      }),
    }));
    expect(mockPrisma.paymentLink.update).toHaveBeenCalledWith({
      where: { id: 'link-id' },
      data: { customerId: 'new-customer-id' },
    });
    expect(mockPrisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ customerId: 'new-customer-id' }),
    }));
  });

  it('ignores duplicate payment-link webhook retries', async () => {
    mockPrisma.paymentLink.findUnique.mockResolvedValue({
      id: 'link-id',
      code: 'dup99',
      customerId: 'customer-id',
      clientName: 'לקוח',
    } as any);
    mockPrisma.customer.findUnique.mockResolvedValue({ id: 'customer-id', name: 'לקוח' } as any);
    mockPrisma.payment.findFirst.mockResolvedValue({ id: 'existing-payment-id' } as any);

    const res = await request(app)
      .post('/api/morning-webhook?paymentLinkCode=dup99')
      .send(paidPayload);

    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe(true);
    expect(mockPrisma.payment.create).not.toHaveBeenCalled();
  });
});
