import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    companyExpense: {
      count: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock('../morning/client.js', () => ({
  isMorningConfigured: vi.fn(() => true),
  morningRequest: vi.fn(),
}));

import { prisma } from '../../utils/prisma.js';
import { morningRequest } from '../morning/client.js';
import {
  buildExpenseSummary,
  mapMorningDraft,
  mapMorningExpense,
  syncCompanyExpenses,
  syncCompanyExpensesAndDrafts,
  syncMorningDrafts,
  type ExpenseRowLike,
} from '../company-expenses.js';

const mockPrisma = vi.mocked(prisma, true);
const mockMorning = vi.mocked(morningRequest);

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
// 2026-11-15 12:00 Israel time
const NOW = new Date('2026-11-15T10:00:00.000Z');

const morningItem = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  status: 20,
  documentType: 305,
  number: `N-${id}`,
  date: '2026-10-05',
  reportingDate: '2026-10-01',
  amount: 1170,
  amountExcludeVat: 1000,
  vat: 170,
  currency: 'ILS',
  amountLocal: 1170,
  description: 'אחסון',
  supplier: { id: 'sup-1', name: 'Hetzner ', emails: [] },
  accountingClassification: { id: 'cat-1', title: 'מחשוב' },
  url: `https://morning/doc/${id}`,
  active: true,
  creationDate: 1790000000,
  lastUpdateDate: 1791000000,
  ...overrides,
});

beforeEach(() => vi.clearAllMocks());

describe('mapMorningExpense', () => {
  it('maps Morning fields to mirror columns', () => {
    expect(mapMorningExpense(morningItem('e1'))).toEqual({
      morningId: 'e1',
      status: 20,
      documentType: '305',
      number: 'N-e1',
      date: day('2026-10-05'),
      reportingDate: day('2026-10-01'),
      amount: 1170,
      amountExcludeVat: 1000,
      vat: 170,
      currency: 'ILS',
      description: 'אחסון',
      supplierId: 'sup-1',
      supplierName: 'Hetzner',
      categoryId: 'cat-1',
      categoryTitle: 'מחשוב',
      url: 'https://morning/doc/e1',
      active: true,
      morningUpdatedAt: new Date(1791000000 * 1000),
      originalAmount: null,
    });
  });

  it('converts foreign-currency docs to ILS via amountLocal', () => {
    const m = mapMorningExpense(morningItem('e2', { currency: 'USD', amount: 100, amountExcludeVat: 100, vat: 0, amountLocal: 370 }));
    expect(m).toMatchObject({ amount: 370, amountExcludeVat: 370, vat: 0, currency: 'USD', originalAmount: 100 });
  });

  it('keeps inactive flag and returns null without id', () => {
    expect(mapMorningExpense(morningItem('e3', { active: false }))?.active).toBe(false);
    expect(mapMorningExpense({ amount: 5 })).toBeNull();
  });
});

describe('syncCompanyExpenses', () => {
  it('does a 13-month sync when the mirror is empty and paginates until a short page', async () => {
    mockPrisma.companyExpense.count.mockResolvedValue(0 as never);
    const page1 = Array.from({ length: 500 }, (_, i) => morningItem(`p1-${i}`));
    const page2 = [morningItem('p2-0'), morningItem('p2-1')];
    mockMorning
      .mockResolvedValueOnce({ items: page1, total: 502 } as never)
      .mockResolvedValueOnce({ items: page2, total: 502 } as never);
    mockPrisma.companyExpense.findUnique.mockImplementation((async (args: any) =>
      args.where.morningId === 'p2-1' ? { id: 'existing' } : null) as never);

    const result = await syncCompanyExpenses({ now: NOW });

    expect(mockMorning).toHaveBeenCalledTimes(2);
    expect(mockMorning).toHaveBeenNthCalledWith(1, 'POST', '/api/v1/expenses/search', {
      pageSize: 500, page: 1, fromDate: '2025-11-01', toDate: '2026-11-15',
    });
    expect(mockMorning).toHaveBeenNthCalledWith(2, 'POST', '/api/v1/expenses/search', expect.objectContaining({ page: 2 }));
    expect(mockPrisma.companyExpense.upsert).toHaveBeenCalledTimes(502);
    expect(result).toMatchObject({ fetched: 502, created: 501, updated: 1, skipped: 0 });
    expect(mockPrisma.companyExpense.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { morningId: 'p2-0' },
      create: expect.objectContaining({ morningId: 'p2-0', amount: 1170, syncedAt: expect.any(Date) }),
      update: expect.objectContaining({ morningId: 'p2-0', active: true }),
    }));
  });

  it('uses a 60-day window for incremental syncs and never deletes', async () => {
    mockPrisma.companyExpense.count.mockResolvedValue(10 as never);
    mockMorning.mockResolvedValueOnce({ items: [morningItem('x', { active: false })], total: 1 } as never);
    mockPrisma.companyExpense.findUnique.mockResolvedValue({ id: 'x' } as never);

    const result = await syncCompanyExpenses({ now: NOW });

    expect(mockMorning).toHaveBeenCalledWith('POST', '/api/v1/expenses/search', {
      pageSize: 500, page: 1, fromDate: '2026-09-16', toDate: '2026-11-15',
    });
    expect(result).toMatchObject({ fetched: 1, created: 0, updated: 1 });
    expect(mockPrisma.companyExpense.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ active: false }),
    }));
    expect((mockPrisma.companyExpense as any).delete).toBeUndefined();
  });

  it('forces a full window with full=true', async () => {
    mockPrisma.companyExpense.count.mockResolvedValue(10 as never);
    mockMorning.mockResolvedValueOnce({ items: [], total: 0 } as never);
    await syncCompanyExpenses({ full: true, now: NOW });
    expect(mockMorning).toHaveBeenCalledWith('POST', '/api/v1/expenses/search', expect.objectContaining({ fromDate: '2025-11-01' }));
  });
});

const morningDraft = (id: string, expense: Record<string, unknown> = {}) => ({
  id,
  status: 10,
  creationDate: 1794390604,
  lastUpdateDate: 1794390604,
  url: `https://morning/draft/${id}`,
  expense: {
    currency: 'USD',
    currencyRate: 0,
    vat: 0,
    amount: 200,
    date: '2026-09-19T00:00:00',
    reportingDate: '2026-09-01T00:00:00',
    documentType: 305,
    number: '85',
    description: '',
    supplier: { id: 'sup-oai', name: 'OpenAI OpCo, LLC ' },
    accountingClassification: { id: 'cat-1', title: 'תוכנה' },
    active: true,
    ...expense,
  },
});

describe('mapMorningDraft', () => {
  it('prefixes the id, flags it as a draft and converts foreign amounts with the given rate', () => {
    expect(mapMorningDraft(morningDraft('d1'), { USD: 3.7 })).toMatchObject({
      morningId: 'draft:d1',
      status: 10,
      isDraft: true,
      number: '85',
      date: day('2026-09-19'),
      reportingDate: day('2026-09-01'),
      amount: 740,
      amountExcludeVat: 740,
      vat: 0,
      currency: 'USD',
      originalAmount: 200,
      supplierName: 'OpenAI OpCo, LLC',
      categoryTitle: 'תוכנה',
      url: 'https://morning/draft/d1',
    });
  });

  it('keeps ILS drafts as-is, splits VAT, and stores 0 ILS when no rate is known', () => {
    expect(mapMorningDraft(morningDraft('d2', { currency: 'ILS', amount: 1170, vat: 170 }))).toMatchObject({
      amount: 1170, amountExcludeVat: 1000, vat: 170, originalAmount: null,
    });
    expect(mapMorningDraft(morningDraft('d3'))).toMatchObject({ amount: 0, originalAmount: 200 });
    expect(mapMorningDraft(morningDraft('d4', { number: '', amount: undefined, date: undefined }))).toMatchObject({
      number: null, amount: 0, date: null,
    });
    expect(mapMorningDraft({ expense: {} })).toBeNull();
  });
});

describe('syncMorningDrafts', () => {
  it('upserts current drafts with the latest approved rate and deletes drafts that left Morning', async () => {
    mockMorning.mockResolvedValueOnce({ items: [morningDraft('d1'), morningDraft('d2', { currency: 'ILS', amount: 50 })], total: 2 } as never);
    mockPrisma.companyExpense.findMany.mockResolvedValue([
      { currency: 'USD', amount: 370, originalAmount: 100 },
      { currency: 'USD', amount: 300, originalAmount: 100 }, // older — ignored
    ] as never);
    mockPrisma.companyExpense.deleteMany.mockResolvedValue({ count: 3 } as never);

    const result = await syncMorningDrafts();

    expect(mockMorning).toHaveBeenCalledWith('POST', '/api/v1/expenses/drafts/search', { pageSize: 100, page: 1 });
    expect(mockPrisma.companyExpense.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { morningId: 'draft:d1' },
      create: expect.objectContaining({ amount: 740, isDraft: true, syncedAt: expect.any(Date) }),
    }));
    expect(mockPrisma.companyExpense.deleteMany).toHaveBeenCalledWith({
      where: { isDraft: true, morningId: { notIn: ['draft:d1', 'draft:d2'] } },
    });
    expect(result).toEqual({ fetched: 2, upserted: 2, removed: 3, missingRates: 0 });
  });
});

describe('syncCompanyExpensesAndDrafts', () => {
  it('widens the expense sync to the full window when drafts were approved', async () => {
    mockPrisma.companyExpense.findMany.mockResolvedValue([] as never);
    mockPrisma.companyExpense.deleteMany.mockResolvedValue({ count: 1 } as never);
    mockPrisma.companyExpense.count.mockResolvedValue(10 as never);
    mockMorning
      .mockResolvedValueOnce({ items: [], total: 0 } as never) // drafts
      .mockResolvedValueOnce({ items: [], total: 0 } as never); // expenses

    const result = await syncCompanyExpensesAndDrafts({ now: NOW });

    expect(mockMorning).toHaveBeenLastCalledWith('POST', '/api/v1/expenses/search', expect.objectContaining({ fromDate: '2025-11-01' }));
    expect(result.drafts).toMatchObject({ removed: 1 });
  });

  it('re-mirrors drafts after the expense sync when a rate was missing', async () => {
    mockPrisma.companyExpense.findMany
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([{ currency: 'USD', amount: 370, originalAmount: 100 }] as never);
    mockPrisma.companyExpense.deleteMany.mockResolvedValue({ count: 0 } as never);
    mockPrisma.companyExpense.count.mockResolvedValue(10 as never);
    mockMorning
      .mockResolvedValueOnce({ items: [morningDraft('d1')], total: 1 } as never)
      .mockResolvedValueOnce({ items: [], total: 0 } as never)
      .mockResolvedValueOnce({ items: [morningDraft('d1')], total: 1 } as never);

    const result = await syncCompanyExpensesAndDrafts({ now: NOW });

    expect(mockMorning).toHaveBeenNthCalledWith(2, 'POST', '/api/v1/expenses/search', expect.objectContaining({ fromDate: '2026-09-16' }));
    expect(mockPrisma.companyExpense.upsert).toHaveBeenLastCalledWith(expect.objectContaining({
      create: expect.objectContaining({ morningId: 'draft:d1', amount: 740 }),
    }));
    expect(result.drafts).toEqual({ fetched: 1, upserted: 1, removed: 0, missingRates: 0 });
  });
});

describe('buildExpenseSummary', () => {
  const row = (o: Partial<ExpenseRowLike>): ExpenseRowLike => ({
    status: 20, date: day('2026-11-02'), reportingDate: null, amount: 117, amountExcludeVat: 100, vat: 17,
    supplierId: 's1', supplierName: 'ספק א', categoryTitle: 'משרד', active: true, ...o,
  });

  const rows: ExpenseRowLike[] = [
    // current month (2026-11)
    row({ amount: 1170, amountExcludeVat: 1000 }),
    row({ amount: 234, amountExcludeVat: null, vat: 34, status: 10, supplierId: 's2', supplierName: 'ספק ב', categoryTitle: null }),
    // last month via reportingDate even though doc date is in November
    row({ date: day('2026-11-01'), reportingDate: day('2026-10-01'), amount: 585, amountExcludeVat: 500 }),
    // 2 and 3 months ago
    row({ date: day('2026-09-10'), amount: 117, amountExcludeVat: 100, supplierId: 's2', supplierName: 'ספק ב' }),
    row({ date: day('2026-08-10'), amount: 351, amountExcludeVat: 300 }),
    // inactive — ignored
    row({ amount: 99999, active: false }),
    // outside 12-month window
    row({ date: day('2025-10-10'), amount: 5000, amountExcludeVat: 5000 }),
  ];

  const s = buildExpenseSummary(rows, NOW);

  it('builds 12 monthly buckets ending in the current month', () => {
    expect(s.currentMonth).toBe('2026-11');
    expect(s.months).toHaveLength(12);
    expect(s.months[0].month).toBe('2025-12');
    expect(s.months[11]).toEqual({ month: '2026-11', gross: 1404, net: 1200, count: 2 });
    expect(s.months.find((m) => m.month === '2026-10')).toEqual({ month: '2026-10', gross: 585, net: 500, count: 1 });
  });

  it('computes KPIs: this month, last month, average of previous 3 months', () => {
    expect(s.kpis.thisMonth).toEqual({ gross: 1404, net: 1200, count: 2 });
    expect(s.kpis.lastMonth).toEqual({ gross: 585, net: 500, count: 1 });
    expect(s.kpis.threeMonthAvg).toEqual({ gross: 351, net: 300 }); // (585+117+351)/3, (500+100+300)/3
    expect(s.kpis.pendingCount).toBe(1);
    expect(s.kpis.pendingGross).toBe(234);
  });

  it('breaks down by category and supplier within the window', () => {
    expect(s.byCategory).toEqual([
      { category: 'משרד', gross: 2223, net: 1900, count: 4 },
      { category: 'ללא סיווג', gross: 234, net: 200, count: 1 },
    ]);
    expect(s.topSuppliers[0]).toMatchObject({ supplierName: 'ספק א', gross: 2106, count: 3 });
    expect(s.topSuppliers[1]).toMatchObject({ supplierName: 'ספק ב', gross: 351, count: 2 });
  });

  it('ranks suppliers by how often they bill, not by amount', () => {
    const freq = buildExpenseSummary([
      row({ supplierId: 'big', supplierName: 'יקר', amount: 9000, amountExcludeVat: 9000 }),
      row({ supplierId: 'often', supplierName: 'שכיח', amount: 10, amountExcludeVat: 10 }),
      row({ supplierId: 'often', supplierName: 'שכיח', date: day('2026-10-02'), amount: 10, amountExcludeVat: 10 }),
    ], NOW);
    expect(freq.topSuppliers.map((t) => t.supplierName)).toEqual(['שכיח', 'יקר']);
  });
});
