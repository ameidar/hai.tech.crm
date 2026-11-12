import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    companyExpense: { findMany: vi.fn() },
    instructor: { findMany: vi.fn() },
    instructorExpenseSupplier: { findMany: vi.fn() },
  },
}));
vi.mock('../morning/client.js', () => ({ isMorningConfigured: vi.fn(() => true), morningRequest: vi.fn() }));
vi.mock('../notifications.js', () => ({ ADMIN_PHONE: '0528746137', sendWhatsAppMessage: vi.fn() }));
vi.mock('../instructorReport.service.js', () => ({ buildInstructorMonthlyReport: vi.fn() }));

import { prisma } from '../../utils/prisma.js';
import { buildInstructorMonthlyReport } from '../instructorReport.service.js';
import {
  activityMonthOf,
  buildFreelancerReconciliation,
  buildLinkResolver,
  buildLinkSuggestions,
  freelancerKindWhere,
  isFreelancerExpense,
  nameTokens,
  previousIsraelMonth,
  reconciliationStatus,
  reconciliationTolerance,
  scoreCandidate,
} from '../freelancer-expenses.js';
import { mapMorningDraft, mapMorningExpense, type ExpenseRowLike } from '../company-expenses.js';

const mockPrisma = vi.mocked(prisma, true);
const mockReport = vi.mocked(buildInstructorMonthlyReport);
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

beforeEach(() => vi.clearAllMocks());

const links = [
  { id: 'l1', instructorId: 'amit', supplierId: 'sup-barkat', supplierName: 'ברקת אי.טי בע"מ' },
  { id: 'l2', instructorId: 'lian', supplierId: null, supplierName: 'ליאן מורה פרטית' },
  { id: 'l3', instructorId: 'lian', supplierId: null, supplierName: 'ליאן מורה פרטית ודוגמן' },
];

describe('link resolution', () => {
  const resolve = buildLinkResolver(links);
  it('matches by Morning supplier id even when the name differs', () => {
    expect(resolve({ supplierId: 'sup-barkat', supplierName: 'Barkat IT' })?.instructorId).toBe('amit');
  });
  it('falls back to normalized name (quotes, punctuation, case, spaces)', () => {
    expect(resolve({ supplierId: 'other', supplierName: '  ברקת אי.טי בע״מ ' })?.instructorId).toBe('amit');
    expect(resolve({ supplierId: 'x', supplierName: 'ליאן  מורה פרטית' })?.id).toBe('l2');
    expect(resolve({ supplierId: null, supplierName: 'ליאן מורה פרטית ודוגמן' })?.id).toBe('l3');
  });
  it('returns null for unlinked suppliers', () => {
    expect(resolve({ supplierId: 'google', supplierName: 'Google' })).toBeNull();
    expect(resolve({ supplierId: null, supplierName: null })).toBeNull();
    expect(isFreelancerExpense({ supplierName: 'ליאן' }, links)).toBe(false);
    expect(isFreelancerExpense({ supplierName: 'ליאן מורה פרטית' }, links)).toBe(true);
  });
});

describe('activity-month override is CRM-only', () => {
  it('Morning mapping never carries activityMonth, so the sync upsert cannot overwrite it', () => {
    expect(mapMorningExpense({ id: '1', amount: 100, date: '2026-11-05' })).not.toHaveProperty('activityMonth');
    expect(mapMorningDraft({ id: '1', expense: { amount: 100 } })).not.toHaveProperty('activityMonth');
  });
});

describe('activityMonthOf', () => {
  it('defaults to the month before the document date', () => {
    expect(activityMonthOf({ date: day('2026-02-05'), reportingDate: day('2026-02-01') })).toBe('2026-01');
    expect(activityMonthOf({ date: day('2026-01-10'), reportingDate: null })).toBe('2025-12');
  });
  it('falls back to reporting date, then null', () => {
    expect(activityMonthOf({ date: null, reportingDate: day('2026-03-01') })).toBe('2026-02');
    expect(activityMonthOf({ date: null, reportingDate: null })).toBeNull();
  });
  it('uses the CRM override when set', () => {
    expect(activityMonthOf({ date: day('2026-02-05'), reportingDate: null, activityMonth: '2026-02' })).toBe('2026-02');
  });
});

describe('reconciliationStatus', () => {
  it('tolerance is max(₪5, 1%)', () => {
    expect(reconciliationTolerance(100)).toBe(5);
    expect(reconciliationTolerance(10000)).toBe(100);
  });
  it('classifies match / mismatch / missing / no activity', () => {
    expect(reconciliationStatus(10000, 10099, 1)).toBe('match');
    expect(reconciliationStatus(10000, 9900, 2)).toBe('match');
    expect(reconciliationStatus(10000, 10101, 1)).toBe('mismatch');
    expect(reconciliationStatus(300, 304, 1)).toBe('match');
    expect(reconciliationStatus(300, 306, 1)).toBe('mismatch');
    expect(reconciliationStatus(3000, 0, 0)).toBe('missing_invoice');
    expect(reconciliationStatus(0, 500, 1)).toBe('no_activity');
  });
});

describe('previousIsraelMonth', () => {
  it('uses the Israel calendar (UTC late evening on the 31st is already next month)', () => {
    expect(previousIsraelMonth(new Date('2026-10-31T22:30:00Z'))).toBe('2026-10');
    expect(previousIsraelMonth(new Date('2026-01-15T10:00:00Z'))).toBe('2025-12');
  });
});

const expenseRow = (o: Record<string, unknown>) => ({
  id: 'e', morningId: 'm', status: 20, documentType: '400', number: '1', date: day('2026-11-05'), reportingDate: day('2026-11-01'),
  amount: 1000, amountExcludeVat: 1000, vat: 0, currency: 'ILS', originalAmount: null, isDraft: false, description: null,
  supplierId: null, supplierName: null, categoryId: null, categoryTitle: null, url: null, active: true, activityMonth: null, ...o,
});

const reportRow = (o: Record<string, unknown>) => ({
  instructorId: 'x', instructorName: 'x', employmentType: 'freelancer', totalMeetings: 0, totalHours: 0,
  totalPayment: 0, totalExpenses: 0, fixedAdditionsTotal: 0, grandTotal: 0, ...o,
});

describe('buildFreelancerReconciliation', () => {
  beforeEach(() => {
    mockPrisma.instructor.findMany.mockResolvedValue([
      { id: 'amit', name: 'עמית כהן', isActive: true },
      { id: 'orit', name: 'אורית עדני', isActive: true },
      { id: 'lian', name: 'ליאן הרשקוביץ', isActive: true },
      { id: 'tal', name: 'טל בניש', isActive: true },
      { id: 'eden', name: 'עדן בן אולד', isActive: true },
    ] as any);
    mockPrisma.instructorExpenseSupplier.findMany.mockResolvedValue([
      ...links,
      { id: 'l4', instructorId: 'orit', supplierId: 'sup-orit', supplierName: 'אורית פתרונות שיווק מא ועד ת' },
      { id: 'l5', instructorId: 'tal', supplierId: 'sup-multi', supplierName: 'מולטי דיזיין' },
    ] as any);
    mockReport.mockResolvedValue({
      instructors: [
        reportRow({ instructorId: 'amit', totalMeetings: 10, totalHours: 15, totalPayment: 4800, totalExpenses: 200, grandTotal: 5000 }),
        reportRow({ instructorId: 'orit', totalMeetings: 4, totalHours: 6, totalPayment: 1500, fixedAdditionsTotal: 500, grandTotal: 2000 }),
        reportRow({ instructorId: 'lian', totalMeetings: 3, totalHours: 3, totalPayment: 900, grandTotal: 900 }),
        // employee — never reconciled
        reportRow({ instructorId: 'emp', employmentType: 'employee', totalPayment: 9999, grandTotal: 9999 }),
        reportRow({ instructorId: 'eden', totalMeetings: 2, totalHours: 2, totalPayment: 700, grandTotal: 700 }),
      ],
      operationsStaff: [],
    } as any);
    mockPrisma.companyExpense.findMany.mockResolvedValue([
      // Amit: VAT invoice, net 5,000 = match (gross 5,900)
      expenseRow({ id: 'a1', supplierId: 'sup-barkat', supplierName: 'ברקת אי.טי בע"מ', amount: 5900, amountExcludeVat: 5000, vat: 900 }),
      // Orit: 1,500 only → mismatch (−500)
      expenseRow({ id: 'o1', supplierId: 'sup-orit', supplierName: 'אורית פתרונות שיווק מא ועד ת', amount: 1500, amountExcludeVat: 1500 }),
      // Lian: two docs under two business names (one a draft without net) → 900 match
      expenseRow({ id: 'li1', supplierName: 'ליאן מורה פרטית', amount: 400, amountExcludeVat: 400 }),
      expenseRow({ id: 'li2', isDraft: true, supplierName: 'ליאן מורה פרטית ודוגמן', amount: 500, amountExcludeVat: null, vat: 0 }),
      // Tal: no activity in October but invoiced
      expenseRow({ id: 't1', supplierId: 'sup-multi', supplierName: 'מולטי דיזיין', amount: 800, amountExcludeVat: 800 }),
      // Overridden to November — not October even though dated in November
      expenseRow({ id: 'a2', supplierId: 'sup-barkat', supplierName: 'ברקת אי.טי בע"מ', activityMonth: '2026-11', amount: 99, amountExcludeVat: 99 }),
      // Non-freelancer expense
      expenseRow({ id: 'g1', supplierId: 'google', supplierName: 'Google' }),
    ] as any);
  });

  it('compares invoiced net to the salary report grandTotal per freelancer', async () => {
    const r = await buildFreelancerReconciliation('2026-10');
    expect(mockReport).toHaveBeenCalledWith('2026-10');
    const where = mockPrisma.companyExpense.findMany.mock.calls[0][0]!.where as any;
    expect(where.OR[0]).toEqual({ activityMonth: '2026-10' });
    expect(where.OR[1].date).toEqual({ gte: day('2026-11-01'), lt: day('2026-12-01') });

    const by = Object.fromEntries(r.rows.map((x) => [x.instructorId, x]));
    expect(Object.keys(by).sort()).toEqual(['amit', 'eden', 'lian', 'orit', 'tal']);
    expect(by.amit).toMatchObject({
      status: 'match', diff: 0, linked: true,
      expected: { meetings: 10, hours: 15, payment: 4800, expenses: 200, fixedAdditions: 0, grandTotal: 5000 },
      invoiced: { net: 5000, gross: 5900, count: 1, hasDrafts: false },
    });
    expect(by.amit.expenses.map((e) => e.id)).toEqual(['a1']);
    expect(by.amit.expenses[0].activityMonth).toBe('2026-10');
    expect(by.orit).toMatchObject({ status: 'mismatch', diff: -500 });
    expect(by.lian).toMatchObject({ status: 'match', invoiced: { net: 900, count: 2, hasDrafts: true } });
    expect(by.tal).toMatchObject({ status: 'no_activity', diff: 800, expected: { grandTotal: 0 } });
    expect(by.eden).toMatchObject({ status: 'missing_invoice', linked: false, invoiced: { count: 0 } });
    // Problems first.
    expect(r.rows[0].status).toBe('mismatch');
    expect(r.totals).toMatchObject({ expected: 8600, invoicedNet: 8200, diff: -400, problems: 3 });
  });

  it('adds approved hours of freelance operations staff', async () => {
    mockReport.mockResolvedValue({
      instructors: [],
      operationsStaff: [{ instructorId: 'tal', approvedHours: 10, approvedPayment: 800 }],
    } as any);
    const r = await buildFreelancerReconciliation('2026-10');
    const tal = r.rows.find((x) => x.instructorId === 'tal')!;
    expect(tal).toMatchObject({ status: 'match', expected: { hours: 10, payment: 800, grandTotal: 800 } });
  });
});

describe('freelancerKindWhere', () => {
  it('selects supplier pairs on each side of the link resolution', async () => {
    mockPrisma.instructorExpenseSupplier.findMany.mockResolvedValue(links as any);
    mockPrisma.companyExpense.findMany.mockResolvedValue([
      { supplierId: 'sup-barkat', supplierName: 'ברקת אי.טי בע"מ' },
      { supplierId: null, supplierName: 'ליאן מורה פרטית' },
      { supplierId: 'google', supplierName: 'Google' },
      { supplierId: null, supplierName: null },
    ] as any);
    expect(await freelancerKindWhere('freelancer')).toEqual({ OR: [
      { supplierId: 'sup-barkat', supplierName: 'ברקת אי.טי בע"מ' },
      { supplierId: null, supplierName: 'ליאן מורה פרטית' },
    ] });
    expect(await freelancerKindWhere('other')).toEqual({ OR: [
      { supplierId: 'google', supplierName: 'Google' },
      { supplierId: null, supplierName: null },
    ] });
  });
});

describe('link suggestions', () => {
  it('tokenizes names without business-form words', () => {
    expect(nameTokens('ברקת אי.טי בע"מ')).toEqual(['ברקת']);
    expect(nameTokens('Eden Ben Old Ltd')).toEqual(['eden', 'ben', 'old']);
  });

  it('scores name tokens and email local parts', () => {
    expect(scoreCandidate('אורית פתרונות שיווק מא ועד ת', { name: 'אורית עדני' }).score).toBeGreaterThan(0);
    expect(scoreCandidate('Eden Ben Old', { name: 'עדן בן אולד', email: 'edenbenold@gmail.com' }).reasons).toContain('email');
    expect(scoreCandidate('מולטי דיזיין', { name: 'טל בניש', email: 'tal@x.com' }).score).toBe(0);
  });

  it('lists unlinked suppliers with candidates first and aggregates their docs', () => {
    const row = (o: Partial<ExpenseRowLike>): ExpenseRowLike => ({
      status: 20, date: day('2026-10-05'), reportingDate: null, amount: 100, amountExcludeVat: 100, vat: 0,
      supplierId: null, supplierName: null, categoryTitle: null, active: true, ...o,
    });
    const out = buildLinkSuggestions([
      row({ supplierId: 'g', supplierName: 'Google' }),
      row({ supplierId: 'g', supplierName: 'Google' }),
      row({ supplierId: 'g', supplierName: 'Google' }),
      row({ supplierId: 'o', supplierName: 'אורית פתרונות שיווק מא ועד ת', amount: 2000, amountExcludeVat: 2000, date: day('2026-11-03') }),
      row({ supplierId: 'o', supplierName: 'אורית פתרונות שיווק מא ועד ת', amount: 1000, amountExcludeVat: 1000 }),
      row({ supplierId: 'sup-barkat', supplierName: 'ברקת אי.טי בע"מ' }), // already linked
    ], links, [
      { id: 'orit', name: 'אורית עדני', email: null, isActive: true },
      { id: 'amit', name: 'עמית כהן', email: 'amit@barkat.co.il', isActive: true },
    ]);
    expect(out.map((s) => s.supplierName)).toEqual(['אורית פתרונות שיווק מא ועד ת', 'Google']);
    expect(out[0]).toMatchObject({ supplierId: 'o', docCount: 2, gross: 3000, net: 3000, lastDate: '2026-11-03' });
    expect(out[0].candidates.map((c) => c.instructorId)).toEqual(['orit']);
    expect(out[1].candidates).toEqual([]);
  });
});
