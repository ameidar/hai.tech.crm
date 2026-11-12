// Company expenses (הוצאות החברה) — read-only mirror of Morning supplier expenses,
// plus pure helpers for the overview screen. Morning stays the source of truth: we only
// upsert by morningId and never delete rows.
import { prisma } from '../utils/prisma.js';
import { morningRequest, isMorningConfigured } from './morning/client.js';

const PAGE_SIZE = 500;
const MAX_PAGES = 50;

// Observed Morning expense statuses — confirm with Inna. Raw status is always kept.
export const EXPENSE_STATUS_PENDING = 10;
export const EXPENSE_STATUS_APPROVED = 20;

export const FULL_SYNC_MONTHS = 13;
export const NIGHTLY_SYNC_DAYS = 60;

// ─── Date helpers (Asia/Jerusalem) ─────────────────────────────────────────────

/** Today's calendar date in Israel as { year, month (1-12), day, iso: "YYYY-MM-DD" }. */
export function israelToday(now: Date = new Date()) {
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const [year, month, day] = iso.split('-').map(Number);
  return { year, month, day, iso };
}

/** "YYYY-MM" shifted by `delta` months. */
export function shiftMonth(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export function daysInMonth(monthKey: string): number {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** UTC-midnight Date for the first day of a "YYYY-MM" month (matches @db.Date storage). */
export function monthStart(monthKey: string): Date {
  return new Date(`${monthKey}-01T00:00:00.000Z`);
}

function parseDay(raw: unknown): Date | null {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(raw)) return null;
  return new Date(`${raw.slice(0, 10)}T00:00:00.000Z`);
}

// Morning timestamps arrive as unix seconds; accept ms / ISO strings defensively.
function parseTimestamp(raw: unknown): Date | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return new Date(raw < 1e12 ? raw * 1000 : raw);
  }
  if (typeof raw === 'string' && raw) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function num(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ─── Morning → mirror mapping ──────────────────────────────────────────────────

export interface CompanyExpenseData {
  morningId: string;
  status: number | null;
  documentType: string | null;
  number: string | null;
  date: Date | null;
  reportingDate: Date | null;
  amount: number;
  amountExcludeVat: number | null;
  vat: number | null;
  currency: string | null;
  description: string | null;
  supplierId: string | null;
  supplierName: string | null;
  categoryId: string | null;
  categoryTitle: string | null;
  url: string | null;
  active: boolean;
  morningUpdatedAt: Date | null;
  /** Gross amount in the document's own currency, for foreign-currency docs only. */
  originalAmount?: number | null;
  /** Mirrors a Morning draft (uploaded, not yet approved) — see syncMorningDrafts. */
  isDraft?: boolean;
}

/** Map a raw Morning expense item to mirror columns. Returns null when it has no id. */
export function mapMorningExpense(item: any): CompanyExpenseData | null {
  if (!item?.id) return null;
  const currency = item.currency ? String(item.currency) : null;
  const gross = num(item.amount) ?? 0;
  let amount = gross;
  let amountExcludeVat = num(item.amountExcludeVat);
  let vat = num(item.vat);
  // Foreign-currency docs: use Morning's ILS amount and scale the net/VAT split to it.
  const local = num(item.amountLocal);
  if (currency && currency !== 'ILS' && local !== null) {
    const ratio = gross ? local / gross : 1;
    amount = local;
    if (amountExcludeVat !== null) amountExcludeVat = round2(amountExcludeVat * ratio);
    if (vat !== null) vat = round2(vat * ratio);
  }
  return {
    morningId: String(item.id),
    status: num(item.status),
    documentType: item.documentType !== undefined && item.documentType !== null ? String(item.documentType) : null,
    number: item.number !== undefined && item.number !== null ? String(item.number) : null,
    date: parseDay(item.date),
    reportingDate: parseDay(item.reportingDate),
    amount: round2(amount),
    amountExcludeVat,
    vat,
    currency,
    description: item.description ? String(item.description) : null,
    supplierId: item.supplier?.id ? String(item.supplier.id) : null,
    supplierName: item.supplier?.name ? String(item.supplier.name).trim() : null,
    categoryId: item.accountingClassification?.id ? String(item.accountingClassification.id) : null,
    categoryTitle: item.accountingClassification?.title ? String(item.accountingClassification.title) : null,
    url: item.url ? String(item.url) : null,
    active: item.active !== false,
    morningUpdatedAt: parseTimestamp(item.lastUpdateDate) ?? parseTimestamp(item.creationDate),
    originalAmount: currency && currency !== 'ILS' && local !== null ? round2(gross) : null,
  };
}

/** Prefix that keeps draft ids apart from approved-expense ids in the morningId column. */
export const DRAFT_ID_PREFIX = 'draft:';

/**
 * Map a Morning expense draft ({ id, status, url, expense: {...} }) to mirror columns.
 * Drafts carry no ILS amount for foreign docs, so `ilsRates[currency]` (ILS per unit, taken
 * from recently approved docs) converts them; without a rate the ILS amount stays 0.
 */
export function mapMorningDraft(draft: any, ilsRates: Record<string, number> = {}): CompanyExpenseData | null {
  if (!draft?.id) return null;
  const e = draft.expense ?? {};
  const currency = e.currency ? String(e.currency) : 'ILS';
  const foreign = currency !== 'ILS';
  const gross = num(e.amount) ?? 0;
  const rate = foreign ? ilsRates[currency] ?? 0 : 1;
  const amount = round2(gross * rate);
  const rawVat = num(e.vat);
  const vat = rawVat === null ? null : round2(rawVat * rate);
  return {
    morningId: `${DRAFT_ID_PREFIX}${draft.id}`,
    status: num(draft.status),
    documentType: e.documentType !== undefined && e.documentType !== null ? String(e.documentType) : null,
    number: e.number !== undefined && e.number !== null && e.number !== '' ? String(e.number) : null,
    date: parseDay(e.date),
    reportingDate: parseDay(e.reportingDate),
    amount,
    amountExcludeVat: round2(amount - (vat ?? 0)),
    vat,
    currency,
    description: e.description ? String(e.description) : null,
    supplierId: e.supplier?.id ? String(e.supplier.id) : null,
    supplierName: e.supplier?.name ? String(e.supplier.name).trim() : null,
    categoryId: e.accountingClassification?.id ? String(e.accountingClassification.id) : null,
    categoryTitle: e.accountingClassification?.title ? String(e.accountingClassification.title) : null,
    url: draft.url ? String(draft.url) : null,
    active: e.active !== false,
    morningUpdatedAt: parseTimestamp(draft.lastUpdateDate) ?? parseTimestamp(draft.creationDate),
    originalAmount: foreign ? round2(gross) : null,
    isDraft: true,
  };
}

// ─── Sync ──────────────────────────────────────────────────────────────────────

/** Fetch all expenses in [fromDate, toDate] (YYYY-MM-DD), paginating 500 per page. */
export async function fetchMorningExpenses(fromDate: string, toDate: string): Promise<any[]> {
  const all: any[] = [];
  let page = 1;
  while (true) {
    const result = await morningRequest<any>('POST', '/api/v1/expenses/search', {
      pageSize: PAGE_SIZE, page, fromDate, toDate,
    });
    const items: any[] = result?.items || [];
    all.push(...items);
    if (items.length < PAGE_SIZE || all.length >= (result?.total ?? all.length)) break;
    page++;
    if (page > MAX_PAGES) break;
  }
  return all;
}

export interface CompanyExpenseSyncResult {
  fromDate: string;
  toDate: string;
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  syncedAt: Date;
}

let syncRunning = false;
export const isCompanyExpenseSyncRunning = () => syncRunning;

/**
 * Upsert Morning expenses into the mirror.
 * - `full` (or an empty mirror): last FULL_SYNC_MONTHS months.
 * - otherwise: last NIGHTLY_SYNC_DAYS days.
 * Rows not returned are left untouched — `active` only changes when Morning says so.
 */
export async function syncCompanyExpenses(
  opts: { full?: boolean; now?: Date } = {},
): Promise<CompanyExpenseSyncResult> {
  if (!isMorningConfigured()) throw new Error('Morning API credentials are not configured');
  if (syncRunning) throw new Error('Company expenses sync already running');
  syncRunning = true;
  try {
    const now = opts.now ?? new Date();
    const today = israelToday(now);
    const isEmpty = (await prisma.companyExpense.count()) === 0;
    let fromDate: string;
    if (opts.full || isEmpty) {
      fromDate = `${shiftMonth(today.iso.slice(0, 7), -(FULL_SYNC_MONTHS - 1))}-01`;
    } else {
      const d = new Date(`${today.iso}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() - NIGHTLY_SYNC_DAYS);
      fromDate = d.toISOString().slice(0, 10);
    }
    const toDate = today.iso;

    const items = await fetchMorningExpenses(fromDate, toDate);
    const syncedAt = new Date();
    let created = 0;
    let updated = 0;
    let skipped = 0;
    for (const item of items) {
      const data = mapMorningExpense(item);
      if (!data) { skipped++; continue; }
      const existing = await prisma.companyExpense.findUnique({
        where: { morningId: data.morningId }, select: { id: true },
      });
      await prisma.companyExpense.upsert({
        where: { morningId: data.morningId },
        create: { ...data, syncedAt },
        update: { ...data, syncedAt },
      });
      if (existing) updated++; else created++;
    }
    return { fromDate, toDate, fetched: items.length, created, updated, skipped, syncedAt };
  } finally {
    syncRunning = false;
  }
}

// ─── Drafts (uploaded to Morning, not yet approved) ───────────────────────────

const DRAFTS_PAGE_SIZE = 100;

/** Fetch every current Morning expense draft. */
export async function fetchMorningDrafts(): Promise<any[]> {
  const all: any[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await morningRequest<any>('POST', '/api/v1/expenses/drafts/search', {
      pageSize: DRAFTS_PAGE_SIZE, page,
    });
    const items: any[] = result?.items || [];
    all.push(...items);
    if (items.length < DRAFTS_PAGE_SIZE || all.length >= (result?.total ?? all.length)) break;
  }
  return all;
}

/** ILS per unit for each foreign currency, from the most recent approved doc that has both amounts. */
export async function latestIlsRates(): Promise<Record<string, number>> {
  const rows = await prisma.companyExpense.findMany({
    where: { isDraft: false, originalAmount: { not: null }, NOT: { currency: 'ILS' } },
    orderBy: { date: 'desc' },
    select: { currency: true, amount: true, originalAmount: true },
    take: 200,
  });
  const rates: Record<string, number> = {};
  for (const r of rows) {
    const original = Number(r.originalAmount ?? 0);
    if (!r.currency || rates[r.currency] || !original) continue;
    rates[r.currency] = Number(r.amount) / original;
  }
  return rates;
}

export interface DraftSyncResult {
  fetched: number;
  upserted: number;
  /** Draft rows no longer in Morning — approved (they return via the expense sync) or deleted. */
  removed: number;
  /** Foreign-currency drafts stored with ILS 0 because no approved doc gave a rate yet. */
  missingRates: number;
}

let draftSyncRunning = false;
export const isCompanyExpenseDraftSyncRunning = () => draftSyncRunning;

/**
 * Mirror Morning drafts so uploaded-but-unapproved invoices show in the CRM right away.
 * Drafts are a transient list: rows for drafts that disappeared are deleted, since the
 * approved expense comes back under its own id from the regular sync.
 */
export async function syncMorningDrafts(): Promise<DraftSyncResult> {
  if (!isMorningConfigured()) throw new Error('Morning API credentials are not configured');
  if (draftSyncRunning) throw new Error('Company expense drafts sync already running');
  draftSyncRunning = true;
  try {
    const [items, rates] = await Promise.all([fetchMorningDrafts(), latestIlsRates()]);
    const syncedAt = new Date();
    const ids: string[] = [];
    let missingRates = 0;
    for (const item of items) {
      const data = mapMorningDraft(item, rates);
      if (!data) continue;
      ids.push(data.morningId);
      if (data.currency !== 'ILS' && !rates[data.currency ?? '']) missingRates++;
      await prisma.companyExpense.upsert({
        where: { morningId: data.morningId },
        create: { ...data, syncedAt },
        update: { ...data, syncedAt },
      });
    }
    const { count: removed } = await prisma.companyExpense.deleteMany({
      where: { isDraft: true, morningId: { notIn: ids } },
    });
    return { fetched: items.length, upserted: ids.length, removed, missingRates };
  } finally {
    draftSyncRunning = false;
  }
}

/**
 * Drafts first, then approved expenses. When drafts were approved since the last run, the
 * expense sync widens to the full window so approvals of older-dated invoices arrive too.
 * Drafts are re-mirrored afterwards if some lacked an exchange rate the expense sync may supply.
 */
export async function syncCompanyExpensesAndDrafts(
  opts: { full?: boolean; now?: Date } = {},
): Promise<CompanyExpenseSyncResult & { drafts: DraftSyncResult }> {
  let drafts = await syncMorningDrafts();
  const result = await syncCompanyExpenses({ ...opts, full: opts.full || drafts.removed > 0 });
  if (drafts.missingRates > 0) drafts = { ...(await syncMorningDrafts()), removed: drafts.removed };
  return { ...result, drafts };
}

// ─── Overview math (pure) ─────────────────────────────────────────────────────

export interface ExpenseRowLike {
  id?: string;
  morningId?: string;
  status: number | null;
  date: Date | null;
  reportingDate: Date | null;
  amount: unknown;
  amountExcludeVat: unknown;
  vat: unknown;
  supplierId: string | null;
  supplierName: string | null;
  categoryTitle: string | null;
  description?: string | null;
  number?: string | null;
  url?: string | null;
  isDraft?: boolean;
  /** CRM-only activity-month override for freelancer invoices ("YYYY-MM"). */
  activityMonth?: string | null;
  active: boolean;
}

/** Month bucket = reporting month (חודש דיווח, as Morning reports group) else doc date. */
export function expenseMonthKey(row: Pick<ExpenseRowLike, 'date' | 'reportingDate'>): string | null {
  const d = row.reportingDate ?? row.date;
  return d ? d.toISOString().slice(0, 7) : null;
}

export function expenseGross(row: Pick<ExpenseRowLike, 'amount'>): number {
  return num(row.amount?.toString()) ?? 0;
}

export function expenseNet(row: Pick<ExpenseRowLike, 'amount' | 'amountExcludeVat' | 'vat'>): number {
  const net = num(row.amountExcludeVat?.toString());
  if (net !== null) return net;
  const vat = num(row.vat?.toString());
  return expenseGross(row) - (vat ?? 0);
}

/**
 * Month of the invoice itself (document date, else reporting month). Used for "did this
 * supplier's invoice for month X arrive" — late invoices are often reported in a later VAT
 * period, which must not make the original month look missing.
 */
export function invoiceMonthKey(row: Pick<ExpenseRowLike, 'date' | 'reportingDate'>): string | null {
  const d = row.date ?? row.reportingDate;
  return d ? d.toISOString().slice(0, 7) : null;
}

/** Prisma `where` fragment for expenses whose invoice month (doc date, else reporting) is in range. */
export function invoiceMonthRangeWhere(fromMonth: string, toMonth: string) {
  const gte = monthStart(fromMonth);
  const lt = monthStart(shiftMonth(toMonth, 1));
  return {
    OR: [
      { date: { gte, lt } },
      { date: null, reportingDate: { gte, lt } },
    ],
  };
}

/** Prisma `where` fragment for expenses whose bucket month is in [fromMonth, toMonth]. */
export function monthRangeWhere(fromMonth: string, toMonth: string) {
  const gte = monthStart(fromMonth);
  const lt = monthStart(shiftMonth(toMonth, 1));
  return {
    OR: [
      { reportingDate: { gte, lt } },
      { reportingDate: null, date: { gte, lt } },
    ],
  };
}

export const supplierKey = (r: { supplierId?: string | null; supplierName?: string | null }) =>
  r.supplierId ? `id:${r.supplierId}` : `name:${(r.supplierName || '').trim().toLowerCase()}`;

interface Totals { gross: number; net: number; count: number }
const emptyTotals = (): Totals => ({ gross: 0, net: 0, count: 0 });
const roundTotals = (t: Totals): Totals => ({ gross: round2(t.gross), net: round2(t.net), count: t.count });

/** Freelancer pay of one month by activity (work) month — see buildFreelancerActivityOverview. */
export interface FreelancerActivityLike {
  month: string;
  expected: number;
  invoicedNet: number;
  invoicedGross: number;
  invoicedCount: number;
}

/** Overview of one month: non-freelancer docs (reporting month) + freelancer pay (activity month). */
export interface MonthOverview {
  /** other.gross + freelancerExpected. */
  gross: number;
  other: Totals;
  freelancerExpected: number;
  freelancerInvoicedNet: number;
  freelancerInvoicedGross: number;
  freelancerInvoicedCount: number;
}

export interface ExpenseSummary {
  currentMonth: string;
  /**
   * gross/net/count = all docs by reporting month (unchanged).
   * freelancerGross/Net = LEGACY: linked freelancer docs by *reporting* month (kept for compatibility;
   * the UI no longer charts them). otherGross/otherNet = gross/net minus those.
   * freelancerExpected / freelancerInvoiced* = freelancer pay by *activity* month: salary-report
   * grandTotal and receipts bucketed by activityMonthOf (0 when no freelancer data was passed).
   */
  months: Array<{
    month: string;
    freelancerGross: number;
    freelancerNet: number;
    otherGross: number;
    otherNet: number;
    freelancerExpected: number;
    freelancerInvoicedNet: number;
    freelancerInvoicedGross: number;
    freelancerInvoicedCount: number;
  } & Totals>;
  kpis: {
    thisMonth: Totals;
    /** LEGACY (reporting month) — see months[].freelancerGross. */
    thisMonthFreelancers: Totals;
    thisMonthOther: Totals;
    lastMonth: Totals;
    /** Average of the 3 full months before the current one. */
    threeMonthAvg: { gross: number; net: number };
    /** Activity-month basis: other expenses + freelancer pay per salary report. */
    thisMonthOverview: MonthOverview;
    lastMonthOverview: MonthOverview;
    threeMonthAvgOverview: { gross: number };
    pendingCount: number;
    pendingGross: number;
  };
  byCategory: Array<{ category: string } & Totals>;
  /** Most frequent suppliers — freelancer suppliers excluded. */
  topSuppliers: Array<{ supplierName: string; supplierId: string | null } & Totals>;
  pending: ExpenseRowLike[];
}

export type ExpenseRowPredicate = (row: ExpenseRowLike) => boolean;

/**
 * Build the overview from active mirror rows. `monthsBack` months ending with the current
 * Israel month; category/supplier breakdowns cover that same window. `isFreelancer` marks
 * freelancer-pay invoices: split out per month/KPI and excluded from topSuppliers.
 * `freelancerActivity` supplies freelancer pay by activity month for the *Overview fields.
 */
export function buildExpenseSummary(
  rows: ExpenseRowLike[],
  now: Date = new Date(),
  monthsBack = 12,
  topN = 10,
  isFreelancer: ExpenseRowPredicate = () => false,
  freelancerActivity: FreelancerActivityLike[] = [],
): ExpenseSummary {
  const currentMonth = israelToday(now).iso.slice(0, 7);
  const monthKeys = Array.from({ length: monthsBack }, (_, i) => shiftMonth(currentMonth, i - monthsBack + 1));
  const inWindow = new Set(monthKeys);
  const byMonth = new Map<string, Totals>(monthKeys.map((m) => [m, emptyTotals()]));
  const byCategory = new Map<string, Totals>();
  const bySupplier = new Map<string, { supplierName: string; supplierId: string | null } & Totals>();
  const extraMonths = new Map<string, Totals>(); // for KPIs when monthsBack < 4
  const freelancerByMonth = new Map<string, Totals>();

  const pending: ExpenseRowLike[] = [];
  let pendingGross = 0;

  for (const row of rows) {
    if (!row.active) continue;
    const gross = expenseGross(row);
    const net = expenseNet(row);
    if (row.status === EXPENSE_STATUS_PENDING) {
      pending.push(row);
      pendingGross += gross;
    }
    const month = expenseMonthKey(row);
    if (!month) continue;
    const bucket = byMonth.get(month) ?? (() => {
      if (!extraMonths.has(month)) extraMonths.set(month, emptyTotals());
      return extraMonths.get(month)!;
    })();
    bucket.gross += gross; bucket.net += net; bucket.count++;
    const freelancer = isFreelancer(row);
    if (freelancer) {
      const f = freelancerByMonth.get(month) ?? emptyTotals();
      f.gross += gross; f.net += net; f.count++;
      freelancerByMonth.set(month, f);
    }
    if (!inWindow.has(month)) continue;

    const cat = row.categoryTitle || 'ללא סיווג';
    const c = byCategory.get(cat) ?? emptyTotals();
    c.gross += gross; c.net += net; c.count++;
    byCategory.set(cat, c);

    if (freelancer) continue;
    const key = supplierKey(row);
    const s = bySupplier.get(key) ?? { supplierName: row.supplierName || 'ללא ספק', supplierId: row.supplierId, ...emptyTotals() };
    s.gross += gross; s.net += net; s.count++;
    bySupplier.set(key, s);
  }

  const totalsFor = (m: string) => byMonth.get(m) ?? extraMonths.get(m) ?? emptyTotals();
  const freelancerFor = (m: string) => freelancerByMonth.get(m) ?? emptyTotals();
  const prev3 = [1, 2, 3].map((i) => totalsFor(shiftMonth(currentMonth, -i)));
  const thisAll = totalsFor(currentMonth);
  const thisFreelancers = freelancerFor(currentMonth);
  const activityBy = new Map(freelancerActivity.map((a) => [a.month, a]));
  const otherFor = (m: string): Totals => {
    const t = totalsFor(m);
    const f = freelancerFor(m);
    return { gross: round2(t.gross - f.gross), net: round2(t.net - f.net), count: t.count - f.count };
  };
  const overviewFor = (m: string): MonthOverview => {
    const other = otherFor(m);
    const a = activityBy.get(m);
    const expected = a?.expected ?? 0;
    return {
      gross: round2(other.gross + expected),
      other,
      freelancerExpected: round2(expected),
      freelancerInvoicedNet: round2(a?.invoicedNet ?? 0),
      freelancerInvoicedGross: round2(a?.invoicedGross ?? 0),
      freelancerInvoicedCount: a?.invoicedCount ?? 0,
    };
  };

  return {
    currentMonth,
    months: monthKeys.map((m) => {
      const o = overviewFor(m);
      return {
        month: m,
        ...roundTotals(totalsFor(m)),
        freelancerGross: round2(freelancerFor(m).gross),
        freelancerNet: round2(freelancerFor(m).net),
        otherGross: o.other.gross,
        otherNet: o.other.net,
        freelancerExpected: o.freelancerExpected,
        freelancerInvoicedNet: o.freelancerInvoicedNet,
        freelancerInvoicedGross: o.freelancerInvoicedGross,
        freelancerInvoicedCount: o.freelancerInvoicedCount,
      };
    }),
    kpis: {
      thisMonth: roundTotals(thisAll),
      thisMonthFreelancers: roundTotals(thisFreelancers),
      thisMonthOther: roundTotals({
        gross: thisAll.gross - thisFreelancers.gross,
        net: thisAll.net - thisFreelancers.net,
        count: thisAll.count - thisFreelancers.count,
      }),
      lastMonth: roundTotals(totalsFor(shiftMonth(currentMonth, -1))),
      threeMonthAvg: {
        gross: round2(prev3.reduce((s, t) => s + t.gross, 0) / 3),
        net: round2(prev3.reduce((s, t) => s + t.net, 0) / 3),
      },
      thisMonthOverview: overviewFor(currentMonth),
      lastMonthOverview: overviewFor(shiftMonth(currentMonth, -1)),
      threeMonthAvgOverview: {
        gross: round2([1, 2, 3].reduce((s, i) => s + overviewFor(shiftMonth(currentMonth, -i)).gross, 0) / 3),
      },
      pendingCount: pending.length,
      pendingGross: round2(pendingGross),
    },
    byCategory: [...byCategory.entries()]
      .map(([category, t]) => ({ category, ...roundTotals(t) }))
      .sort((a, b) => b.gross - a.gross),
    topSuppliers: [...bySupplier.values()]
      .map((s) => ({ ...s, gross: round2(s.gross), net: round2(s.net) }))
      // Most frequent suppliers (document count), not the most expensive ones.
      .sort((a, b) => b.count - a.count || b.gross - a.gross)
      .slice(0, topN),
    pending: pending.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0)),
  };
}

/** API shape for a mirror row (Decimal → number, dates → YYYY-MM-DD). */
export function serializeCompanyExpense(r: any) {
  const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
  return {
    id: r.id,
    morningId: r.morningId,
    status: r.status,
    documentType: r.documentType ?? null,
    number: r.number ?? null,
    date: day(r.date),
    reportingDate: day(r.reportingDate),
    month: expenseMonthKey(r),
    amount: expenseGross(r),
    amountExcludeVat: r.amountExcludeVat === null || r.amountExcludeVat === undefined ? null : Number(r.amountExcludeVat.toString()),
    vat: r.vat === null || r.vat === undefined ? null : Number(r.vat.toString()),
    currency: r.currency ?? null,
    originalAmount: r.originalAmount === null || r.originalAmount === undefined ? null : Number(r.originalAmount.toString()),
    isDraft: r.isDraft === true,
    activityMonthOverride: r.activityMonth ?? null,
    description: r.description ?? null,
    supplierId: r.supplierId ?? null,
    supplierName: r.supplierName ?? null,
    categoryId: r.categoryId ?? null,
    categoryTitle: r.categoryTitle ?? null,
    url: r.url ?? null,
    active: r.active,
    syncedAt: r.syncedAt ?? null,
  };
}
