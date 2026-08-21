import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    customer: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    payment: {
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock('../trial-placement.js', () => ({
  handlePostPaymentPlacement: vi.fn(),
}));

vi.mock('../omer-payment-reconciliation.js', () => ({
  reconcileOmerRegistrationPayment: vi.fn(),
}));

import { prisma } from '../../utils/prisma.js';
import { handlePostPaymentPlacement } from '../trial-placement.js';
import { reconcileOmerRegistrationPayment } from '../omer-payment-reconciliation.js';
import { syncRecentWooPayments, upsertWooOrderPayment } from '../woo-sync.js';

const mockPrisma = vi.mocked(prisma);
const mockPlacement = vi.mocked(handlePostPaymentPlacement);
const mockReconcileOmerRegistrationPayment = vi.mocked(reconcileOmerRegistrationPayment);

describe('Woo payment sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WOO_SITE_URL = 'https://woo.test';
    process.env.WOO_CONSUMER_KEY = 'ck_test';
    process.env.WOO_CONSUMER_SECRET = 'cs_test';
    mockReconcileOmerRegistrationPayment.mockResolvedValue({ status: 'skipped', reason: 'no_matching_registration' } as any);
  });

  it('skips a new pending order instead of creating a premature payment', async () => {
    mockPrisma.payment.findFirst.mockResolvedValue(null);

    const result = await upsertWooOrderPayment({
      id: 40423,
      status: 'pending',
      total: '497',
      billing: { email: 'buyer@example.com' },
    });

    expect(result).toEqual({ action: 'skipped_pending', orderId: 40423 });
    expect(mockPrisma.payment.create).not.toHaveBeenCalled();
  });

  it('creates a missing paid Woo order and links an existing CRM customer by email', async () => {
    mockPrisma.payment.findFirst.mockResolvedValue(null);
    mockPrisma.customer.findFirst.mockResolvedValue({
      id: 'customer-id',
      name: 'Existing Customer',
      email: 'buyer@example.com',
    } as any);
    mockPrisma.payment.create.mockResolvedValue({ id: 'payment-id' } as any);

    const result = await upsertWooOrderPayment({
      id: 40423,
      status: 'on-hold',
      total: '497',
      date_modified: '2026-07-07T13:48:03',
      payment_method: 'greeninvoice-creditcard',
      billing: { first_name: 'Gilad', last_name: 'Steinberg LTD', email: 'buyer@example.com', phone: '' },
      fee_lines: [{ name: 'קורס מיינקראפט + JavaScript' }],
    });

    expect(result).toEqual({ action: 'created', orderId: 40423, paymentId: 'payment-id' });
    expect(mockPrisma.customer.findFirst).toHaveBeenCalledWith({ where: { email: 'buyer@example.com' } });
    expect(mockPrisma.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        wooOrderId: 40423,
        amount: 497,
        description: 'קורס מיינקראפט + JavaScript',
        status: 'paid',
        paymentMethod: 'greeninvoice-creditcard',
        customerName: 'Gilad Steinberg LTD',
        customerEmail: 'buyer@example.com',
        customerId: 'customer-id',
      }),
    });
    expect(mockPlacement).not.toHaveBeenCalled();
    expect(mockReconcileOmerRegistrationPayment).toHaveBeenCalledWith('payment-id');
  });

  it('backup sync scans recent paid Woo orders and creates missing payments', async () => {
    mockPrisma.payment.findFirst.mockResolvedValue(null);
    mockPrisma.customer.findFirst.mockResolvedValue({ id: 'customer-id' } as any);
    mockPrisma.payment.create.mockResolvedValue({ id: 'payment-id' } as any);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{
        id: 40423,
        status: 'on-hold',
        total: '497',
        billing: { email: 'buyer@example.com' },
        fee_lines: [{ name: 'קורס מיינקראפט + JavaScript' }],
      }],
    }));

    const result = await syncRecentWooPayments(1);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/wp-json/wc/v3/orders?'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: expect.stringMatching(/^Basic /) }) })
    );
    expect(result).toMatchObject({ ok: true, created: 1, updated: 0, skipped: 0, failed: 0, total: 1, days: 1 });
  });
});
