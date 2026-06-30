import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  billingPeriod: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  billingPeriodLine: {
    deleteMany: vi.fn(),
  },
  cycle: {
    findMany: vi.fn(),
  },
}));

vi.mock('../../utils/prisma.js', () => ({ prisma: prismaMock }));

import { generateBillingPeriod } from '../billing.js';

describe('generateBillingPeriod cancelled periods', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.billingPeriod.findFirst.mockResolvedValue(null);
    prismaMock.billingPeriodLine.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.cycle.findMany.mockResolvedValue([]);
  });

  it('revives a cancelled period as a fresh draft and clears old Morning proforma links', async () => {
    prismaMock.billingPeriod.findUnique.mockResolvedValue({
      id: 'period-1',
      institutionalOrderId: 'order-1',
      monthStart: new Date('2026-05-01T00:00:00.000Z'),
      monthEnd: new Date('2026-05-01T00:00:00.000Z'),
      status: 'cancelled',
      totalAmount: 100,
      paidAmount: 0,
      taxInvoiceId: null,
      taxInvoiceNumber: null,
      issuedAt: new Date('2026-05-31T00:00:00.000Z'),
      issuedById: 'user-old',
      morningDocId: 'morning-doc-1',
      morningDocNumber: 4321,
      morningDocUrl: 'https://example.test/doc',
      morningDocType: 300,
      morningDraftId: 'draft-old',
      morningClientName: 'לקוח ישן',
      proformaSource: 'manual_morning',
      proformaSnapshot: { grossTotal: 118 },
      lines: [{ cycleId: 'cycle-1', descriptionCustomized: true, description: 'custom' }],
    });
    prismaMock.billingPeriod.update.mockResolvedValue({ id: 'period-1', status: 'draft', lines: [] });

    await generateBillingPeriod('order-1', '2026-05', '2026-05', 'user-new');

    expect(prismaMock.billingPeriod.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'period-1' },
      data: expect.objectContaining({
        status: 'draft',
        totalAmount: 0,
        generatedById: 'user-new',
        morningDocId: null,
        morningDocNumber: null,
        morningDocUrl: null,
        morningDocType: null,
        morningDraftId: null,
        morningClientName: null,
        proformaSource: null,
        issuedAt: null,
        issuedById: null,
      }),
    }));
  });

  it('still refuses to regenerate a cancelled period with a binding tax document', async () => {
    prismaMock.billingPeriod.findUnique.mockResolvedValue({
      id: 'period-1',
      status: 'cancelled',
      paidAmount: 0,
      taxInvoiceId: 'tax-doc-1',
      taxInvoiceNumber: 1234,
      lines: [],
    });

    await expect(generateBillingPeriod('order-1', '2026-05', '2026-05')).rejects.toThrow(/binding tax document/);
    expect(prismaMock.billingPeriod.update).not.toHaveBeenCalled();
  });
});
