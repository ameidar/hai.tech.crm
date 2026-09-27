import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.API_KEY = process.env.API_KEY || 'test-api-key';
process.env.WOO_SITE_URL = 'https://woo.test';
process.env.WOO_CONSUMER_KEY = 'ck_test';
process.env.WOO_CONSUMER_SECRET = 'cs_test';
process.env.BASE_URL = 'https://crm.test';

vi.mock('../../middleware/auth.js', () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../config.js', () => ({
  config: {
    woo: {
      siteUrl: 'https://woo.test',
      consumerKey: 'ck_test',
      consumerSecret: 'cs_test',
    },
    morning: {
      apiKeyId: 'morning-key-id',
      apiSecret: 'morning-secret',
      baseUrl: 'https://api.greeninvoice.co.il',
    },
  },
}));

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    customer: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    payment: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock('../../services/trial-placement.js', () => ({
  handlePostPaymentPlacement: vi.fn(),
}));

vi.mock('../../services/omer-payment-reconciliation.js', () => ({
  reconcileOmerRegistrationPayment: vi.fn(),
}));

import { prisma } from '../../utils/prisma.js';
import { inferDigitalCourseProductId, paymentsRouter } from '../payments.js';

const mockPrisma = vi.mocked(prisma);

const app = express();
app.use(express.json());
app.use('/api/payments', paymentsRouter);

describe('payments create-link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.payment.create.mockResolvedValue({ id: 'payment-id' } as any);
    vi.stubGlobal('fetch', vi.fn());
  });

  it('maps known digital course descriptions to Woo product IDs', () => {
    expect(inferDigitalCourseProductId('קורס בניית עולמות במיינקראפט', 497)).toBe(30688);
    expect(inferDigitalCourseProductId("קורס תכנות בסקראץ'", 497)).toBe(30857);
    expect(inferDigitalCourseProductId('קורס רובלוקס - פיתוח משחקים עם Lua', 497)).toBe(30772);
  });

  it('creates digital-course Woo orders as product line items for the buyer, not crm-payments fee orders', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify([{ id: 901, email: 'ami@hai.tech' }]),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 40510, order_key: 'wc_order_key' }),
      } as any);

    const res = await request(app)
      .post('/api/payments/create-link')
      .send({
        customerName: 'עמי מידר',
        customerEmail: 'ami@hai.tech',
        customerPhone: '',
        amount: 497,
        description: 'קורס בניית עולמות במיינקראפט',
      });

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://woo.test/wp-json/wc/v3/orders',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(String),
      })
    );
    const orderPayload = JSON.parse((fetchMock.mock.calls[1][1] as any).body);
    expect(orderPayload.customer_id).toBe(901);
    expect(orderPayload.fee_lines).toBeUndefined();
    expect(orderPayload.line_items).toEqual([{ product_id: 30688, quantity: 1, total: '497.00' }]);
    expect(orderPayload.billing.email).toBe('ami@hai.tech');
    expect(res.body.wooProductId).toBe(30688);
    expect(res.body.wooCustomerId).toBe(901);
  });

  it('returns direct order-pay checkout URLs after installment confirmation', async () => {
    mockPrisma.payment.findUnique.mockResolvedValue({
      id: 'payment-id',
      wooOrderId: 40510,
      wooOrderKey: 'wc_order_key',
      status: 'pending',
      description: 'קורס בניית עולמות במיינקראפט',
      maxInstallments: 4,
    } as any);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ fee_lines: [] }),
    } as any);

    const res = await request(app)
      .post('/api/payments/pay-page/pay-token/confirm')
      .send({ installments: 2 });

    expect(res.status).toBe(200);
    expect(res.body.checkoutUrl).toBe('https://woo.test/checkout/order-pay/40510/?pay_for_order=true&key=wc_order_key');
    expect(res.body.checkoutUrl).not.toContain('haitech_pay=1');
  });
});
