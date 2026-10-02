import { describe, it, expect } from 'vitest';
import {
  monthToDate,
  dateToMonth,
  isFixedAdditionActiveInMonth,
  activeFixedAdditionsWhere,
  fixedAdditionMonthlyCost,
  toFixedAdditionReportItem,
} from '../instructor-fixed-additions.js';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('month helpers', () => {
  it('converts YYYY-MM to the first day of the month (UTC) and back', () => {
    expect(monthToDate('2026-09').toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(dateToMonth(d('2026-09-01'))).toBe('2026-09');
    expect(dateToMonth(d('2026-12-31'))).toBe('2026-12');
  });

  it('rejects malformed months', () => {
    expect(() => monthToDate('2026-13')).toThrow();
    expect(() => monthToDate('2026-9')).toThrow();
    expect(() => monthToDate('09-2026')).toThrow();
  });
});

describe('isFixedAdditionActiveInMonth', () => {
  const openEnded = { startMonth: d('2026-09-01'), endMonth: null };
  const bounded = { startMonth: d('2026-09-01'), endMonth: d('2026-11-01') };

  it('is inactive before startMonth', () => {
    expect(isFixedAdditionActiveInMonth(openEnded, '2026-08')).toBe(false);
  });

  it('is active from startMonth onward when open-ended', () => {
    expect(isFixedAdditionActiveInMonth(openEnded, '2026-09')).toBe(true);
    expect(isFixedAdditionActiveInMonth(openEnded, '2027-03')).toBe(true);
  });

  it('treats endMonth as inclusive', () => {
    expect(isFixedAdditionActiveInMonth(bounded, '2026-11')).toBe(true);
    expect(isFixedAdditionActiveInMonth(bounded, '2026-12')).toBe(false);
  });

  it('supports a single-month addition (start == end)', () => {
    const single = { startMonth: d('2026-10-01'), endMonth: d('2026-10-01') };
    expect(isFixedAdditionActiveInMonth(single, '2026-09')).toBe(false);
    expect(isFixedAdditionActiveInMonth(single, '2026-10')).toBe(true);
    expect(isFixedAdditionActiveInMonth(single, '2026-11')).toBe(false);
  });

  it('crosses year boundaries', () => {
    const a = { startMonth: d('2026-11-01'), endMonth: d('2027-02-01') };
    expect(isFixedAdditionActiveInMonth(a, '2026-12')).toBe(true);
    expect(isFixedAdditionActiveInMonth(a, '2027-01')).toBe(true);
    expect(isFixedAdditionActiveInMonth(a, '2027-03')).toBe(false);
  });

  it('ignores soft-deleted additions', () => {
    expect(isFixedAdditionActiveInMonth({ ...openEnded, deletedAt: new Date() }, '2026-10')).toBe(false);
  });
});

describe('activeFixedAdditionsWhere', () => {
  it('builds the inclusive start/end month filter', () => {
    const m = monthToDate('2026-09');
    expect(activeFixedAdditionsWhere(m)).toEqual({
      deletedAt: null,
      startMonth: { lte: m },
      OR: [{ endMonth: null }, { endMonth: { gte: m } }],
    });
  });
});

describe('fixedAdditionMonthlyCost', () => {
  it('counts net amounts as-is (also for employees)', () => {
    expect(fixedAdditionMonthlyCost({ amount: 2500, isNet: true }, 'employee')).toBe(2500);
  });

  it('applies the 1.3 employer-cost multiplier to gross amounts of employees', () => {
    expect(fixedAdditionMonthlyCost({ amount: '1000.00', isNet: false }, 'employee')).toBe(1300);
  });

  it('does not apply the multiplier for freelancers', () => {
    expect(fixedAdditionMonthlyCost({ amount: 1000, isNet: false }, 'freelancer')).toBe(1000);
  });
});

describe('toFixedAdditionReportItem', () => {
  it('serializes amount, months and the net/gross label', () => {
    expect(toFixedAdditionReportItem({
      id: 'a1', description: 'ריכוז', amount: { toString: () => '2500.00' }, isNet: true,
      startMonth: d('2026-09-01'), endMonth: null,
    })).toEqual({
      id: 'a1', description: 'ריכוז', amount: 2500, isNet: true, netLabel: 'נטו',
      startMonth: '2026-09', endMonth: null,
    });
    expect(toFixedAdditionReportItem({
      id: 'a2', description: 'בונוס', amount: 300, isNet: false,
      startMonth: d('2026-09-01'), endMonth: d('2026-12-01'),
    }).netLabel).toBe('ברוטו');
  });
});
