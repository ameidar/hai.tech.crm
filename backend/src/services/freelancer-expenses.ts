// Freelancer pay (שכר פרילנסרים) on top of the CompanyExpense mirror: freelancers bill under
// their own business names in Morning, so an explicit supplier ↔ instructor link table tells
// their invoices apart from other company expenses, and a monthly reconciliation compares
// what each freelancer invoiced (net) against the official monthly salary report.
import { prisma } from '../utils/prisma.js';
import {
  expenseGross,
  expenseNet,
  israelToday,
  monthStart,
  serializeCompanyExpense,
  shiftMonth,
  supplierKey,
  type ExpenseRowLike,
} from './company-expenses.js';
import { normalizeSupplierName } from './recurring-expenses.js';
import { buildInstructorMonthlyReport } from './instructorReport.service.js';

const round2 = (n: number) => Math.round(n * 100) / 100;

export const SUGGESTION_WINDOW_MONTHS = 13;
export const MATCH_TOLERANCE_ILS = 5;
export const MATCH_TOLERANCE_PCT = 1;

// ─── Link resolution ──────────────────────────────────────────────────────────

export interface FreelancerLinkLike {
  id?: string;
  instructorId: string;
  supplierId: string | null;
  supplierName: string;
}

type SupplierRef = { supplierId?: string | null; supplierName?: string | null };

/**
 * Resolver for "which instructor does this expense belong to": by Morning supplier id when a
 * link carries it, else by normalized supplier name.
 */
export function buildLinkResolver<L extends FreelancerLinkLike>(links: L[]) {
  const byId = new Map<string, L>();
  const byName = new Map<string, L>();
  for (const l of links) {
    if (l.supplierId) byId.set(l.supplierId, l);
    const n = normalizeSupplierName(l.supplierName);
    if (n && !byName.has(n)) byName.set(n, l);
  }
  return (row: SupplierRef): L | null => {
    if (row.supplierId && byId.has(row.supplierId)) return byId.get(row.supplierId)!;
    const n = normalizeSupplierName(row.supplierName);
    return (n && byName.get(n)) || null;
  };
}

export function isFreelancerExpense(row: SupplierRef, links: FreelancerLinkLike[]): boolean {
  return buildLinkResolver(links)(row) !== null;
}

export async function loadFreelancerLinks() {
  return prisma.instructorExpenseSupplier.findMany({
    include: { instructor: { select: { id: true, name: true, employmentType: true, isActive: true } } },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Prisma `where` for `kind=freelancer|other` on the expenses list. Resolution is done in JS
 * over the distinct (supplierId, supplierName) pairs so it matches the name normalization
 * exactly; the result is a positive OR of pairs (no NOT — avoids SQL NULL pitfalls).
 */
export async function freelancerKindWhere(kind: 'freelancer' | 'other') {
  const links = await prisma.instructorExpenseSupplier.findMany({
    select: { instructorId: true, supplierId: true, supplierName: true },
  });
  const resolve = buildLinkResolver(links);
  const pairs = await prisma.companyExpense.findMany({
    distinct: ['supplierId', 'supplierName'],
    select: { supplierId: true, supplierName: true },
  });
  const selected = pairs.filter((p) => (resolve(p) !== null) === (kind === 'freelancer'));
  return { OR: selected.map((p) => ({ supplierId: p.supplierId, supplierName: p.supplierName })) };
}

// ─── Activity month ───────────────────────────────────────────────────────────

/** Receipts dated on/after this day of the month pay for that same month (month-end billing). */
export const SAME_MONTH_FROM_DAY = 25;

/**
 * Month of activity an invoice pays for: the CRM override; else by document date — dated on
 * day ≥ 25 → that month (issued at month end, e.g. 30/09 is September work), earlier → the
 * previous month (receipts for M are issued early in M+1); no document date → the month
 * before the reporting date.
 */
export function activityMonthOf(row: Pick<ExpenseRowLike, 'date' | 'reportingDate' | 'activityMonth'>): string | null {
  if (row.activityMonth) return row.activityMonth;
  if (row.date) {
    const month = row.date.toISOString().slice(0, 7);
    return row.date.getUTCDate() >= SAME_MONTH_FROM_DAY ? month : shiftMonth(month, -1);
  }
  return row.reportingDate ? shiftMonth(row.reportingDate.toISOString().slice(0, 7), -1) : null;
}

/**
 * Prisma `where` (active rows) that is a superset of every doc whose activityMonthOf may fall in
 * [fromMonth, toMonth]; callers still filter with activityMonthOf. Dated docs: [from, to+2);
 * undated: reporting date in [from+1, to+2); plus overrides pointing into the range.
 */
export function activityRangeWhere(fromMonth: string, toMonth: string) {
  const months: string[] = [];
  for (let m = fromMonth; m <= toMonth; m = shiftMonth(m, 1)) months.push(m);
  const lt = monthStart(shiftMonth(toMonth, 2));
  return {
    active: true,
    OR: [
      { activityMonth: { in: months } },
      { activityMonth: null, date: { gte: monthStart(fromMonth), lt } },
      { activityMonth: null, date: null, reportingDate: { gte: monthStart(shiftMonth(fromMonth, 1)), lt } },
    ],
  };
}

// ─── Reconciliation ───────────────────────────────────────────────────────────

export type ReconciliationStatus = 'match' | 'mismatch' | 'missing_invoice' | 'no_activity';

/** Tolerance |diff| ≤ max(₪5, 1% of expected). */
export function reconciliationTolerance(expected: number): number {
  return Math.max(MATCH_TOLERANCE_ILS, Math.abs(expected) * (MATCH_TOLERANCE_PCT / 100));
}

export function reconciliationStatus(
  expected: number,
  invoicedNet: number,
  invoiceCount: number,
  invoicedGross: number = invoicedNet,
): ReconciliationStatus {
  return reconcile(expected, invoicedNet, invoicedGross, invoiceCount).status;
}

/**
 * Status + diff. A match on either the net or the gross amount counts: VAT-registered
 * freelancers (עוסק מורשה) have CRM pay that already equals their VAT-inclusive invoice.
 * `diff` is against whichever amount matched (net when neither / both).
 */
export function reconcile(expected: number, invoicedNet: number, invoicedGross: number, invoiceCount: number) {
  const tol = reconciliationTolerance(expected);
  const netOk = Math.abs(invoicedNet - expected) <= tol;
  const grossOk = Math.abs(invoicedGross - expected) <= tol;
  const matchedOn: 'net' | 'gross' | null = netOk ? 'net' : grossOk ? 'gross' : null;
  const diff = round2((matchedOn === 'gross' ? invoicedGross : invoicedNet) - expected);
  let status: ReconciliationStatus;
  if (expected > 0 && invoiceCount === 0) status = 'missing_invoice';
  else if (expected <= 0 && invoiceCount > 0) status = 'no_activity';
  else status = matchedOn ? 'match' : 'mismatch';
  return { status, matchedOn: status === 'match' ? matchedOn : null, diff };
}

export interface FreelancerReconciliationRow {
  instructorId: string;
  name: string;
  isActive: boolean;
  /** Has at least one linked Morning supplier. */
  linked: boolean;
  suppliers: string[];
  expected: { meetings: number; hours: number; payment: number; expenses: number; fixedAdditions: number; grandTotal: number };
  invoiced: { net: number; gross: number; count: number; hasDrafts: boolean };
  /** vs. the invoiced amount that matched (`matchedOn`), else vs. net. */
  diff: number;
  matchedOn: 'net' | 'gross' | null;
  status: ReconciliationStatus;
  expenses: Array<ReturnType<typeof serializeCompanyExpense> & { activityMonth: string | null }>;
}

export interface FreelancerReconciliation {
  month: string;
  rows: FreelancerReconciliationRow[];
  /** diff = sum of row diffs (each against its matched amount). */
  totals: { expected: number; invoicedNet: number; invoicedGross: number; diff: number; problems: number };
}

type ExpectedTotals = FreelancerReconciliationRow['expected'];
type MonthlyReport = Awaited<ReturnType<typeof buildInstructorMonthlyReport>>;

/**
 * Salary-report amounts per freelancer: instructors[] rows plus approved hours of freelance
 * operations staff. Shared by the reconciliation and the overview so their numbers agree.
 */
export function freelancerExpectedByInstructor(
  report: Pick<MonthlyReport, 'instructors' | 'operationsStaff'>,
  freelancerIds: { has(id: string): boolean },
): Map<string, ExpectedTotals> {
  const out = new Map<string, ExpectedTotals>();
  const get = (id: string) => {
    if (!out.has(id)) out.set(id, { meetings: 0, hours: 0, payment: 0, expenses: 0, fixedAdditions: 0, grandTotal: 0 });
    return out.get(id)!;
  };
  for (const r of report.instructors) {
    if (!freelancerIds.has(r.instructorId)) continue;
    const e = get(r.instructorId);
    e.meetings += r.totalMeetings;
    e.hours += r.totalHours;
    e.payment += r.totalPayment;
    e.expenses += r.totalExpenses;
    e.fixedAdditions += r.fixedAdditionsTotal;
    e.grandTotal += r.grandTotal;
  }
  // Freelance operations staff are paid by approved hours (not part of instructors[]).
  for (const o of report.operationsStaff ?? []) {
    if (!freelancerIds.has(o.instructorId) || !o.approvedPayment) continue;
    const e = get(o.instructorId);
    e.hours += o.approvedHours;
    e.payment += o.approvedPayment;
    e.grandTotal += o.approvedPayment;
  }
  return out;
}

export const previousIsraelMonth = (now: Date = new Date()) => shiftMonth(israelToday(now).iso.slice(0, 7), -1);

/** Expected (salary report) vs invoiced (linked Morning docs, net) per freelancer for `month`. */
export async function buildFreelancerReconciliation(month: string): Promise<FreelancerReconciliation> {
  const [report, freelancers, links, candidates] = await Promise.all([
    buildInstructorMonthlyReport(month),
    prisma.instructor.findMany({
      where: { employmentType: 'freelancer' },
      select: { id: true, name: true, isActive: true },
    }),
    prisma.instructorExpenseSupplier.findMany({
      select: { id: true, instructorId: true, supplierId: true, supplierName: true },
    }),
    // Superset of docs whose activity month may be `month`; narrowed by activityMonthOf below.
    prisma.companyExpense.findMany({
      where: activityRangeWhere(month, month),
      orderBy: [{ date: 'asc' }, { number: 'asc' }],
    }),
  ]);

  const freelancerById = new Map(freelancers.map((f) => [f.id, f]));
  const resolve = buildLinkResolver(links);
  const suppliersOf = new Map<string, string[]>();
  for (const l of links) suppliersOf.set(l.instructorId, [...(suppliersOf.get(l.instructorId) ?? []), l.supplierName]);

  type Acc = { expected: FreelancerReconciliationRow['expected']; docs: any[] };
  const acc = new Map<string, Acc>();
  const get = (id: string) => {
    if (!acc.has(id)) {
      acc.set(id, { expected: { meetings: 0, hours: 0, payment: 0, expenses: 0, fixedAdditions: 0, grandTotal: 0 }, docs: [] });
    }
    return acc.get(id)!;
  };

  for (const [id, e] of freelancerExpectedByInstructor(report, freelancerById)) get(id).expected = e;

  for (const row of candidates) {
    if (activityMonthOf(row) !== month) continue;
    const link = resolve(row);
    if (!link || !freelancerById.has(link.instructorId)) continue;
    get(link.instructorId).docs.push(row);
  }

  const rows: FreelancerReconciliationRow[] = [];
  for (const [instructorId, { expected, docs }] of acc) {
    const f = freelancerById.get(instructorId)!;
    const net = round2(docs.reduce((s, d) => s + expenseNet(d), 0));
    const gross = round2(docs.reduce((s, d) => s + expenseGross(d), 0));
    const rec = reconcile(round2(expected.grandTotal), net, gross, docs.length);
    const exp = {
      meetings: expected.meetings,
      hours: round2(expected.hours),
      payment: round2(expected.payment),
      expenses: round2(expected.expenses),
      fixedAdditions: round2(expected.fixedAdditions),
      grandTotal: round2(expected.grandTotal),
    };
    rows.push({
      instructorId,
      name: f.name,
      isActive: f.isActive,
      linked: suppliersOf.has(instructorId),
      suppliers: suppliersOf.get(instructorId) ?? [],
      expected: exp,
      invoiced: { net, gross, count: docs.length, hasDrafts: docs.some((d) => d.isDraft === true) },
      diff: rec.diff,
      matchedOn: rec.matchedOn,
      status: rec.status,
      expenses: docs.map((d) => ({ ...serializeCompanyExpense(d), activityMonth: activityMonthOf(d) })),
    });
  }
  const order: Record<ReconciliationStatus, number> = { mismatch: 0, missing_invoice: 1, no_activity: 2, match: 3 };
  rows.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name, 'he'));

  const expectedTotal = round2(rows.reduce((s, r) => s + r.expected.grandTotal, 0));
  const invoicedNet = round2(rows.reduce((s, r) => s + r.invoiced.net, 0));
  return {
    month,
    rows,
    totals: {
      expected: expectedTotal,
      invoicedNet,
      invoicedGross: round2(rows.reduce((s, r) => s + r.invoiced.gross, 0)),
      diff: round2(rows.reduce((s, r) => s + r.diff, 0)),
      problems: rows.filter((r) => r.status !== 'match').length,
    },
  };
}

// ─── Overview by activity month ───────────────────────────────────────────────

export interface FreelancerMonthActivity {
  month: string;
  /** Salary-report grandTotal of all freelancers (same basis as the reconciliation). */
  expected: number;
  /** Linked freelancer receipts whose activityMonthOf is this month. */
  invoicedNet: number;
  invoicedGross: number;
  invoicedCount: number;
}

/** Pure: per month, sum of freelancer receipts bucketed by activity month (not reporting month). */
export function groupFreelancerInvoicesByActivity(
  rows: ExpenseRowLike[],
  months: string[],
  isFreelancer: (row: ExpenseRowLike) => boolean,
): Map<string, { net: number; gross: number; count: number }> {
  const out = new Map(months.map((m) => [m, { net: 0, gross: 0, count: 0 }]));
  for (const row of rows) {
    if (!row.active || !isFreelancer(row)) continue;
    const m = activityMonthOf(row);
    const t = m ? out.get(m) : undefined;
    if (!t) continue;
    t.net += expenseNet(row);
    t.gross += expenseGross(row);
    t.count++;
  }
  for (const t of out.values()) { t.net = round2(t.net); t.gross = round2(t.gross); }
  return out;
}

export const EXPECTED_CACHE_TTL_MS = 10 * 60 * 1000;
const expectedCache = new Map<string, { at: number; value: number }>();
export const clearFreelancerExpectedCache = () => expectedCache.clear();

/** Total salary-report pay of all freelancers for `month`, memoized in-process for 10 minutes. */
export async function freelancerExpectedTotal(
  month: string,
  freelancerIds: { has(id: string): boolean },
  nowMs: number = Date.now(),
): Promise<number> {
  const hit = expectedCache.get(month);
  if (hit && nowMs - hit.at < EXPECTED_CACHE_TTL_MS) return hit.value;
  const report = await buildInstructorMonthlyReport(month);
  let total = 0;
  for (const e of freelancerExpectedByInstructor(report, freelancerIds).values()) total += e.grandTotal;
  const value = round2(total);
  expectedCache.set(month, { at: nowMs, value });
  return value;
}

const REPORT_CONCURRENCY = 3;

/**
 * Freelancer pay for each month in `months` by activity (work) month: expected from the salary
 * report and receipts received (linked docs via activityMonthOf). Feeds the overview screen.
 */
export async function buildFreelancerActivityOverview(
  months: string[],
  nowMs: number = Date.now(),
): Promise<FreelancerMonthActivity[]> {
  if (months.length === 0) return [];
  const sorted = [...months].sort();
  const [freelancers, links, rows] = await Promise.all([
    prisma.instructor.findMany({ where: { employmentType: 'freelancer' }, select: { id: true } }),
    prisma.instructorExpenseSupplier.findMany({ select: { instructorId: true, supplierId: true, supplierName: true } }),
    prisma.companyExpense.findMany({ where: activityRangeWhere(sorted[0], sorted[sorted.length - 1]) }),
  ]);
  const ids = new Set(freelancers.map((f) => f.id));
  const resolve = buildLinkResolver(links);
  const invoiced = groupFreelancerInvoicesByActivity(rows as ExpenseRowLike[], months, (r) => {
    const l = resolve(r);
    return !!l && ids.has(l.instructorId);
  });
  const expected = new Map<string, number>();
  for (let i = 0; i < months.length; i += REPORT_CONCURRENCY) {
    const chunk = months.slice(i, i + REPORT_CONCURRENCY);
    const values = await Promise.all(chunk.map((m) => freelancerExpectedTotal(m, ids, nowMs)));
    chunk.forEach((m, j) => expected.set(m, values[j]));
  }
  return months.map((month) => {
    const inv = invoiced.get(month)!;
    return { month, expected: expected.get(month) ?? 0, invoicedNet: inv.net, invoicedGross: inv.gross, invoicedCount: inv.count };
  });
}

// ─── Link suggestions ─────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'בעמ', 'בע', 'מ', 'חברה', 'חברת', 'עוסק', 'מורשה', 'פטור', 'שירותי', 'שירותים', 'פתרונות',
  'ltd', 'inc', 'llc', 'co', 'the', 'and', 'company', 'group', 'services', 'solutions',
]);

/** Name words worth matching on: normalized, ≥3 chars, not a business-form word. */
export function nameTokens(s: string | null | undefined): string[] {
  const n = normalizeSupplierName(s).replace(/בע מ/g, ' ');
  return [...new Set(n.split(' ').filter((t) => t.length >= 3 && !STOP_WORDS.has(t)))];
}

/** Letter runs (≥3) of an email local part, plus the whole letters-only local part. */
function emailTokens(email: string | null | undefined): { parts: string[]; whole: string } {
  const local = (email || '').split('@')[0].toLowerCase();
  const parts = local.split(/[^a-z]+/).filter((p) => p.length >= 3 && !STOP_WORDS.has(p));
  return { parts, whole: local.replace(/[^a-z]/g, '') };
}

export interface SuggestionCandidate {
  instructorId: string;
  name: string;
  score: number;
  reasons: string[];
}

/** Score how likely `supplierName` is the business name of this instructor (0 = no match). */
export function scoreCandidate(
  supplierName: string,
  instructor: { name: string; email?: string | null },
): { score: number; reasons: string[] } {
  const supplier = normalizeSupplierName(supplierName);
  const words = new Set(supplier.split(' '));
  const compact = supplier.replace(/\s+/g, '');
  let score = 0;
  const reasons: string[] = [];
  for (const t of nameTokens(instructor.name)) {
    if (words.has(t)) { score += 2; reasons.push(`name:${t}`); } else if (supplier.includes(t)) { score += 1; reasons.push(`name~${t}`); }
  }
  const { parts, whole } = emailTokens(instructor.email);
  if (whole.length >= 4 && compact.includes(whole)) { score += 3; reasons.push('email'); } else {
    for (const p of parts) if (words.has(p)) { score += 2; reasons.push(`email:${p}`); }
  }
  return { score, reasons };
}

export interface FreelancerLinkSuggestion {
  supplierId: string | null;
  supplierName: string;
  docCount: number;
  gross: number;
  net: number;
  lastDate: string | null;
  candidates: SuggestionCandidate[];
}

/** Pure part of suggestFreelancerLinks — unlinked suppliers with ranked candidates. */
export function buildLinkSuggestions(
  rows: ExpenseRowLike[],
  links: FreelancerLinkLike[],
  instructors: Array<{ id: string; name: string; email?: string | null; isActive?: boolean }>,
  maxCandidates = 3,
): FreelancerLinkSuggestion[] {
  const resolve = buildLinkResolver(links);
  const groups = new Map<string, FreelancerLinkSuggestion>();
  for (const r of rows) {
    if (!r.supplierName || resolve(r)) continue;
    const key = supplierKey(r);
    const g = groups.get(key) ?? { supplierId: r.supplierId, supplierName: r.supplierName, docCount: 0, gross: 0, net: 0, lastDate: null, candidates: [] };
    g.docCount++;
    g.gross += expenseGross(r);
    g.net += expenseNet(r);
    const day = r.date ? r.date.toISOString().slice(0, 10) : null;
    if (day && (!g.lastDate || day > g.lastDate)) g.lastDate = day;
    groups.set(key, g);
  }
  const out = [...groups.values()].map((g) => {
    const candidates = instructors
      .map((i) => ({ instructorId: i.id, name: i.name, active: i.isActive !== false, ...scoreCandidate(g.supplierName, i) }))
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score || Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'he'))
      .slice(0, maxCandidates)
      .map(({ active: _active, ...c }) => c);
    return { ...g, gross: round2(g.gross), net: round2(g.net), candidates };
  });
  return out.sort((a, b) =>
    Number(b.candidates.length > 0) - Number(a.candidates.length > 0)
    || (b.candidates[0]?.score ?? 0) - (a.candidates[0]?.score ?? 0)
    || b.docCount - a.docCount);
}

/** Unlinked Morning suppliers (last 13 months) with candidate freelancer instructors. */
export async function suggestFreelancerLinks(now: Date = new Date()) {
  const current = israelToday(now).iso.slice(0, 7);
  const from = monthStart(shiftMonth(current, -(SUGGESTION_WINDOW_MONTHS - 1)));
  const [rows, links, instructors] = await Promise.all([
    prisma.companyExpense.findMany({
      where: { active: true, OR: [{ date: { gte: from } }, { date: null, reportingDate: { gte: from } }] },
      select: {
        supplierId: true, supplierName: true, date: true, reportingDate: true, amount: true,
        amountExcludeVat: true, vat: true, status: true, categoryTitle: true, active: true,
      },
    }),
    prisma.instructorExpenseSupplier.findMany({ select: { instructorId: true, supplierId: true, supplierName: true } }),
    prisma.instructor.findMany({
      where: { employmentType: 'freelancer' },
      select: { id: true, name: true, email: true, isActive: true },
      orderBy: { name: 'asc' },
    }),
  ]);
  return {
    suggestions: buildLinkSuggestions(rows as ExpenseRowLike[], links, instructors),
    instructors: instructors.map((i) => ({ id: i.id, name: i.name, isActive: i.isActive })),
  };
}
