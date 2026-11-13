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
  activityRangeWhere,
  buildFreelancerActivityOverview,
  buildFreelancerReconciliation,
  clearFreelancerExpectedCache,
  EXPECTED_CACHE_TTL_MS,
  freelancerExpectedTotal,
  groupFreelancerInvoicesByActivity,
  reconcile,
  buildFreelancerNameResolver,
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

describe('freelancer name next to the supplier', () => {
  const named = [
    { instructorId: 'lian', supplierId: 'sup-lian', supplierName: 'ליאן מורה פרטית ודוגמן', instructor: { name: 'ליאן הרשקוביץ' } },
    { instructorId: 'or', supplierId: null, supplierName: 'Or Yosef', instructor: { name: 'or  yosef' } },
    { instructorId: 'dan', supplierId: null, supplierName: 'דן הדרכות', instructor: { name: 'דן כהן' } },
  ];
  const nameOf = buildFreelancerNameResolver(named);
  it('matches by supplier id first, even when the Morning name changed', () => {
    expect(nameOf({ supplierId: 'sup-lian', supplierName: 'שם אחר' })).toBe('ליאן הרשקוביץ');
  });
  it('falls back to a case/space-insensitive supplier name', () => {
    expect(nameOf({ supplierId: 'unknown', supplierName: '  דן   הדרכות ' })).toBe('דן כהן');
    expect(nameOf({ supplierId: null, supplierName: 'ליאן מורה פרטית ודוגמן' })).toBe('ליאן הרשקוביץ');
  });
  it('does not repeat the name when the supplier already is the instructor', () => {
    expect(nameOf({ supplierId: null, supplierName: 'OR YOSEF' })).toBeNull();
  });
  it('returns null for unlinked suppliers or links without an instructor name', () => {
    expect(nameOf({ supplierId: 'google', supplierName: 'Google' })).toBeNull();
    expect(nameOf({ supplierId: null, supplierName: null })).toBeNull();
    expect(buildFreelancerNameResolver([{ instructorId: 'x', supplierId: 's', supplierName: 'X', instructor: null }])({ supplierId: 's' })).toBeNull();
  });
});

describe('activity-month override is CRM-only', () => {
  it('Morning mapping never carries activityMonth, so the sync upsert cannot overwrite it', () => {
    expect(mapMorningExpense({ id: '1', amount: 100, date: '2026-11-05' })).not.toHaveProperty('activityMonth');
    expect(mapMorningDraft({ id: '1', expense: { amount: 100 } })).not.toHaveProperty('activityMonth');
  });
});

describe('activityMonthOf', () => {
  it('documents dated before the 25th belong to the previous month', () => {
    expect(activityMonthOf({ date: day('2026-02-05'), reportingDate: day('2026-02-01') })).toBe('2026-01');
    expect(activityMonthOf({ date: day('2026-01-10'), reportingDate: null })).toBe('2025-12');
    expect(activityMonthOf({ date: day('2026-10-24'), reportingDate: day('2026-10-01') })).toBe('2026-09');
  });
  it('documents dated on/after the 25th belong to that same month (month-end receipts)', () => {
    expect(activityMonthOf({ date: day('2026-09-30'), reportingDate: day('2026-10-01') })).toBe('2026-09');
    expect(activityMonthOf({ date: day('2026-09-25'), reportingDate: null })).toBe('2026-09');
    expect(activityMonthOf({ date: day('2026-12-31'), reportingDate: null })).toBe('2026-12');
  });
  it('without a document date: month before the reporting date, then null', () => {
    expect(activityMonthOf({ date: null, reportingDate: day('2026-03-01') })).toBe('2026-02');
    expect(activityMonthOf({ date: null, reportingDate: day('2026-03-28') })).toBe('2026-02');
    expect(activityMonthOf({ date: null, reportingDate: null })).toBeNull();
  });
  it('uses the CRM override when set', () => {
    expect(activityMonthOf({ date: day('2026-02-05'), reportingDate: null, activityMonth: '2026-02' })).toBe('2026-02');
    expect(activityMonthOf({ date: day('2026-02-27'), reportingDate: null, activityMonth: '2026-01' })).toBe('2026-01');
  });
});

describe('activityRangeWhere', () => {
  it('covers every doc whose activity month can fall in the range', () => {
    expect(activityRangeWhere('2026-09', '2026-10')).toEqual({
      active: true,
      OR: [
        { activityMonth: { in: ['2026-09', '2026-10'] } },
        { activityMonth: null, date: { gte: day('2026-09-01'), lt: day('2026-12-01') } },
        { activityMonth: null, date: null, reportingDate: { gte: day('2026-10-01'), lt: day('2026-12-01') } },
      ],
    });
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
  it('matches on gross too (VAT-registered freelancer whose CRM pay includes VAT)', () => {
    // גריס שחאדה: invoice 1,687 incl. VAT, CRM pay 1,687.
    expect(reconciliationStatus(1687, 1429.66, 1, 1687)).toBe('match');
    expect(reconcile(1687, 1429.66, 1687, 1)).toEqual({ status: 'match', matchedOn: 'gross', diff: 0 });
    expect(reconcile(1690, 1429.66, 1687, 1)).toEqual({ status: 'match', matchedOn: 'gross', diff: -3 });
    // Net wins when it matches; neither → mismatch with the diff against net.
    expect(reconcile(5000, 5000, 5900, 1)).toEqual({ status: 'match', matchedOn: 'net', diff: 0 });
    expect(reconcile(3000, 2000, 2360, 1)).toEqual({ status: 'mismatch', matchedOn: null, diff: -1000 });
    expect(reconcile(3000, 0, 0, 0)).toMatchObject({ status: 'missing_invoice', matchedOn: null, diff: -3000 });
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
      { id: 'gris', name: 'גריס שחאדה', isActive: true },
    ] as any);
    mockPrisma.instructorExpenseSupplier.findMany.mockResolvedValue([
      ...links,
      { id: 'l4', instructorId: 'orit', supplierId: 'sup-orit', supplierName: 'אורית פתרונות שיווק מא ועד ת' },
      { id: 'l5', instructorId: 'tal', supplierId: 'sup-multi', supplierName: 'מולטי דיזיין' },
      { id: 'l6', instructorId: 'gris', supplierId: 'sup-gris', supplierName: 'גריס שחאדה' },
    ] as any);
    mockReport.mockResolvedValue({
      instructors: [
        reportRow({ instructorId: 'amit', totalMeetings: 10, totalHours: 15, totalPayment: 4800, totalExpenses: 200, grandTotal: 5000 }),
        reportRow({ instructorId: 'orit', totalMeetings: 4, totalHours: 6, totalPayment: 1500, fixedAdditionsTotal: 500, grandTotal: 2000 }),
        reportRow({ instructorId: 'lian', totalMeetings: 3, totalHours: 3, totalPayment: 900, grandTotal: 900 }),
        // employee — never reconciled
        reportRow({ instructorId: 'emp', employmentType: 'employee', totalPayment: 9999, grandTotal: 9999 }),
        reportRow({ instructorId: 'eden', totalMeetings: 2, totalHours: 2, totalPayment: 700, grandTotal: 700 }),
        reportRow({ instructorId: 'gris', totalMeetings: 5, totalHours: 5, totalPayment: 1687, grandTotal: 1687 }),
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
      // Gris (עוסק מורשה): receipt dated 30/10 → October; gross 1,687 equals CRM pay → match on gross
      expenseRow({ id: 'gr1', supplierId: 'sup-gris', supplierName: 'גריס שחאדה', date: day('2026-10-30'), reportingDate: day('2026-10-01'), amount: 1687, amountExcludeVat: 1429.66, vat: 257.34 }),
      // Amit doc dated 10/10 → September work, not October
      expenseRow({ id: 'a3', supplierId: 'sup-barkat', supplierName: 'ברקת אי.טי בע"מ', date: day('2026-10-10'), reportingDate: day('2026-10-01'), amount: 777, amountExcludeVat: 777 }),
      // Non-freelancer expense
      expenseRow({ id: 'g1', supplierId: 'google', supplierName: 'Google' }),
    ] as any);
  });

  it('compares invoiced net to the salary report grandTotal per freelancer', async () => {
    const r = await buildFreelancerReconciliation('2026-10');
    expect(mockReport).toHaveBeenCalledWith('2026-10');
    const where = mockPrisma.companyExpense.findMany.mock.calls[0][0]!.where as any;
    expect(where).toEqual(activityRangeWhere('2026-10', '2026-10'));
    expect(where.OR[1].date).toEqual({ gte: day('2026-10-01'), lt: day('2026-12-01') });

    const by = Object.fromEntries(r.rows.map((x) => [x.instructorId, x]));
    expect(Object.keys(by).sort()).toEqual(['amit', 'eden', 'gris', 'lian', 'orit', 'tal']);
    expect(by.amit).toMatchObject({
      status: 'match', matchedOn: 'net', diff: 0, linked: true,
      expected: { meetings: 10, hours: 15, payment: 4800, expenses: 200, fixedAdditions: 0, grandTotal: 5000 },
      invoiced: { net: 5000, gross: 5900, count: 1, hasDrafts: false },
    });
    expect(by.amit.expenses.map((e) => e.id)).toEqual(['a1']);
    expect(by.amit.expenses[0].activityMonth).toBe('2026-10');
    expect(by.orit).toMatchObject({ status: 'mismatch', matchedOn: null, diff: -500 });
    expect(by.gris).toMatchObject({
      status: 'match', matchedOn: 'gross', diff: 0,
      invoiced: { net: 1429.66, gross: 1687, count: 1 },
    });
    expect(by.gris.expenses[0].activityMonth).toBe('2026-10');
    expect(by.lian).toMatchObject({ status: 'match', invoiced: { net: 900, count: 2, hasDrafts: true } });
    expect(by.tal).toMatchObject({ status: 'no_activity', diff: 800, expected: { grandTotal: 0 } });
    expect(by.eden).toMatchObject({ status: 'missing_invoice', linked: false, invoiced: { count: 0 } });
    // Problems first.
    expect(r.rows[0].status).toBe('mismatch');
    // diff sums row diffs (gris counted against gross = 0).
    expect(r.totals).toMatchObject({ expected: 10287, invoicedNet: 9629.66, invoicedGross: 10787, diff: -400, problems: 3 });
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

describe('groupFreelancerInvoicesByActivity', () => {
  it('buckets linked receipts by activity month, ignoring other suppliers / inactive / out-of-window', () => {
    const rows = [
      expenseRow({ supplierId: 'f', date: day('2026-09-30'), reportingDate: day('2026-10-01'), amount: 1720, amountExcludeVat: 1720 }),
      expenseRow({ supplierId: 'f', date: day('2026-10-03'), reportingDate: day('2026-10-01'), amount: 1180, amountExcludeVat: 1000 }),
      expenseRow({ supplierId: 'f', date: day('2026-11-02'), reportingDate: day('2026-11-01'), amount: 500, amountExcludeVat: 500 }),
      expenseRow({ supplierId: 'f', date: day('2026-08-02'), amount: 9999, amountExcludeVat: 9999 }), // July — out of window
      expenseRow({ supplierId: 'f', active: false, date: day('2026-10-03'), amount: 9999 }),
      expenseRow({ supplierId: 'g', date: day('2026-10-03'), amount: 9999 }),
    ] as ExpenseRowLike[];
    const out = groupFreelancerInvoicesByActivity(rows, ['2026-09', '2026-10'], (r) => r.supplierId === 'f');
    expect(out.get('2026-09')).toEqual({ net: 2720, gross: 2900, count: 2 });
    expect(out.get('2026-10')).toEqual({ net: 500, gross: 500, count: 1 });
    expect([...out.keys()]).toEqual(['2026-09', '2026-10']);
  });
});

describe('freelancerExpectedTotal (10-minute memo)', () => {
  beforeEach(() => clearFreelancerExpectedCache());
  it('sums freelancer grandTotal + ops staff, caching per month', async () => {
    mockReport.mockResolvedValue({
      instructors: [
        reportRow({ instructorId: 'amit', grandTotal: 5000 }),
        reportRow({ instructorId: 'emp', grandTotal: 9999 }),
      ],
      operationsStaff: [{ instructorId: 'tal', approvedHours: 10, approvedPayment: 800 }],
    } as any);
    const ids = new Set(['amit', 'tal']);
    expect(await freelancerExpectedTotal('2026-10', ids, 1_000)).toBe(5800);
    expect(await freelancerExpectedTotal('2026-10', ids, 1_000 + EXPECTED_CACHE_TTL_MS - 1)).toBe(5800);
    expect(mockReport).toHaveBeenCalledTimes(1);
    await freelancerExpectedTotal('2026-09', ids, 2_000);
    expect(mockReport).toHaveBeenCalledTimes(2);
    await freelancerExpectedTotal('2026-10', ids, 1_000 + EXPECTED_CACHE_TTL_MS);
    expect(mockReport).toHaveBeenCalledTimes(3);
  });
});

describe('buildFreelancerActivityOverview', () => {
  beforeEach(() => clearFreelancerExpectedCache());
  it('expected from the salary report and receipts by activity month, per month', async () => {
    mockPrisma.instructor.findMany.mockResolvedValue([{ id: 'amit' }, { id: 'gris' }] as any);
    mockPrisma.instructorExpenseSupplier.findMany.mockResolvedValue([
      { instructorId: 'amit', supplierId: 'sup-barkat', supplierName: 'ברקת' },
      { instructorId: 'gris', supplierId: 'sup-gris', supplierName: 'גריס שחאדה' },
      { instructorId: 'emp', supplierId: 'sup-emp', supplierName: 'עובד' }, // not a freelancer
    ] as any);
    mockPrisma.companyExpense.findMany.mockResolvedValue([
      // September receipts reported in October (the "October ₪1,720" case)
      expenseRow({ supplierId: 'sup-barkat', date: day('2026-09-30'), reportingDate: day('2026-10-01'), amount: 1000, amountExcludeVat: 1000 }),
      expenseRow({ supplierId: 'sup-gris', date: day('2026-10-04'), reportingDate: day('2026-10-01'), amount: 720, amountExcludeVat: 610.17 }),
      expenseRow({ supplierId: 'sup-emp', date: day('2026-10-04'), amount: 5000, amountExcludeVat: 5000 }),
      expenseRow({ supplierId: 'google', date: day('2026-10-04'), amount: 300, amountExcludeVat: 300 }),
    ] as any);
    mockReport.mockImplementation(async (month: string) => ({
      instructors: [
        reportRow({ instructorId: 'amit', grandTotal: month === '2026-09' ? 1000 : 2000 }),
        reportRow({ instructorId: 'gris', grandTotal: month === '2026-09' ? 720 : 0 }),
        reportRow({ instructorId: 'emp', grandTotal: 9999 }),
      ],
      operationsStaff: [],
    }) as any);
    const out = await buildFreelancerActivityOverview(['2026-09', '2026-10']);
    expect(mockPrisma.companyExpense.findMany.mock.calls[0][0]!.where).toEqual(activityRangeWhere('2026-09', '2026-10'));
    expect(out).toEqual([
      { month: '2026-09', expected: 1720, invoicedNet: 1610.17, invoicedGross: 1720, invoicedCount: 2 },
      { month: '2026-10', expected: 2000, invoicedNet: 0, invoicedGross: 0, invoicedCount: 0 },
    ]);
    expect(mockReport).toHaveBeenCalledTimes(2);
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
