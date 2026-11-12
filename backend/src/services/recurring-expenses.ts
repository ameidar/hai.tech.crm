// Recurring supplier invoices ("don't forget") on top of the CompanyExpense mirror — the
// supplier registry: detection of candidates, "missing this month" evaluation, the monthly
// supplier grid, the WhatsApp reminder to Ami and the "approve drafts" reminder to Inna.
import { prisma } from '../utils/prisma.js';
import { ADMIN_PHONE, sendWhatsAppMessage } from './notifications.js';
import {
  EXPENSE_STATUS_PENDING,
  daysInMonth,
  expenseGross,
  expenseMonthKey,
  invoiceMonthKey,
  invoiceMonthRangeWhere,
  israelToday,
  monthRangeWhere,
  shiftMonth,
  supplierKey,
  type ExpenseRowLike,
} from './company-expenses.js';

export const DETECTION_WINDOW_MONTHS = 6;
export const DETECTION_MIN_MONTHS = 4;
// A month's total counts as "stable" when within this % of the median.
export const DETECTION_STABILITY_PCT = 35;
export const DEFAULT_GRACE_DAYS = 5;

export type RecurringStatus = 'suggested' | 'active' | 'ignored';
export const CADENCES = ['monthly', 'yearly', 'usage'] as const;
export type Cadence = (typeof CADENCES)[number];
export const INVOICE_SOURCES = ['email', 'portal', 'freelancer', 'other'] as const;
export type InvoiceSource = (typeof INVOICE_SOURCES)[number];

export interface RecurringLike {
  id: string;
  supplierId: string | null;
  supplierName: string;
  label: string;
  expectedDayOfMonth: number;
  expectedAmount: unknown;
  tolerancePct: number | null;
  status: string;
  createdAt?: Date;
  /** monthly (default) | yearly (only in expectedMonth) | usage (never reported missing). */
  cadence?: string | null;
  expectedMonth?: number | null;
  /** Extra Morning supplier names that count as this supplier (OCR mislabels). */
  aliases?: string[] | null;
  invoiceSource?: string | null;
  portalUrl?: string | null;
  owner?: string | null;
}

const normName = (s: string | null | undefined) => (s || '').trim().toLowerCase();

/** Loose supplier-name key for alias matching: lowercase, no quotes/punctuation, single spaces. */
export function normalizeSupplierName(s: string | null | undefined): string {
  return (s || '')
    .toLowerCase()
    .replace(/["'`׳״“”‘’.,;:()\[\]{}!?\-_/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number((v as any).toString());
  return Number.isFinite(n) ? n : null;
};

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Same supplier: by Morning supplier id when both sides have one, else by normalized name. */
export function sameSupplier(
  a: { supplierId?: string | null; supplierName?: string | null },
  b: { supplierId?: string | null; supplierName?: string | null },
): boolean {
  if (a.supplierId && b.supplierId) return a.supplierId === b.supplierId;
  return !!normName(a.supplierName) && normName(a.supplierName) === normName(b.supplierName);
}

/**
 * A mirror row belongs to a registered supplier when `sameSupplier` holds, or when its
 * supplier name equals one of the supplier's explicit aliases (normalized). Aliases are
 * opt-in per supplier, so a generic OCR label like "Uber B.V." only matches where listed.
 */
export function matchesSupplier(
  rec: Pick<RecurringLike, 'supplierId' | 'supplierName' | 'aliases'>,
  row: { supplierId?: string | null; supplierName?: string | null },
): boolean {
  if (sameSupplier(rec, row)) return true;
  const name = normalizeSupplierName(row.supplierName);
  if (!name || !rec.aliases?.length) return false;
  return rec.aliases.some((a) => normalizeSupplierName(a) === name);
}

/** Whether an invoice is expected in `month` ("YYYY-MM") for this supplier's cadence. */
export function isExpectedInMonth(rec: Pick<RecurringLike, 'cadence' | 'expectedMonth'>, month: string): boolean {
  const cadence = rec.cadence || 'monthly';
  if (cadence === 'usage') return false;
  if (cadence === 'yearly') {
    // A yearly supplier without a month can't be checked — never reported missing.
    return !!rec.expectedMonth && Number(month.slice(5, 7)) === rec.expectedMonth;
  }
  return true;
}

// ─── Detection ────────────────────────────────────────────────────────────────

export interface RecurringCandidate {
  supplierId: string | null;
  supplierName: string;
  label: string;
  expectedDayOfMonth: number;
  expectedAmount: number;
  tolerancePct: number;
  categoryTitle: string | null;
  monthsSeen: number;
}

/**
 * Suppliers billed in ≥ DETECTION_MIN_MONTHS distinct months out of the last
 * DETECTION_WINDOW_MONTHS full months (current month excluded — it may not have arrived
 * yet), where at least that many monthly totals are within DETECTION_STABILITY_PCT of the
 * median. Pure — callers dedupe against existing RecurringExpense rows.
 */
export function detectRecurringCandidates(rows: ExpenseRowLike[], now: Date = new Date()): RecurringCandidate[] {
  const currentMonth = israelToday(now).iso.slice(0, 7);
  const window = new Set(
    Array.from({ length: DETECTION_WINDOW_MONTHS }, (_, i) => shiftMonth(currentMonth, -(i + 1))),
  );

  const groups = new Map<string, {
    supplierId: string | null; supplierName: string;
    perMonth: Map<string, number>; days: number[]; categories: Map<string, number>;
  }>();
  for (const row of rows) {
    if (!row.active || !row.supplierName) continue;
    const month = invoiceMonthKey(row);
    if (!month || !window.has(month)) continue;
    const key = supplierKey(row);
    const g = groups.get(key) ?? {
      supplierId: row.supplierId, supplierName: row.supplierName,
      perMonth: new Map<string, number>(), days: [] as number[], categories: new Map<string, number>(),
    };
    g.perMonth.set(month, (g.perMonth.get(month) ?? 0) + expenseGross(row));
    const docDay = row.date ?? row.reportingDate;
    if (docDay) g.days.push(docDay.getUTCDate());
    if (row.categoryTitle) g.categories.set(row.categoryTitle, (g.categories.get(row.categoryTitle) ?? 0) + 1);
    groups.set(key, g);
  }

  const out: RecurringCandidate[] = [];
  for (const g of groups.values()) {
    if (g.perMonth.size < DETECTION_MIN_MONTHS) continue;
    const amounts = [...g.perMonth.values()];
    const med = median(amounts);
    if (med <= 0) continue;
    const deviations = amounts.map((a) => (Math.abs(a - med) / med) * 100);
    const stable = deviations.filter((d) => d <= DETECTION_STABILITY_PCT);
    if (stable.length < DETECTION_MIN_MONTHS) continue;
    // Tolerance = largest stable deviation, rounded up to 5%, min 10%.
    const tolerancePct = Math.max(10, Math.ceil(Math.max(...stable) / 5) * 5);
    const category = [...g.categories.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    out.push({
      supplierId: g.supplierId,
      supplierName: g.supplierName,
      label: g.supplierName,
      expectedDayOfMonth: Math.min(28, Math.max(1, Math.round(median(g.days) || 1))),
      expectedAmount: Math.round(med * 100) / 100,
      tolerancePct,
      categoryTitle: category,
      monthsSeen: g.perMonth.size,
    });
  }
  return out.sort((a, b) => b.expectedAmount - a.expectedAmount);
}

/**
 * Create `suggested` rows for new candidates. Any existing row for the same supplier —
 * including `ignored` ones — blocks re-creation, so re-detection never resurrects or duplicates.
 */
export async function runRecurringDetection(now: Date = new Date()) {
  const currentMonth = israelToday(now).iso.slice(0, 7);
  const rows = await prisma.companyExpense.findMany({
    // Drafts are excluded: their supplier is still Morning's unreviewed OCR guess.
    where: { active: true, isDraft: false, ...invoiceMonthRangeWhere(shiftMonth(currentMonth, -DETECTION_WINDOW_MONTHS), shiftMonth(currentMonth, -1)) },
  });
  const candidates = detectRecurringCandidates(rows as ExpenseRowLike[], now);
  const existing = await prisma.recurringExpense.findMany({
    select: { id: true, supplierId: true, supplierName: true },
  });
  const created: RecurringCandidate[] = [];
  for (const c of candidates) {
    if (existing.some((e) => sameSupplier(e, c)) || created.some((e) => sameSupplier(e, c))) continue;
    await prisma.recurringExpense.create({
      data: {
        supplierId: c.supplierId,
        supplierName: c.supplierName,
        label: c.label,
        expectedDayOfMonth: c.expectedDayOfMonth,
        expectedAmount: c.expectedAmount,
        tolerancePct: c.tolerancePct,
        categoryTitle: c.categoryTitle,
        status: 'suggested',
        source: 'auto',
        notes: `זוהה אוטומטית: ${c.monthsSeen} מתוך ${DETECTION_WINDOW_MONTHS} החודשים האחרונים`,
      },
    });
    created.push(c);
  }
  return { candidates: candidates.length, created: created.length, suggestions: created };
}

// ─── Missing this month ───────────────────────────────────────────────────────

export interface MissingRecurring {
  id: string;
  label: string;
  supplierName: string;
  month: string;
  expectedDayOfMonth: number;
  expectedAmount: number | null;
  tolerancePct: number | null;
  daysOverdue: number;
  invoiceSource?: string | null;
  portalUrl?: string | null;
  owner?: string | null;
}

/** Drafts (isDraft) count as received — the invoice is already in Morning. */
export function expenseMatchesRecurring(rec: RecurringLike, row: ExpenseRowLike, month: string): boolean {
  if (!row.active || (invoiceMonthKey(row) !== month && expenseMonthKey(row) !== month) || !matchesSupplier(rec, row)) return false;
  const expected = toNum(rec.expectedAmount);
  if (rec.tolerancePct === null || rec.tolerancePct === undefined || !expected) return true;
  return (Math.abs(expenseGross(row) - expected) / expected) * 100 <= rec.tolerancePct;
}

/**
 * Active recurring expenses with no matching invoice (only months the cadence expects —
 * see isExpectedInMonth):
 *  - current month, once today's day > expectedDay + grace;
 *  - previous month, once its due day + grace has passed — so the reminder on the 3rd
 *    catches invoices that never arrived last month. Skipped for rows created after that month.
 * `expenses` should cover the previous + current month.
 */
export function findMissingRecurring(
  recurring: RecurringLike[],
  expenses: ExpenseRowLike[],
  now: Date = new Date(),
  graceDays = DEFAULT_GRACE_DAYS,
): MissingRecurring[] {
  const today = israelToday(now);
  const currentMonth = today.iso.slice(0, 7);
  const prevMonth = shiftMonth(currentMonth, -1);
  const out: MissingRecurring[] = [];

  for (const rec of recurring) {
    if (rec.status !== 'active') continue;
    const base = {
      id: rec.id, label: rec.label, supplierName: rec.supplierName,
      expectedDayOfMonth: rec.expectedDayOfMonth,
      expectedAmount: toNum(rec.expectedAmount), tolerancePct: rec.tolerancePct ?? null,
      invoiceSource: rec.invoiceSource ?? null, portalUrl: rec.portalUrl ?? null, owner: rec.owner ?? null,
    };

    const createdMonth = rec.createdAt ? israelToday(rec.createdAt).iso.slice(0, 7) : null;
    if ((!createdMonth || createdMonth <= prevMonth) && isExpectedInMonth(rec, prevMonth)) {
      const dueDay = Math.min(rec.expectedDayOfMonth, daysInMonth(prevMonth));
      const daysOverdue = daysInMonth(prevMonth) - dueDay + today.day;
      if (daysOverdue > graceDays && !expenses.some((e) => expenseMatchesRecurring(rec, e, prevMonth))) {
        out.push({ ...base, month: prevMonth, daysOverdue });
      }
    }

    if (isExpectedInMonth(rec, currentMonth) && today.day > rec.expectedDayOfMonth + graceDays) {
      if (!expenses.some((e) => expenseMatchesRecurring(rec, e, currentMonth))) {
        out.push({ ...base, month: currentMonth, daysOverdue: today.day - rec.expectedDayOfMonth });
      }
    }
  }
  return out.sort((a, b) => a.month.localeCompare(b.month) || b.daysOverdue - a.daysOverdue);
}

/** Load active recurring rows + the relevant expenses and evaluate what's missing. */
export async function getMissingRecurring(now: Date = new Date()): Promise<MissingRecurring[]> {
  const currentMonth = israelToday(now).iso.slice(0, 7);
  const [recurring, expenses] = await Promise.all([
    prisma.recurringExpense.findMany({ where: { status: 'active' } }),
    prisma.companyExpense.findMany({
      where: { active: true, OR: [invoiceMonthRangeWhere(shiftMonth(currentMonth, -1), currentMonth), monthRangeWhere(shiftMonth(currentMonth, -1), currentMonth)] },
    }),
  ]);
  return findMissingRecurring(recurring as RecurringLike[], expenses as ExpenseRowLike[], now, graceDaysFromEnv());
}

const graceDaysFromEnv = () => Number(process.env.COMPANY_EXPENSE_GRACE_DAYS || DEFAULT_GRACE_DAYS);

// ─── Monthly supplier grid ────────────────────────────────────────────────────

export type GridCellState = 'approved' | 'pending' | 'draft' | 'missing' | 'not_due' | 'not_expected';

export interface GridCell {
  state: GridCellState;
  count: number;
  gross: number;
  expenseIds: string[];
}

/** "YYYY-MM" keys: `months` months ending with the current Israel month (oldest first). */
export function gridMonths(months: number, now: Date = new Date()): string[] {
  const current = israelToday(now).iso.slice(0, 7);
  return Array.from({ length: months }, (_, i) => shiftMonth(current, i - months + 1));
}

/**
 * One supplier's cells. Priority: approved (non-draft, Morning status ≠ 10) → pending
 * (non-draft, status 10 = awaiting approval in Morning) → draft → not_expected (cadence) →
 * not_due (current month, today ≤ expected day + grace) → missing. Matching uses the same
 * rule as the reminder (supplier/aliases + amount tolerance), so grid and reminder agree.
 */
export function computeSupplierGridCells(
  rec: RecurringLike,
  expenses: ExpenseRowLike[],
  months: string[],
  now: Date = new Date(),
  graceDays = DEFAULT_GRACE_DAYS,
): Record<string, GridCell> {
  const today = israelToday(now);
  const currentMonth = today.iso.slice(0, 7);
  const cells: Record<string, GridCell> = {};
  for (const month of months) {
    const matches = expenses.filter((e) => expenseMatchesRecurring(rec, e, month));
    const approved = matches.filter((e) => !e.isDraft && e.status !== EXPENSE_STATUS_PENDING);
    const pending = matches.filter((e) => !e.isDraft && e.status === EXPENSE_STATUS_PENDING);
    let state: GridCellState;
    if (approved.length) state = 'approved';
    else if (pending.length) state = 'pending';
    else if (matches.length) state = 'draft';
    else if (!isExpectedInMonth(rec, month)) state = 'not_expected';
    else if (month >= currentMonth && today.day <= Math.min(rec.expectedDayOfMonth, daysInMonth(month)) + graceDays) state = 'not_due';
    else state = 'missing';
    cells[month] = {
      state,
      count: matches.length,
      gross: Math.round(matches.reduce((s, e) => s + expenseGross(e), 0) * 100) / 100,
      expenseIds: matches.map((e) => e.id).filter((id): id is string => !!id),
    };
  }
  return cells;
}

/** Load registry rows (active, optionally suggested) + mirror rows and build the grid. */
export async function getSupplierGrid(opts: { months?: number; includeSuggested?: boolean; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const months = gridMonths(opts.months ?? 6, now);
  const [recurring, expenses] = await Promise.all([
    prisma.recurringExpense.findMany({
      where: { status: { in: opts.includeSuggested ? ['active', 'suggested'] : ['active'] } },
      orderBy: [{ status: 'asc' }, { label: 'asc' }],
    }),
    prisma.companyExpense.findMany({
      where: { active: true, OR: [invoiceMonthRangeWhere(months[0], months[months.length - 1]), monthRangeWhere(months[0], months[months.length - 1])] },
    }),
  ]);
  const grace = graceDaysFromEnv();
  return {
    months,
    suppliers: recurring.map((rec) => ({
      rec,
      cells: computeSupplierGridCells(rec as RecurringLike, expenses as ExpenseRowLike[], months, now, grace),
    })),
  };
}

// ─── WhatsApp reminder (Ami only) ─────────────────────────────────────────────

const MONTH_LABEL = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
const crmExpensesLink = () => `${process.env.FRONTEND_URL || 'https://crm.orma-ai.com'}/company-expenses`;

const SOURCE_GROUPS: Array<{ source: InvoiceSource; title: string }> = [
  { source: 'portal', title: '🌐 להורדה מפורטל הספק:' },
  { source: 'email', title: '📧 אמורות להגיע במייל:' },
  { source: 'freelancer', title: '👤 פרילנסרים:' },
  { source: 'other', title: '📎 אחר:' },
];

export function buildMissingReminderMessage(missing: MissingRecurring[]): string {
  const line = (m: MissingRecurring) => {
    const amount = m.expectedAmount ? ` · ~₪${Math.round(m.expectedAmount).toLocaleString('he-IL')}` : '';
    const owner = m.owner ? ` · ${m.owner}` : '';
    return `• ${m.label} (${MONTH_LABEL(m.month)})${amount}${owner}`;
  };
  const sourceOf = (m: MissingRecurring): InvoiceSource =>
    (INVOICE_SOURCES as readonly string[]).includes(m.invoiceSource ?? '') ? (m.invoiceSource as InvoiceSource) : 'portal';

  const body: string[] = [];
  for (const g of SOURCE_GROUPS) {
    const items = missing.filter((m) => sourceOf(m) === g.source);
    if (!items.length) continue;
    body.push('', g.title);
    for (const m of items) {
      body.push(line(m));
      // URL on its own line so WhatsApp links it cleanly (and RTL doesn't scramble it).
      if (g.source === 'portal' && m.portalUrl) body.push(m.portalUrl);
    }
  }
  return [
    `🧾 חשבוניות קבועות שעדיין לא הגיעו (${missing.length}):`,
    ...body,
    '',
    'לבדיקה והעלאה ל-Morning:',
    crmExpensesLink(),
  ].join('\n');
}

/** Send the missing-invoices reminder to Ami. Skips (returns sent=false) when nothing is missing. */
export async function sendMissingRecurringReminder(now: Date = new Date()) {
  const missing = await getMissingRecurring(now);
  if (!missing.length) return { sent: false, missing: 0 };
  const ok = await sendWhatsAppMessage(ADMIN_PHONE, buildMissingReminderMessage(missing));
  return { sent: ok, missing: missing.length };
}

// ─── "Approve drafts" reminder (Inna) ─────────────────────────────────────────

export const DEFAULT_DRAFTS_REMINDER_PHONE = '972524486208';

export function buildDraftsReminderMessage(count: number, gross: number): string {
  return [
    `🟦 יש ${count} טיוטות הוצאה ב-Morning שממתינות לאישור (סה"כ ₪${Math.round(gross).toLocaleString('he-IL')}).`,
    'נא לעבור עליהן ולאשר ב-Morning כדי שייכנסו לדוחות החודש.',
    '',
    'רשימה מלאה:',
    crmExpensesLink(),
  ].join('\n');
}

/** WhatsApp the drafts-approval reminder. Skips when there are no active drafts. */
export async function sendDraftsApprovalReminder() {
  const drafts = await prisma.companyExpense.findMany({
    where: { active: true, isDraft: true },
    select: { amount: true },
  });
  if (!drafts.length) return { sent: false, drafts: 0, gross: 0 };
  const gross = drafts.reduce((s, d) => s + expenseGross(d), 0);
  const phone = process.env.COMPANY_EXPENSE_DRAFTS_REMINDER_PHONE || DEFAULT_DRAFTS_REMINDER_PHONE;
  const ok = await sendWhatsAppMessage(phone, buildDraftsReminderMessage(drafts.length, gross));
  return { sent: ok, drafts: drafts.length, gross: Math.round(gross * 100) / 100 };
}
