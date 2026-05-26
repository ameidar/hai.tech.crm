import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../middleware/auth.js', () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
  salesOrAbove: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    customer: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    paymentLink: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../../services/morning/payment-forms.js', () => ({
  createPaymentForm: vi.fn(),
}));

vi.mock('../../services/morning/clients.js', () => ({
  findClientForCustomer: vi.fn(),
  createMorningClient: vi.fn(),
}));

import { paymentLinksRouter } from '../payment-links.js';
import { prisma } from '../../utils/prisma.js';
import { createPaymentForm } from '../../services/morning/payment-forms.js';
import { findClientForCustomer } from '../../services/morning/clients.js';
import { errorHandler } from '../../middleware/errorHandler.js';

const mockPrisma = vi.mocked(prisma);
const mockCreatePaymentForm = vi.mocked(createPaymentForm);
const mockFindClientForCustomer = vi.mocked(findClientForCustomer);

const app = express();
app.use(express.json());
app.use('/api/payment-links', paymentLinksRouter);
app.use(errorHandler);

describe('payment links', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreatePaymentForm.mockResolvedValue({ success: true, errorCode: 0, url: 'https://pay.example/form' });
    mockPrisma.paymentLink.findUnique.mockResolvedValue(null);
    mockPrisma.paymentLink.create.mockResolvedValue({ id: 'payment-link-id', code: 'abc23' } as any);
  });

  it('accepts legacy non-UUID CRM customer IDs from imported customers', async () => {
    mockPrisma.customer.findUnique.mockResolvedValue({
      id: '005e1efkwisqp3xhvitpmd05o',
      name: 'לקוח מיובא',
      email: null,
      phone: '0501234567',
      address: null,
      city: null,
      morningClientId: 'morning-client-id',
    } as any);

    const res = await request(app)
      .post('/api/payment-links')
      .set('Host', 'crm.test')
      .send({
        description: 'בדיקת תשלום',
        amount: 120,
        maxPayments: 4,
        customerId: '005e1efkwisqp3xhvitpmd05o',
        client: { name: 'לקוח מיובא', phone: '0501234567' },
      });

    expect(res.status).toBe(200);
    expect(mockPrisma.paymentLink.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        customerId: '005e1efkwisqp3xhvitpmd05o',
        maxPayments: 4,
      }),
    }));
  });

  it('does not require customer name or phone when creating a link', async () => {
    const res = await request(app)
      .post('/api/payment-links')
      .set('Host', 'crm.test')
      .send({
        description: 'לינק ללא פרטי לקוח',
        amount: 99,
        maxPayments: 1,
        client: {},
      });

    expect(res.status).toBe(200);
    expect(mockCreatePaymentForm).toHaveBeenCalledWith(expect.objectContaining({
      client: expect.objectContaining({ name: 'לקוח' }),
    }));
    expect(mockPrisma.paymentLink.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        clientName: 'לקוח',
        clientEmail: null,
        clientPhone: null,
      }),
    }));
  });

  it('stores maxPayments as an upper bound but creates the initial Morning URL as one payment', async () => {
    const res = await request(app)
      .post('/api/payment-links')
      .set('Host', 'crm.test')
      .send({
        description: 'עד ארבעה תשלומים',
        amount: 400,
        maxPayments: 4,
        client: { name: 'לקוח' },
      });

    expect(res.status).toBe(200);
    expect(mockCreatePaymentForm).toHaveBeenCalledWith(expect.objectContaining({ maxPayments: 1 }));
    expect(mockPrisma.paymentLink.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ maxPayments: 4 }),
    }));
    expect(res.body.maxPayments).toBe(4);
  });

  it('resolves and caches a Morning client only when a CRM customer is provided', async () => {
    mockPrisma.customer.findUnique.mockResolvedValue({
      id: 'legacy-customer-id',
      name: 'לקוח קיים',
      email: 'customer@example.com',
      phone: '0501234567',
      address: null,
      city: null,
      morningClientId: null,
    } as any);
    mockFindClientForCustomer.mockResolvedValue({ id: 'existing-morning-client' } as any);
    mockPrisma.customer.update.mockResolvedValue({} as any);

    const res = await request(app)
      .post('/api/payment-links')
      .set('Host', 'crm.test')
      .send({
        description: 'לקוח קיים',
        amount: 150,
        customerId: 'legacy-customer-id',
        client: { name: 'לקוח קיים' },
      });

    expect(res.status).toBe(200);
    expect(mockPrisma.customer.update).toHaveBeenCalledWith({
      where: { id: 'legacy-customer-id' },
      data: { morningClientId: 'existing-morning-client' },
    });
    expect(mockCreatePaymentForm).toHaveBeenCalledWith(expect.objectContaining({
      client: expect.objectContaining({ id: 'existing-morning-client' }),
    }));
  });
});
