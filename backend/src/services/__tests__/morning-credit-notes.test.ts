import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    payment: { findMany: vi.fn(), update: vi.fn() },
    registration: { findMany: vi.fn(), update: vi.fn() },
    billingPayment: { findMany: vi.fn(), update: vi.fn() },
  },
}));
vi.mock('../../utils/audit.js', () => ({ logAudit: vi.fn() }));
vi.mock('../morning/documents.js', () => ({ getMorningDocument: vi.fn() }));
vi.mock('../lead-payment-evidence.js', () => ({
  autoConvertLeadsForPayment: vi.fn(),
  autoConvertLeadsForRegistration: vi.fn(),
}));
vi.mock('../omer-payment-reconciliation.js', () => ({
  findReconcilableOmerRegistrations: vi.fn(),
  reconcileOmerRegistrationPayment: vi.fn(),
}));
vi.mock('../morning-payment-link.js', () => ({ extractMorningRef: vi.fn(), settleMorningPaymentByRef: vi.fn() }));

import { prisma } from '../../utils/prisma.js';
import { logAudit } from '../../utils/audit.js';
import { getMorningDocument } from '../morning/documents.js';
import { applyMorningCreditNote, creditNoteTag } from '../morning-credit-notes.js';

const mockPrisma = vi.mocked(prisma, true);
const ORIG_ID = 'orig-uuid-1';

const credit = {
  id: 'credit-uuid-1',
  number: 50012,
  type: 330,
  amount: 2980,
  documentDate: '2026-11-14',
  linkedDocuments: [{ id: ORIG_ID, type: 320, number: 65297, documentDate: '2026-11-01', amount: 2980 }],
};

function payment(overrides: Record<string, any> = {}) {
  return {
    id: 'pay-1',
    amount: 2980,
    status: 'paid',
    description: `קורס שנתי #65297 [morning-doc:${ORIG_ID}]`,
    invoiceNumber: '65297',
    ...overrides,
  };
}

describe('applyMorningCreditNote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.payment.findMany.mockResolvedValue([] as any);
    mockPrisma.registration.findMany.mockResolvedValue([] as any);
    mockPrisma.billingPayment.findMany.mockResolvedValue([] as any);
  });

  it('refunds a payment tagged with the original doc id and appends the note', async () => {
    mockPrisma.payment.findMany.mockResolvedValue([payment()] as any);

    const result = await applyMorningCreditNote(credit);

    expect(result).toEqual(expect.objectContaining({ outcome: 'refunded', paymentIds: ['pay-1'] }));
    const where = mockPrisma.payment.findMany.mock.calls[0][0]!.where as any;
    expect(where.OR).toEqual(expect.arrayContaining([
      { description: { contains: `[morning-doc:${ORIG_ID}]` } },
      { invoiceNumber: { in: ['65297'] } },
    ]));
    expect(mockPrisma.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: {
        status: 'refunded',
        description: `קורס שנתי #65297 [morning-doc:${ORIG_ID}] [זוכה אוטומטית 14.11 – זיכוי מורנינג 50012]`,
      },
    });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ entity: 'payment', entityId: 'pay-1' }));
  });

  it('matches by invoice_number, also without leading zeros', async () => {
    mockPrisma.payment.findMany.mockResolvedValue([payment({ description: 'Woo order', invoiceNumber: '65297' })] as any);

    const result = await applyMorningCreditNote({
      ...credit,
      linkedDocuments: [{ id: ORIG_ID, type: 320, number: '065297' as any, amount: 2980 }],
    });

    const where = mockPrisma.payment.findMany.mock.calls[0][0]!.where as any;
    expect(where.OR).toEqual(expect.arrayContaining([{ invoiceNumber: { in: ['065297', '65297'] } }]));
    expect(result.outcome).toBe('refunded');
  });

  it('ignores a number-only match that is tagged with a different Morning doc', async () => {
    mockPrisma.payment.findMany.mockResolvedValue([
      payment({ description: 'other doc [morning-doc:someone-else]' }),
    ] as any);

    const result = await applyMorningCreditNote(credit);

    expect(result.outcome).toBe('not_found');
    expect(mockPrisma.payment.update).not.toHaveBeenCalled();
  });

  it('partial credit: keeps status, appends a note, returns partial', async () => {
    mockPrisma.payment.findMany.mockResolvedValue([payment()] as any);

    const result = await applyMorningCreditNote({ ...credit, amount: 1000 });

    expect(result.outcome).toBe('partial');
    const call = mockPrisma.payment.update.mock.calls[0][0] as any;
    expect(call.data.status).toBeUndefined();
    expect(call.data.description).toContain('זיכוי חלקי ₪1000 – זיכוי מורנינג 50012');
  });

  it('is idempotent: already refunded / already noted payments are skipped', async () => {
    mockPrisma.payment.findMany.mockResolvedValue([
      payment({ status: 'refunded', description: `x [morning-doc:${ORIG_ID}] [זוכה אוטומטית 14.11 – זיכוי מורנינג 50012]` }),
    ] as any);

    const result = await applyMorningCreditNote(credit);

    expect(result.outcome).toBe('already');
    expect(mockPrisma.payment.update).not.toHaveBeenCalled();
  });

  it('fetches the full document when the payload has no linkedDocuments', async () => {
    vi.mocked(getMorningDocument).mockResolvedValue({ ...credit } as any);
    mockPrisma.payment.findMany.mockResolvedValue([payment()] as any);

    const { linkedDocuments: _omit, ...bare } = credit;
    const result = await applyMorningCreditNote(bare);

    expect(getMorningDocument).toHaveBeenCalledWith('credit-uuid-1');
    expect(result.outcome).toBe('refunded');
  });

  it('returns not_found when nothing matches, and ignores non-credit types', async () => {
    expect((await applyMorningCreditNote(credit)).outcome).toBe('not_found');
    expect((await applyMorningCreditNote({ ...credit, type: 320 })).outcome).toBe('not_found');
    expect(mockPrisma.payment.findMany).toHaveBeenCalledTimes(1);
  });

  it('marks a registration whose invoice_link is the original receipt as refunded', async () => {
    mockPrisma.registration.findMany.mockResolvedValue([
      { id: 'reg-1', amount: 2980, paymentStatus: 'paid', notes: null, creditInvoiceLink: null },
    ] as any);

    const result = await applyMorningCreditNote(credit);

    expect(result.outcome).toBe('refunded');
    expect(result.registrationIds).toEqual(['reg-1']);
    expect(mockPrisma.registration.update).toHaveBeenCalledWith({
      where: { id: 'reg-1' },
      data: expect.objectContaining({
        paymentStatus: 'refunded',
        refundAmount: 2980,
        creditInvoiceLink: 'https://app.greeninvoice.co.il/incomes/documents/credit-uuid-1',
        notes: '[זוכה אוטומטית 14.11 – זיכוי מורנינג 50012]',
      }),
    });
  });

  it('only notes billing_payments and reports them for admin review', async () => {
    mockPrisma.billingPayment.findMany.mockResolvedValue([
      { id: 'bp-1', billingPeriodId: 'bper-1', amount: 5000, notes: 'העברה' },
    ] as any);

    const result = await applyMorningCreditNote({
      ...credit,
      linkedDocuments: [{ id: 'rcpt-400', type: 400, number: 1234, amount: 5000 }],
    });

    expect(result.billingMatches).toEqual([{ id: 'bp-1', billingPeriodId: 'bper-1', amount: 5000, noted: true }]);
    const call = mockPrisma.billingPayment.update.mock.calls[0][0] as any;
    expect(Object.keys(call.data)).toEqual(['notes']);
    expect(call.data.notes).toContain('זיכוי מורנינג 50012');
  });
});

describe('creditNoteTag', () => {
  it('formats DD.MM from the document date', () => {
    expect(creditNoteTag('77', '2026-03-05')).toBe('[זוכה אוטומטית 05.03 – זיכוי מורנינג 77]');
  });
});
