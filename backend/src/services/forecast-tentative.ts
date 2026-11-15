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
 * cancelled) — once a cycle exists, its meetings already carry the revenue.
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
