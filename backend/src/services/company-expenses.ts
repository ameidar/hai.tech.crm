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

export interface ExpenseSummary {
  currentMonth: string;
  months: Array<{ month: string } & Totals>;
  kpis: {
    thisMonth: Totals;
    lastMonth: Totals;
    /** Average of the 3 full months before the current one. */
    threeMonthAvg: { gross: number; net: number };
    pendingCount: number;
    pendingGross: number;
  };
  byCategory: Array<{ category: string } & Totals>;
  topSuppliers: Array<{ supplierName: string; supplierId: string | null } & Totals>;
  pending: ExpenseRowLike[];
}

/**
 * Build the overview from active mirror rows. `monthsBack` months ending with the current
 * Israel month; category/supplier breakdowns cover that same window.
 */
export function buildExpenseSummary(
  rows: ExpenseRowLike[],
  now: Date = new Date(),
  monthsBack = 12,
  topN = 10,
): ExpenseSummary {
  const currentMonth = israelToday(now).iso.slice(0, 7);
  const monthKeys = Array.from({ length: monthsBack }, (_, i) => shiftMonth(currentMonth, i - monthsBack + 1));
  const inWindow = new Set(monthKeys);
  const byMonth = new Map<string, Totals>(monthKeys.map((m) => [m, emptyTotals()]));
  const byCategory = new Map<string, Totals>();
  const bySupplier = new Map<string, { supplierName: string; supplierId: string | null } & Totals>();
  const extraMonths = new Map<string, Totals>(); // for KPIs when monthsBack < 4

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
    if (!inWindow.has(month)) continue;

    const cat = row.categoryTitle || 'ללא סיווג';
    const c = byCategory.get(cat) ?? emptyTotals();
    c.gross += gross; c.net += net; c.count++;
    byCategory.set(cat, c);

    const key = supplierKey(row);
    const s = bySupplier.get(key) ?? { supplierName: row.supplierName || 'ללא ספק', supplierId: row.supplierId, ...emptyTotals() };
    s.gross += gross; s.net += net; s.count++;
    bySupplier.set(key, s);
  }

  const totalsFor = (m: string) => byMonth.get(m) ?? extraMonths.get(m) ?? emptyTotals();
  const prev3 = [1, 2, 3].map((i) => totalsFor(shiftMonth(currentMonth, -i)));

  return {
    currentMonth,
    months: monthKeys.map((m) => ({ month: m, ...roundTotals(totalsFor(m)) })),
    kpis: {
      thisMonth: roundTotals(totalsFor(currentMonth)),
      lastMonth: roundTotals(totalsFor(shiftMonth(currentMonth, -1))),
      threeMonthAvg: {
        gross: round2(prev3.reduce((s, t) => s + t.gross, 0) / 3),
        net: round2(prev3.reduce((s, t) => s + t.net, 0) / 3),
      },
      pendingCount: pending.length,
      pendingGross: round2(pendingGross),
    },
    byCategory: [...byCategory.entries()]
      .map(([category, t]) => ({ category, ...roundTotals(t) }))
      .sort((a, b) => b.gross - a.gross),
    topSuppliers: [...bySupplier.values()]
      .map((s) => ({ ...s, gross: round2(s.gross), net: round2(s.net) }))
      .sort((a, b) => b.gross - a.gross)
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
