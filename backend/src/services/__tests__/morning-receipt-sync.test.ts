import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    payment: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    customer: {
      findMany: vi.fn(),
    },
    registration: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../lead-payment-evidence.js', () => ({
  autoConvertLeadsForPayment: vi.fn(),
  autoConvertLeadsForRegistration: vi.fn(),
}));

vi.mock('../omer-payment-reconciliation.js', () => ({
  findReconcilableOmerRegistrations: vi.fn(),
  reconcileOmerRegistrationPayment: vi.fn(),
}));

vi.mock('../morning/client.js', () => ({
  isMorningConfigured: vi.fn(() => true),
}));

vi.mock('../morning/documents.js', () => ({
  searchMorningDocuments: vi.fn(),
}));

import { prisma } from '../../utils/prisma.js';
import {
  findReconcilableOmerRegistrations,
  reconcileOmerRegistrationPayment,
} from '../omer-payment-reconciliation.js';
import { searchMorningDocuments } from '../morning/documents.js';
import { processMorningReceipt, syncRecentMorningReceipts } from '../morning-receipt-sync.js';

const mockPrisma = vi.mocked(prisma);
const mockFindRegs = vi.mocked(findReconcilableOmerRegistrations);
const mockReconcile = vi.mocked(reconcileOmerRegistrationPayment);
const mockSearch = vi.mocked(searchMorningDocuments);

const receipt = {
  id: 'doc-uuid-1',
  number: 65252,
  type: 320,
  documentDate: '2026-10-06',
  status: 1,
  amount: 2980,
  client: { name: 'אלה בלוסטוצקי', phone: '0527561012' },
  income: [{ description: 'עומר פרונטלי תכנית שנתית', quantity: 1, price: 2980 }],
};

describe('processMorningReceipt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.payment.findFirst.mockResolvedValue(null);
    mockPrisma.customer.findMany.mockResolvedValue([
      { id: 'customer-1', name: 'אלה בליסטוצקי', phone: '972527561012' },
    ] as any);
    mockFindRegs.mockResolvedValue([{ id: 'registration-1' }] as any);
    mockPrisma.payment.create.mockResolvedValue({ id: 'payment-1' } as any);
    mockReconcile.mockResolvedValue({ status: 'updated', registrationId: 'registration-1', paymentStatus: 'paid' });
    mockPrisma.registration.findFirst.mockResolvedValue(null);
    mockPrisma.registration.findMany.mockResolvedValue([]);
  });

  it('records the receipt and reconciles the single unpaid Omer registration', async () => {
    const result = await processMorningReceipt(receipt as any);

    expect(result).toEqual({ outcome: 'created', registrationId: 'registration-1' });
    expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { deletedAt: null, phone: { contains: '527561012' } },
    }));
    expect(mockPrisma.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customerId: 'customer-1',
        amount: 2980,
        status: 'paid',
        paymentMethod: 'morning_receipt_sync',
        invoiceNumber: '65252',
        description: 'עומר פרונטלי תכנית שנתית #65252 [morning-doc:doc-uuid-1]',
      }),
    });
    expect(mockReconcile).toHaveBeenCalledWith('payment-1');
  });

  it('does not write anything in dry-run mode', async () => {
    const result = await processMorningReceipt(receipt as any, { dryRun: true });

    expect(result.outcome).toBe('would_create');
    expect(mockPrisma.payment.create).not.toHaveBeenCalled();
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it('skips receipts that were already recorded', async () => {
    mockPrisma.payment.findFirst.mockResolvedValueOnce({ id: 'existing' } as any);

    const result = await processMorningReceipt(receipt as any);

    expect(result.outcome).toBe('already_recorded');
    expect(mockPrisma.customer.findMany).not.toHaveBeenCalled();
  });

  it('skips when the phone matches no customer or more than one', async () => {
    mockPrisma.customer.findMany.mockResolvedValueOnce([]);
    expect((await processMorningReceipt(receipt as any)).outcome).toBe('no_customer');

    mockPrisma.customer.findMany.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }] as any);
    expect((await processMorningReceipt(receipt as any)).outcome).toBe('ambiguous_customer');

    expect(mockPrisma.payment.create).not.toHaveBeenCalled();
  });

  it('links the receipt as invoice of the single same-amount registration without one (non-Omer / already paid)', async () => {
    mockFindRegs.mockResolvedValueOnce([]);
    mockPrisma.registration.findMany.mockResolvedValueOnce([
      { id: 'reg-paid', amount: 2980, paymentStatus: 'paid' },
      { id: 'reg-other', amount: 1400, paymentStatus: 'unpaid' },
    ] as any);

    const result = await processMorningReceipt(receipt as any);

    expect(result).toEqual({ outcome: 'linked_invoice', registrationId: 'reg-paid' });
    expect(mockPrisma.registration.update).toHaveBeenCalledWith({
      where: { id: 'reg-paid' },
      data: { invoiceLink: 'https://app.greeninvoice.co.il/incomes/documents/doc-uuid-1' },
    });
    expect(mockPrisma.payment.create).not.toHaveBeenCalled();
  });

  it('marks an unpaid registration paid when linking its invoice; dry-run writes nothing', async () => {
    mockFindRegs.mockResolvedValue([]);
    mockPrisma.registration.findMany.mockResolvedValue([{ id: 'reg-1', amount: 2980, paymentStatus: 'unpaid' }] as any);

    expect(await processMorningReceipt(receipt as any, { dryRun: true })).toEqual({ outcome: 'would_link_invoice', registrationId: 'reg-1' });
    expect(mockPrisma.registration.update).not.toHaveBeenCalled();

    await processMorningReceipt(receipt as any);
    expect(mockPrisma.registration.update).toHaveBeenCalledWith({
      where: { id: 'reg-1' },
      data: { invoiceLink: 'https://app.greeninvoice.co.il/incomes/documents/doc-uuid-1', paymentStatus: 'paid' },
    });
  });

  it('leaves ambiguous same-amount registrations alone', async () => {
    mockFindRegs.mockResolvedValueOnce([]);
    mockPrisma.registration.findMany.mockResolvedValueOnce([
      { id: 'r1', amount: 2980, paymentStatus: 'paid' },
      { id: 'r2', amount: 2980, paymentStatus: 'paid' },
    ] as any);

    expect((await processMorningReceipt(receipt as any)).outcome).toBe('ambiguous_registrations');
    expect(mockPrisma.registration.update).not.toHaveBeenCalled();
  });

  it('skips a document already linked to a registration', async () => {
    mockPrisma.registration.findFirst.mockResolvedValueOnce({ id: 'reg-x' } as any);

    expect(await processMorningReceipt(receipt as any)).toEqual({ outcome: 'already_recorded', registrationId: 'reg-x' });
    expect(mockPrisma.customer.findMany).not.toHaveBeenCalled();
  });

  it('falls back to matching the customer by email when there is no phone', async () => {
    mockPrisma.customer.findMany.mockResolvedValueOnce([{ id: 'customer-2', name: 'x', phone: null }] as any);
    mockFindRegs.mockResolvedValueOnce([]);
    const noPhone = { ...receipt, client: { name: 'עודד', emails: ['Office@Example.com'] } };

    await processMorningReceipt(noPhone as any, { dryRun: true });

    expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { deletedAt: null, email: { equals: 'office@example.com', mode: 'insensitive' } },
    }));
  });

  it('skips receipts of customers without exactly one unpaid Omer registration', async () => {
    mockFindRegs.mockResolvedValueOnce([]);
    expect((await processMorningReceipt(receipt as any)).outcome).toBe('no_matching_registration');

    mockFindRegs.mockResolvedValueOnce([{ id: 'r1' }, { id: 'r2' }] as any);
    expect((await processMorningReceipt(receipt as any)).outcome).toBe('ambiguous_registrations');

    expect(mockPrisma.payment.create).not.toHaveBeenCalled();
  });

  it('skips when a payment with the same amount around that date already exists', async () => {
    mockPrisma.payment.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'payment-link-payment' } as any);

    const result = await processMorningReceipt(receipt as any);

    expect(result.outcome).toBe('similar_payment_exists');
    expect(mockPrisma.payment.create).not.toHaveBeenCalled();
  });

  it('skips receipts without a phone', async () => {
    const result = await processMorningReceipt({ ...receipt, client: { name: 'x' } } as any);
    expect(result.outcome).toBe('no_phone');
  });
});

describe('syncRecentMorningReceipts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.payment.findFirst.mockResolvedValue({ id: 'existing' } as any);
  });

  it('searches receipt types in the date window and tallies outcomes', async () => {
    mockSearch.mockResolvedValueOnce({ items: [receipt, { ...receipt, id: 'doc-2', number: 65253 }] as any, total: 2 });

    const result = await syncRecentMorningReceipts(2, { now: new Date('2026-10-09T12:00:00Z') });

    expect(mockSearch).toHaveBeenCalledWith({
      type: [305, 315, 320],
      fromDate: '2026-10-07',
      toDate: '2026-10-09',
      page: 1,
      pageSize: 100,
    });
    expect(result.total).toBe(2);
    expect(result.counts).toEqual({ already_recorded: 2 });
  });
});
