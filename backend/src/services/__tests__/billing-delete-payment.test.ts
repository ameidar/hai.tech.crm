import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  billingPayment: {
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock('../../utils/prisma.js', () => ({ prisma: prismaMock }));

const tx = {
  billingPayment: {
    delete: vi.fn(),
    aggregate: vi.fn(),
    count: vi.fn(),
  },
  billingPeriod: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
};

import { deletePayment } from '../billing.js';

describe('deletePayment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation((fn) => fn(tx));
  });

  it('detaches a linked 320 tax-invoice/receipt when its last payment row is deleted', async () => {
    prismaMock.billingPayment.findUnique.mockResolvedValue({
      id: 'payment-1',
      billingPeriodId: 'period-1',
      morningReceiptId: 'morning-320-id',
    });
    tx.billingPeriod.findUnique.mockResolvedValue({
      id: 'period-1',
      totalAmount: 100,
      proformaSnapshot: null,
      paidAt: new Date('2026-06-10T00:00:00.000Z'),
      taxInvoiceId: 'morning-320-id',
      taxInvoiceType: 320,
    });
    tx.billingPayment.aggregate.mockResolvedValue({ _sum: { amount: null } });
    tx.billingPayment.count.mockResolvedValue(0);
    tx.billingPeriod.update.mockResolvedValue({ id: 'period-1' });

    await deletePayment('period-1', 'payment-1');

    expect(tx.billingPeriod.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        paidAmount: 0,
        paymentStatus: 'unpaid',
        paidAt: null,
        taxInvoiceId: null,
        taxInvoiceNumber: null,
        taxInvoiceUrl: null,
        taxInvoiceIssuedAt: null,
        taxInvoiceIssuedById: null,
        taxInvoiceType: null,
      }),
    }));
  });

  it('keeps the 320 link while other payment rows from the same Morning document remain', async () => {
    prismaMock.billingPayment.findUnique.mockResolvedValue({
      id: 'payment-1',
      billingPeriodId: 'period-1',
      morningReceiptId: 'morning-320-id',
    });
    tx.billingPeriod.findUnique.mockResolvedValue({
      id: 'period-1',
      totalAmount: 100,
      proformaSnapshot: null,
      paidAt: new Date('2026-06-10T00:00:00.000Z'),
      taxInvoiceId: 'morning-320-id',
      taxInvoiceType: 320,
    });
    tx.billingPayment.aggregate.mockResolvedValue({ _sum: { amount: 50 } });
    tx.billingPayment.count.mockResolvedValue(1);
    tx.billingPeriod.update.mockResolvedValue({ id: 'period-1' });

    await deletePayment('period-1', 'payment-1');

    expect(tx.billingPeriod.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ taxInvoiceId: null }),
    }));
  });
});
