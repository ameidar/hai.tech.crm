import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/prisma.js', () => {
  const tx = {
    institutionalOrder: { findUnique: vi.fn() },
    meeting: { findMany: vi.fn(), update: vi.fn() },
  };
  return {
    prisma: {
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      cycle: { findUnique: vi.fn() },
      meeting: { findMany: vi.fn() },
      __tx: tx,
    },
  };
});

import {
  monthNetAmount,
  netMonthlyAmounts,
  redistributeForCycle,
  redistributeMonthlyFixedRevenue,
  splitMonthlyRevenue,
  syncMonthlyFixedForCycle,
} from '../monthly-fixed-billing.js';
import { prisma } from '../../utils/prisma.js';

const mockPrisma = prisma as any;
const tx = mockPrisma.__tx;

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const t = (s: string) => new Date(`1970-01-01T${s}:00.000Z`);
const meeting = (id: string, date: string, extra: Record<string, unknown> = {}) => ({
  id,
  scheduledDate: d(date),
  startTime: t('10:00'),
  status: 'scheduled',
  nature: 'regular',
  deletedAt: null,
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('monthNetAmount', () => {
  it('strips 18% VAT when the amount includes VAT', () => {
    expect(monthNetAmount(48000, true)).toBe(40677.97);
    expect(monthNetAmount(24000, true)).toBe(20338.98);
  });

  it('keeps net amounts and treats invalid/negative as 0', () => {
    expect(monthNetAmount(1000, false)).toBe(1000);
    expect(monthNetAmount(-5, false)).toBe(0);
    expect(monthNetAmount(null, true)).toBe(0);
  });

  it('netMonthlyAmounts ignores malformed month keys', () => {
    expect(netMonthlyAmounts({ '2026-10': 48000, 'oct': 1, '2026-13': 5 }, true)).toEqual({ '2026-10': 40677.97 });
    expect(netMonthlyAmounts(null, true)).toEqual({});
  });
});

describe('splitMonthlyRevenue', () => {
  it('splits equally and puts the rounding remainder on the last meeting by date/time/id', () => {
    const meetings = [
      meeting('c', '2026-10-20'),
      meeting('a', '2026-10-06'),
      meeting('b2', '2026-10-13', { startTime: t('12:00') }),
      meeting('b1', '2026-10-13'),
    ];
    const split = splitMonthlyRevenue(meetings, { '2026-10': 100 });
    // 100 / 4 = 25 exactly
    expect([...split.values()].reduce((s, v) => s + v, 0)).toBe(100);

    const split3 = splitMonthlyRevenue(meetings.slice(0, 3), { '2026-10': 100 });
    expect(split3.get('a')).toBe(33.33);
    expect(split3.get('b2')).toBe(33.33);
    expect(split3.get('c')).toBe(33.34); // last by date takes the remainder
  });

  it('sums each month exactly to the configured net amount', () => {
    const meetings = Array.from({ length: 7 }, (_, i) => meeting(`m${i}`, `2026-11-${String(i + 2).padStart(2, '0')}`));
    const split = splitMonthlyRevenue(meetings, { '2026-11': 40677.97 });
    const total = [...split.values()].reduce((s, v) => s + v, 0);
    expect(Math.round(total * 100) / 100).toBe(40677.97);
    expect(split.get('m0')).toBe(5811.14);
    expect(split.get('m6')).toBe(5811.13);
  });

  it('gives 0 to inactive meetings and to months without an amount', () => {
    const meetings = [
      meeting('ok', '2026-10-06'),
      meeting('cancelled', '2026-10-07', { status: 'cancelled' }),
      meeting('postponed', '2026-10-08', { status: 'postponed' }),
      meeting('deleted', '2026-10-09', { deletedAt: new Date() }),
      meeting('internal', '2026-10-10', { nature: 'no_revenue' }),
      meeting('done', '2026-10-11', { status: 'completed' }),
      meeting('nomonth', '2026-12-01'),
    ];
    const split = splitMonthlyRevenue(meetings, { '2026-10': 1000 });
    expect(split.get('ok')).toBe(500);
    expect(split.get('done')).toBe(500);
    for (const id of ['cancelled', 'postponed', 'deleted', 'internal', 'nomonth']) {
      expect(split.get(id)).toBe(0);
    }
  });

  it('handles a month with no active meetings', () => {
    const split = splitMonthlyRevenue([meeting('x', '2026-10-06', { status: 'cancelled' })], { '2026-10': 1000 });
    expect(split.get('x')).toBe(0);
    expect(splitMonthlyRevenue([], { '2026-10': 1000 }).size).toBe(0);
  });
});

describe('redistributeMonthlyFixedRevenue', () => {
  it('writes revenue and profit = revenue - instructor payment - approved expenses', async () => {
    tx.institutionalOrder.findUnique.mockResolvedValue({
      id: 'o1',
      billingMode: 'monthly_fixed',
      monthlyAmounts: { '2026-10': 48000 },
      monthlyAmountsIncludeVat: true,
    });
    tx.meeting.findMany.mockResolvedValue([
      { ...meeting('m1', '2026-10-06'), revenue: 0, profit: 0, instructorPayment: 500, expenses: [{ amount: 100 }] },
      { ...meeting('m2', '2026-10-13'), revenue: 0, profit: 0, instructorPayment: 500, expenses: [] },
      { ...meeting('m3', '2026-10-20', { status: 'cancelled' }), revenue: 2000, profit: 2000, instructorPayment: 0, expenses: [] },
    ]);

    const result = await redistributeMonthlyFixedRevenue('o1', { months: ['2026-10'] });

    expect(result).toEqual({ skipped: false, months: ['2026-10'], updated: 3 });
    expect(tx.meeting.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { revenue: 20338.99, profit: 19738.99 } });
    expect(tx.meeting.update).toHaveBeenCalledWith({ where: { id: 'm2' }, data: { revenue: 20338.98, profit: 19838.98 } });
    expect(tx.meeting.update).toHaveBeenCalledWith({ where: { id: 'm3' }, data: { revenue: 0, profit: 0 } });
    // only the requested month is loaded
    const where = tx.meeting.findMany.mock.calls[0][0].where;
    expect(where.cycle).toEqual({ institutionalOrderId: 'o1' });
    expect(where.OR).toEqual([{ scheduledDate: { gte: d('2026-10-01'), lt: d('2026-11-01') } }]);
  });

  it('skips unchanged meetings', async () => {
    tx.institutionalOrder.findUnique.mockResolvedValue({
      id: 'o1', billingMode: 'monthly_fixed', monthlyAmounts: { '2026-10': 1000 }, monthlyAmountsIncludeVat: false,
    });
    tx.meeting.findMany.mockResolvedValue([
      { ...meeting('m1', '2026-10-06'), revenue: 1000, profit: 1000, instructorPayment: 0, expenses: [] },
    ]);
    const result = await redistributeMonthlyFixedRevenue('o1');
    expect(result.updated).toBe(0);
    expect(tx.meeting.update).not.toHaveBeenCalled();
  });

  it('is a no-op for per_meeting orders', async () => {
    tx.institutionalOrder.findUnique.mockResolvedValue({ id: 'o1', billingMode: 'per_meeting', monthlyAmounts: null, monthlyAmountsIncludeVat: true });
    const result = await redistributeMonthlyFixedRevenue('o1');
    expect(result.skipped).toBe(true);
    expect(tx.meeting.findMany).not.toHaveBeenCalled();
    expect(tx.meeting.update).not.toHaveBeenCalled();
  });
});

describe('hooks', () => {
  it('redistributeForCycle does nothing for per_meeting orders or cycles without an order', async () => {
    mockPrisma.cycle.findUnique.mockResolvedValueOnce({ institutionalOrder: { id: 'o1', billingMode: 'per_meeting' } });
    expect(await redistributeForCycle('c1', ['2026-10'])).toBe(false);
    mockPrisma.cycle.findUnique.mockResolvedValueOnce({ institutionalOrder: null });
    expect(await redistributeForCycle('c2')).toBe(false);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('syncMonthlyFixedForCycle redistributes the old and new month of a moved meeting', async () => {
    mockPrisma.cycle.findUnique.mockResolvedValue({ institutionalOrder: { id: 'o1', billingMode: 'monthly_fixed' } });
    tx.institutionalOrder.findUnique.mockResolvedValue({
      id: 'o1', billingMode: 'monthly_fixed', monthlyAmounts: {}, monthlyAmountsIncludeVat: true,
    });
    tx.meeting.findMany.mockResolvedValue([]);
    await syncMonthlyFixedForCycle('c1', [d('2026-10-27'), d('2026-11-03'), null]);
    const where = tx.meeting.findMany.mock.calls[0][0].where;
    expect(where.OR).toHaveLength(2);
  });

  it('syncMonthlyFixedForCycle never throws', async () => {
    mockPrisma.cycle.findUnique.mockRejectedValue(new Error('db down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(syncMonthlyFixedForCycle('c1', [d('2026-10-01')])).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
