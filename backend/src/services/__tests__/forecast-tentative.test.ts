import { describe, it, expect } from 'vitest';
import {
  computeTentativeRevenue,
  isTentativeOrder,
  monthsBetween,
  tentativeOrderTotal,
  type TentativeOrderInput,
} from '../forecast-tentative.js';

const WINDOW = ['2026-12', '2027-01', '2027-02'];
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

const order = (over: Partial<TentativeOrderInput>): TentativeOrderInput => ({
  id: 'o1',
  status: 'draft',
  orderName: 'עמל - רובוטיקה',
  branch: { name: 'עמל חדרה' },
  cycles: [],
  ...over,
});

describe('monthsBetween', () => {
  it('is inclusive and crosses years', () => {
    expect(monthsBetween('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(monthsBetween('2026-12', '2026-12')).toEqual(['2026-12']);
    expect(monthsBetween('2027-01', '2026-12')).toEqual([]);
  });
});

describe('tentativeOrderTotal', () => {
  it('prefers totalAmount, then estimatedTotal, then price × meetings', () => {
    expect(tentativeOrderTotal(order({ totalAmount: 1000, estimatedTotal: 2000 }))).toBe(1000);
    expect(tentativeOrderTotal(order({ estimatedTotal: '2000.50' }))).toBe(2000.5);
    expect(tentativeOrderTotal(order({ pricePerMeeting: 300, estimatedMeetings: 10 }))).toBe(3000);
    expect(tentativeOrderTotal(order({}))).toBe(0);
  });
});

describe('isTentativeOrder', () => {
  it('counts only draft orders', () => {
    expect(isTentativeOrder(order({ status: 'draft' }))).toBe(true);
    for (const status of ['active', 'completed', 'cancelled']) {
      expect(isTentativeOrder(order({ status }))).toBe(false);
    }
  });

  it('excludes drafts that already have a live cycle, ignores deleted/cancelled cycles', () => {
    expect(isTentativeOrder(order({ cycles: [{ status: 'active', deletedAt: null }] }))).toBe(false);
    expect(isTentativeOrder(order({ cycles: [{ status: 'completed' }] }))).toBe(false);
    expect(isTentativeOrder(order({ cycles: [{ status: 'cancelled' }] }))).toBe(true);
    expect(isTentativeOrder(order({ cycles: [{ status: 'active', deletedAt: d('2026-10-01') }] }))).toBe(true);
  });
});

describe('computeTentativeRevenue', () => {
  it('uses monthlyAmounts (net when amounts exclude VAT), only window months land in byMonth', () => {
    const r = computeTentativeRevenue([
      order({
        monthlyAmounts: { '2026-11': 500, '2026-12': 1000, '2027-01': 2000, bad: 99 },
        monthlyAmountsIncludeVat: false,
        totalAmount: 99999, // ignored when monthly amounts exist
      }),
    ], WINDOW);
    expect(r.byMonth).toEqual({ '2026-12': 1000, '2027-01': 2000, '2027-02': 0 });
    expect(r.unscheduledTotal).toBe(0);
    expect(r.total).toBe(3000);
    expect(r.orders[0]).toMatchObject({ total: 3500, monthsCovered: ['2026-12', '2027-01'], unscheduled: false, branchName: 'עמל חדרה' });
  });

  it('strips 18% VAT from monthlyAmounts when they include VAT (default)', () => {
    const r = computeTentativeRevenue([order({ monthlyAmounts: { '2026-12': 1180 } })], WINDOW);
    expect(r.byMonth['2026-12']).toBe(1000);
    const explicit = computeTentativeRevenue([order({ monthlyAmounts: { '2026-12': 1180 }, monthlyAmountsIncludeVat: true })], WINDOW);
    expect(explicit.byMonth['2026-12']).toBe(1000);
  });

  it('spreads the total evenly across the whole date range, counting only window months', () => {
    // Nov 2026 – Feb 2027 = 4 months, 1000 each; Nov is outside the window.
    const r = computeTentativeRevenue([
      order({ totalAmount: 4000, startDate: d('2026-11-10'), endDate: d('2027-02-20') }),
    ], WINDOW);
    expect(r.byMonth).toEqual({ '2026-12': 1000, '2027-01': 1000, '2027-02': 1000 });
    expect(r.total).toBe(3000);
    expect(r.orders[0]).toMatchObject({ total: 4000, monthsCovered: ['2026-12', '2027-01', '2027-02'], unscheduled: false });
  });

  it('does not treat the order total as VAT-inclusive (totals are net)', () => {
    const r = computeTentativeRevenue([
      order({ totalAmount: 1180, monthlyAmountsIncludeVat: true, startDate: d('2026-12-01'), endDate: d('2026-12-31') }),
    ], WINDOW);
    expect(r.byMonth['2026-12']).toBe(1180);
  });

  it('puts orders with a total but no months into unscheduled, not into any month', () => {
    const r = computeTentativeRevenue([
      order({ id: 'a', totalAmount: 5000 }),
      order({ id: 'b', estimatedTotal: 2000, startDate: d('2026-12-01') }), // no end date
    ], WINDOW);
    expect(Object.values(r.byMonth).every(v => v === 0)).toBe(true);
    expect(r.unscheduledTotal).toBe(7000);
    expect(r.total).toBe(7000);
    expect(r.orders.map(o => [o.id, o.unscheduled])).toEqual([['a', true], ['b', true]]);
  });

  it('skips non-draft orders, drafts with live cycles, and drafts with no amount', () => {
    const r = computeTentativeRevenue([
      order({ id: 'active', status: 'active', totalAmount: 1000 }),
      order({ id: 'cancelled', status: 'cancelled', totalAmount: 1000 }),
      order({ id: 'has-cycle', totalAmount: 1000, cycles: [{ status: 'active' }] }),
      order({ id: 'empty' }),
      order({ id: 'ok', monthlyAmounts: { '2027-02': 590 } }),
    ], WINDOW);
    expect(r.orders.map(o => o.id)).toEqual(['ok']);
    expect(r.byMonth['2027-02']).toBe(500);
    expect(r.total).toBe(500);
  });

  it('sums multiple orders per month', () => {
    const r = computeTentativeRevenue([
      order({ id: 'a', monthlyAmounts: { '2027-01': 1000 }, monthlyAmountsIncludeVat: false }),
      order({ id: 'b', totalAmount: 600, startDate: d('2027-01-01'), endDate: d('2027-03-31') }),
    ], WINDOW);
    expect(r.byMonth['2027-01']).toBe(1200);
    expect(r.byMonth['2027-02']).toBe(200);
    expect(r.total).toBe(1400);
  });
});
