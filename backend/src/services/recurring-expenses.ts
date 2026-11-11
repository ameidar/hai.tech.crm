// Recurring supplier invoices ("don't forget") on top of the CompanyExpense mirror:
// detection of candidates, "missing this month" evaluation and the WhatsApp reminder to Ami.
import { prisma } from '../utils/prisma.js';
import { ADMIN_PHONE, sendWhatsAppMessage } from './notifications.js';
import {
  daysInMonth,
  expenseGross,
  expenseMonthKey,
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
}

const normName = (s: string | null | undefined) => (s || '').trim().toLowerCase();
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
    const month = expenseMonthKey(row);
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
    where: { active: true, isDraft: false, ...monthRangeWhere(shiftMonth(currentMonth, -DETECTION_WINDOW_MONTHS), shiftMonth(currentMonth, -1)) },
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
}

export function expenseMatchesRecurring(rec: RecurringLike, row: ExpenseRowLike, month: string): boolean {
  if (!row.active || expenseMonthKey(row) !== month || !sameSupplier(rec, row)) return false;
  const expected = toNum(rec.expectedAmount);
  if (rec.tolerancePct === null || rec.tolerancePct === undefined || !expected) return true;
  return (Math.abs(expenseGross(row) - expected) / expected) * 100 <= rec.tolerancePct;
}

/**
 * Active recurring expenses with no matching invoice:
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
    };

    const createdMonth = rec.createdAt ? israelToday(rec.createdAt).iso.slice(0, 7) : null;
    if (!createdMonth || createdMonth <= prevMonth) {
      const dueDay = Math.min(rec.expectedDayOfMonth, daysInMonth(prevMonth));
      const daysOverdue = daysInMonth(prevMonth) - dueDay + today.day;
      if (daysOverdue > graceDays && !expenses.some((e) => expenseMatchesRecurring(rec, e, prevMonth))) {
        out.push({ ...base, month: prevMonth, daysOverdue });
      }
    }

    if (today.day > rec.expectedDayOfMonth + graceDays) {
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
      where: { active: true, ...monthRangeWhere(shiftMonth(currentMonth, -1), currentMonth) },
    }),
  ]);
  const graceDays = Number(process.env.COMPANY_EXPENSE_GRACE_DAYS || DEFAULT_GRACE_DAYS);
  return findMissingRecurring(recurring as RecurringLike[], expenses as ExpenseRowLike[], now, graceDays);
}

// ─── WhatsApp reminder (Ami only) ─────────────────────────────────────────────

const MONTH_LABEL = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;

export function buildMissingReminderMessage(missing: MissingRecurring[]): string {
  const link = `${process.env.FRONTEND_URL || 'https://crm.orma-ai.com'}/company-expenses`;
  const lines = missing.map((m) => {
    const amount = m.expectedAmount ? ` · ~₪${Math.round(m.expectedAmount).toLocaleString('he-IL')}` : '';
    return `• ${m.label} (${MONTH_LABEL(m.month)})${amount}`;
  });
  return [
    `🧾 חשבוניות קבועות שעדיין לא הגיעו (${missing.length}):`,
    ...lines,
    '',
    `לבדיקה: ${link}`,
  ].join('\n');
}

/** Send the missing-invoices reminder to Ami. Skips (returns sent=false) when nothing is missing. */
export async function sendMissingRecurringReminder(now: Date = new Date()) {
  const missing = await getMissingRecurring(now);
  if (!missing.length) return { sent: false, missing: 0 };
  const ok = await sendWhatsAppMessage(ADMIN_PHONE, buildMissingReminderMessage(missing));
  return { sent: ok, missing: missing.length };
}
