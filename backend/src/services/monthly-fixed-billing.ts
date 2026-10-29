/**
 * Monthly fixed billing for institutional orders (תשלום חודשי קבוע).
 *
 * Some institutions pay a fixed amount per calendar month regardless of how many
 * meetings take place. For orders with billingMode = 'monthly_fixed' the month's net
 * amount is split equally across the month's active meetings (all cycles of the order),
 * with the rounding remainder on the last meeting (by date, start time, id).
 * Meetings that are not active — or months with no configured amount — get revenue 0.
 *
 * Meeting revenue is always stored pre-VAT; monthlyAmounts are stored as entered and
 * converted with VAT_RATE when monthlyAmountsIncludeVat is true.
 */

import { prisma } from '../utils/prisma.js';
import { VAT_RATE, roundMoney } from '../utils/revenue.js';

export const BILLING_MODES = ['per_meeting', 'monthly_fixed'] as const;
export type BillingMode = (typeof BILLING_MODES)[number];

export const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// Statuses that never carry revenue. Postponed meetings are replaced by a new meeting
// that carries the revenue instead, so counting both would split the month too thin.
const INACTIVE_STATUSES = new Set(['cancelled', 'postponed']);

type Num = number | string | { toString(): string } | null | undefined;

export interface SplitMeeting {
  id: string;
  scheduledDate: Date | string;
  startTime?: Date | string | null;
  status: string;
  nature?: string | null;
  deletedAt?: Date | string | null;
}

/** 'YYYY-MM' of a meeting date (meeting dates are stored as UTC-midnight @db.Date). */
export function monthKeyOf(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString().slice(0, 7);
}

/** Net (pre-VAT) amount for a month. */
export function monthNetAmount(amount: Num, includeVat: boolean): number {
  const n = Number(amount ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return roundMoney(includeVat ? n / (1 + VAT_RATE) : n);
}

export function isActiveForMonthlySplit(m: SplitMeeting): boolean {
  if (m.deletedAt) return false;
  if (INACTIVE_STATUSES.has(String(m.status))) return false;
  if (m.nature === 'no_revenue') return false;
  return true;
}

function timeKey(t: Date | string | null | undefined): string {
  if (!t) return '';
  return t instanceof Date ? t.toISOString() : String(t);
}

function compareMeetings(a: SplitMeeting, b: SplitMeeting): number {
  const da = new Date(a.scheduledDate).getTime();
  const db = new Date(b.scheduledDate).getTime();
  if (da !== db) return da - db;
  const ta = timeKey(a.startTime);
  const tb = timeKey(b.startTime);
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Pure split: returns meetingId → revenue for every meeting passed in.
 * `netByMonth` holds the already-net amount per month; months missing from it give 0.
 */
export function splitMonthlyRevenue(
  meetings: SplitMeeting[],
  netByMonth: Record<string, number>,
): Map<string, number> {
  const result = new Map<string, number>();
  const activeByMonth = new Map<string, SplitMeeting[]>();

  for (const m of meetings) {
    result.set(m.id, 0);
    if (!isActiveForMonthlySplit(m)) continue;
    const key = monthKeyOf(m.scheduledDate);
    const list = activeByMonth.get(key) ?? [];
    list.push(m);
    activeByMonth.set(key, list);
  }

  for (const [month, list] of activeByMonth) {
    const total = roundMoney(Number(netByMonth[month] ?? 0));
    if (total <= 0 || list.length === 0) continue;
    list.sort(compareMeetings);
    const each = roundMoney(total / list.length);
    const last = roundMoney(total - each * (list.length - 1));
    list.forEach((m, i) => result.set(m.id, i === list.length - 1 ? last : each));
  }

  return result;
}

/** Convert the stored monthlyAmounts JSON into net amounts per month. */
export function netMonthlyAmounts(monthlyAmounts: unknown, includeVat: boolean): Record<string, number> {
  const out: Record<string, number> = {};
  if (!monthlyAmounts || typeof monthlyAmounts !== 'object' || Array.isArray(monthlyAmounts)) return out;
  for (const [k, v] of Object.entries(monthlyAmounts as Record<string, unknown>)) {
    if (!MONTH_KEY_RE.test(k)) continue;
    out[k] = monthNetAmount(v as Num, includeVat);
  }
  return out;
}

function monthRange(month: string): { gte: Date; lt: Date } {
  const [y, m] = month.split('-').map(Number);
  return { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
}

export interface RedistributeResult {
  skipped: boolean;
  months: string[];
  updated: number;
}

/**
 * Recompute revenue/profit for the order's meetings in the given months (or all months
 * that have meetings or configured amounts). No-op for per_meeting orders.
 */
export async function redistributeMonthlyFixedRevenue(
  orderId: string,
  opts: { months?: string[] } = {},
): Promise<RedistributeResult> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.institutionalOrder.findUnique({
      where: { id: orderId },
      select: { id: true, billingMode: true, monthlyAmounts: true, monthlyAmountsIncludeVat: true },
    });
    if (!order || order.billingMode !== 'monthly_fixed') {
      return { skipped: true, months: [], updated: 0 };
    }

    const netByMonth = netMonthlyAmounts(order.monthlyAmounts, order.monthlyAmountsIncludeVat);
    const requested = opts.months
      ? [...new Set(opts.months.filter((m) => MONTH_KEY_RE.test(m)))]
      : null;
    if (requested && requested.length === 0) return { skipped: false, months: [], updated: 0 };

    const dateFilter = requested
      ? { OR: requested.map((m) => ({ scheduledDate: monthRange(m) })) }
      : {};

    // Include soft-deleted/cancelled meetings so their revenue is reset to 0 as well.
    const meetings = await tx.meeting.findMany({
      where: { cycle: { institutionalOrderId: orderId }, ...dateFilter },
      select: {
        id: true,
        scheduledDate: true,
        startTime: true,
        status: true,
        nature: true,
        deletedAt: true,
        revenue: true,
        profit: true,
        instructorPayment: true,
        expenses: { where: { status: 'approved' }, select: { amount: true } },
      },
    });

    const split = splitMonthlyRevenue(meetings, netByMonth);
    let updated = 0;
    for (const m of meetings) {
      const revenue = split.get(m.id) ?? 0;
      const expenses = (m.expenses ?? []).reduce((s, e) => s + Number(e.amount ?? 0), 0);
      const profit = roundMoney(revenue - Number(m.instructorPayment ?? 0) - expenses);
      if (Number(m.revenue) === revenue && Number(m.profit) === profit) continue;
      await tx.meeting.update({ where: { id: m.id }, data: { revenue, profit } });
      updated++;
    }

    const months = requested ?? [
      ...new Set([...Object.keys(netByMonth), ...meetings.map((m) => monthKeyOf(m.scheduledDate))]),
    ].sort();
    console.log(`[monthly-fixed-billing] order ${orderId}: months=${months.join(',')} updated=${updated}`);
    return { skipped: false, months, updated };
  }, { timeout: 30_000 });
}

/** Months touched by a set of meeting dates (nulls ignored). */
export function monthsOf(dates: Array<Date | string | null | undefined>): string[] {
  return [...new Set(dates.filter(Boolean).map((d) => monthKeyOf(d as Date | string)))];
}

/**
 * Resolve the cycle's order and redistribute when it is monthly_fixed. Returns false
 * (and does nothing) for per_meeting orders or cycles without an order.
 */
export async function redistributeForCycle(cycleId: string, months?: string[]): Promise<boolean> {
  const cycle = await prisma.cycle.findUnique({
    where: { id: cycleId },
    select: { institutionalOrder: { select: { id: true, billingMode: true } } },
  });
  const order = cycle?.institutionalOrder;
  if (!order || order.billingMode !== 'monthly_fixed') return false;
  await redistributeMonthlyFixedRevenue(order.id, months ? { months } : {});
  return true;
}

/**
 * Fail-safe hook for meeting write paths: redistribute the months of the given meeting
 * dates (old + new). Never throws — errors are logged so the main request is unaffected.
 */
export async function syncMonthlyFixedForCycle(
  cycleId: string | null | undefined,
  dates?: Array<Date | string | null | undefined>,
): Promise<void> {
  if (!cycleId) return;
  try {
    await redistributeForCycle(cycleId, dates ? monthsOf(dates) : undefined);
  } catch (err) {
    console.error(`[monthly-fixed-billing] redistribution failed for cycle ${cycleId}:`, err);
  }
}

export interface MeetingRef {
  cycleId: string;
  scheduledDate: Date | string | null;
}

/** Capture cycle + date of meetings before a write that may move or delete them. */
export async function snapshotMeetingRefs(meetingIds: string[]): Promise<MeetingRef[]> {
  if (!meetingIds.length) return [];
  try {
    return await prisma.meeting.findMany({
      where: { id: { in: meetingIds } },
      select: { cycleId: true, scheduledDate: true },
    });
  } catch (err) {
    console.error('[monthly-fixed-billing] snapshot failed:', err);
    return [];
  }
}

/** Fail-safe: redistribute every (cycle, month) pair in the given refs. */
export async function syncMonthlyFixedForRefs(refs: MeetingRef[]): Promise<void> {
  const byCycle = new Map<string, Array<Date | string | null>>();
  for (const r of refs) {
    if (!r?.cycleId) continue;
    const list = byCycle.get(r.cycleId) ?? [];
    list.push(r.scheduledDate);
    byCycle.set(r.cycleId, list);
  }
  for (const [cycleId, dates] of byCycle) await syncMonthlyFixedForCycle(cycleId, dates);
}

/**
 * Fail-safe hook for writes by meeting id: redistributes the meetings' current months
 * plus the months in `before` (refs captured before the write, e.g. a date move).
 */
export async function syncMonthlyFixedForMeetings(
  meetingIds: string[],
  before: MeetingRef[] = [],
): Promise<void> {
  const after = await snapshotMeetingRefs(meetingIds);
  await syncMonthlyFixedForRefs([...before, ...after]);
}
