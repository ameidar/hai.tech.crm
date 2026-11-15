/**
 * Tentative revenue for the financial forecast (הכנסה טנטטיבית).
 *
 * Institutions (e.g. עמל) sometimes send orders before dates/times are known. Those are
 * stored as `draft` institutional orders WITHOUT cycles/meetings, so they produce no
 * calendar noise — and therefore no forecast revenue. This module estimates the money
 * they represent, kept strictly separate from the confirmed (meeting-based) revenue.
 *
 * Per draft order, the expected amount is placed in months as follows:
 *   1. monthlyAmounts has valid "YYYY-MM" entries → use them (net of VAT when
 *      monthlyAmountsIncludeVat is true — same conversion as monthly-fixed billing).
 *   2. else startDate + endDate + a total → spread the total evenly across every month in
 *      the date range; only months inside the forecast window are counted.
 *   3. else (a total but no months) → not spread; counted as "unscheduled".
 *
 * The order total is totalAmount ?? estimatedTotal ?? pricePerMeeting × estimatedMeetings.
 * Order totals are net (pre-VAT), like cycle meeting revenue and quote totals.
 *
 * Only `draft` orders count, and only while they have no live cycle (not deleted, not
 * cancelled) — once a cycle exists, its meetings already carry the revenue. A *tentative*
 * cycle is live too: its tentative meetings carry the revenue (see
 * computeTentativeMeetingRevenue), so the order's own amounts drop out — no double count.
 *
 * Tentative cycles (status 'tentative', meetings status 'tentative') — activities created
 * as cycles before they are confirmed — contribute their meetings' expected revenue to the
 * month of each meeting, again only as tentative revenue (never confirmed revenue/profit).
 */

import { roundMoney } from '../utils/revenue.js';
import { netMonthlyAmounts } from './monthly-fixed-billing.js';

type Num = number | string | { toString(): string } | null | undefined;

export interface TentativeOrderInput {
  id: string;
  status: string;
  orderName?: string | null;
  orderNumber?: string | null;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  totalAmount?: Num;
  estimatedTotal?: Num;
  pricePerMeeting?: Num;
  estimatedMeetings?: number | null;
  monthlyAmounts?: unknown;
  monthlyAmountsIncludeVat?: boolean | null;
  branch?: { name: string } | null;
  cycles?: { status: string; deletedAt?: Date | string | null }[];
}

export interface TentativeOrderSummary {
  id: string;
  name: string;
  orderNumber: string | null;
  branchName: string | null;
  /** Net expected total of the order (all months, not only the forecast window). */
  total: number;
  /** Forecast-window months that received tentative revenue from this order. */
  monthsCovered: string[];
  /** True when the order has a total but no months to place it in. */
  unscheduled: boolean;
}

export interface TentativeRevenueResult {
  byMonth: Record<string, number>;
  unscheduledTotal: number;
  /** Sum of byMonth (forecast window only) + unscheduledTotal. */
  total: number;
  orders: TentativeOrderSummary[];
}

function num(v: Num): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function monthKeyOfDate(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d);
  // Order dates are @db.Date (UTC midnight).
  return date.toISOString().slice(0, 7);
}

/** Inclusive list of "YYYY-MM" keys from start to end. */
export function monthsBetween(start: string, end: string): string[] {
  if (end < start) return [];
  const out: string[] = [];
  let [y, m] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

export function isTentativeOrder(order: TentativeOrderInput): boolean {
  if (order.status !== 'draft') return false;
  const liveCycles = (order.cycles ?? []).filter(c => !c.deletedAt && c.status !== 'cancelled');
  return liveCycles.length === 0;
}

/** Net order total (pre-VAT). */
export function tentativeOrderTotal(order: TentativeOrderInput): number {
  const total = num(order.totalAmount);
  if (total > 0) return roundMoney(total);
  const estimated = num(order.estimatedTotal);
  if (estimated > 0) return roundMoney(estimated);
  const perMeeting = num(order.pricePerMeeting);
  const meetings = Number(order.estimatedMeetings ?? 0);
  if (perMeeting > 0 && meetings > 0) return roundMoney(perMeeting * meetings);
  return 0;
}

export function computeTentativeRevenue(
  orders: TentativeOrderInput[],
  forecastMonthKeys: string[],
): TentativeRevenueResult {
  const window = new Set(forecastMonthKeys);
  const byMonth: Record<string, number> = {};
  for (const k of forecastMonthKeys) byMonth[k] = 0;
  let unscheduledTotal = 0;
  const summaries: TentativeOrderSummary[] = [];

  for (const order of orders) {
    if (!isTentativeOrder(order)) continue;

    const includeVat = order.monthlyAmountsIncludeVat ?? true;
    const monthly = netMonthlyAmounts(order.monthlyAmounts, includeVat);
    const monthlyKeys = Object.keys(monthly).filter(k => monthly[k] > 0);
    const covered: string[] = [];
    let total = 0;
    let unscheduled = false;

    if (monthlyKeys.length > 0) {
      // Path 1: explicit per-month amounts.
      total = roundMoney(monthlyKeys.reduce((s, k) => s + monthly[k], 0));
      for (const k of monthlyKeys.sort()) {
        if (!window.has(k)) continue;
        byMonth[k] = roundMoney(byMonth[k] + monthly[k]);
        covered.push(k);
      }
    } else {
      total = tentativeOrderTotal(order);
      if (total <= 0) continue;
      const range = order.startDate && order.endDate
        ? monthsBetween(monthKeyOfDate(order.startDate), monthKeyOfDate(order.endDate))
        : [];
      if (range.length > 0) {
        // Path 2: spread evenly over the whole date range; count only window months.
        const each = total / range.length;
        for (const k of range) {
          if (!window.has(k)) continue;
          byMonth[k] = roundMoney(byMonth[k] + each);
          covered.push(k);
        }
      } else {
        // Path 3: a total with no months — don't guess a month.
        unscheduled = true;
        unscheduledTotal = roundMoney(unscheduledTotal + total);
      }
    }

    summaries.push({
      id: order.id,
      name: order.orderName || order.orderNumber || 'הזמנה ללא שם',
      orderNumber: order.orderNumber ?? null,
      branchName: order.branch?.name ?? null,
      total,
      monthsCovered: covered,
      unscheduled,
    });
  }

  const windowSum = Object.values(byMonth).reduce((s, v) => s + v, 0);
  summaries.sort((a, b) => b.total - a.total);
  return {
    byMonth,
    unscheduledTotal,
    total: roundMoney(windowSum + unscheduledTotal),
    orders: summaries,
  };
}

export interface TentativeMeetingInput {
  id: string;
  cycleId: string;
  scheduledDate: Date | string;
  revenue?: Num;
  nature?: string | null;
  cycle: {
    name: string;
    type?: string | null;
    meetingRevenue?: Num;
    pricePerStudent?: Num;
    studentCount?: number | null;
    branch?: { name: string } | null;
  };
}

export interface TentativeCycleSummary {
  id: string;
  name: string;
  branchName: string | null;
  /** Net expected revenue of the cycle's tentative meetings inside the window. */
  total: number;
  meetingCount: number;
  monthsCovered: string[];
}

export interface TentativeMeetingRevenueResult {
  byMonth: Record<string, number>;
  total: number;
  cycles: TentativeCycleSummary[];
}

/**
 * Expected net revenue of one tentative meeting: the stored expected revenue (set at
 * generation from the cycle's pricing), else the cycle's per-meeting revenue, else
 * price-per-student × student count. No historical-average guess for unconfirmed work.
 */
export function tentativeMeetingRevenue(m: TentativeMeetingInput): number {
  if (m.nature === 'no_revenue') return 0;
  const stored = num(m.revenue);
  if (stored > 0) return roundMoney(stored);
  const perMeeting = num(m.cycle.meetingRevenue);
  if (perMeeting > 0) return roundMoney(perMeeting);
  if (m.cycle.type === 'institutional_per_child') {
    const perChild = num(m.cycle.pricePerStudent);
    const kids = Number(m.cycle.studentCount ?? 0);
    if (perChild > 0 && kids > 0) return roundMoney(perChild * kids);
  }
  return 0;
}

/** Sum tentative meetings' expected revenue per month (only months in `monthKeys`). */
export function computeTentativeMeetingRevenue(
  meetings: TentativeMeetingInput[],
  monthKeys: string[],
): TentativeMeetingRevenueResult {
  const window = new Set(monthKeys);
  const byMonth: Record<string, number> = {};
  for (const k of monthKeys) byMonth[k] = 0;
  const perCycle = new Map<string, TentativeCycleSummary>();

  for (const m of meetings) {
    const key = monthKeyOfDate(m.scheduledDate);
    if (!window.has(key)) continue;
    const revenue = tentativeMeetingRevenue(m);
    byMonth[key] = roundMoney(byMonth[key] + revenue);
    const summary = perCycle.get(m.cycleId) ?? {
      id: m.cycleId,
      name: m.cycle.name,
      branchName: m.cycle.branch?.name ?? null,
      total: 0,
      meetingCount: 0,
      monthsCovered: [],
    };
    summary.total = roundMoney(summary.total + revenue);
    summary.meetingCount += 1;
    if (!summary.monthsCovered.includes(key)) summary.monthsCovered.push(key);
    perCycle.set(m.cycleId, summary);
  }

  const cycles = [...perCycle.values()]
    .map((c) => ({ ...c, monthsCovered: c.monthsCovered.sort() }))
    .sort((a, b) => b.total - a.total);
  const total = roundMoney(Object.values(byMonth).reduce((s, v) => s + v, 0));
  return { byMonth, total, cycles };
}
