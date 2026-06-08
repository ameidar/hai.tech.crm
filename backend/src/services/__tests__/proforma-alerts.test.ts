import { describe, it, expect } from 'vitest';
import { computeProformaDueDate } from '../proforma-alerts.js';

describe('computeProformaDueDate', () => {
  it('adds payment terms to the end of the issue month (30-day default)', () => {
    // Issued mid-April → EOM = 2026-04-30, +30 days = 2026-05-30.
    const due = computeProformaDueDate(new Date('2026-04-10T08:00:00Z'), 30);
    expect(due.toISOString().slice(0, 10)).toBe('2026-05-30');
  });

  it('supports 45-day terms', () => {
    // EOM 2026-04-30 + 45 = 2026-06-14.
    const due = computeProformaDueDate(new Date('2026-04-30T23:00:00Z'), 45);
    expect(due.toISOString().slice(0, 10)).toBe('2026-06-14');
  });

  it('supports 60-day terms across a year boundary', () => {
    // Issued December → EOM 2026-12-31 + 60 = 2027-03-01.
    const due = computeProformaDueDate(new Date('2026-12-05T00:00:00Z'), 60);
    expect(due.toISOString().slice(0, 10)).toBe('2027-03-01');
  });

  it('uses the issue month regardless of day within the month', () => {
    const first = computeProformaDueDate(new Date('2026-02-01T00:00:00Z'), 30);
    const last = computeProformaDueDate(new Date('2026-02-28T00:00:00Z'), 30);
    expect(first.toISOString().slice(0, 10)).toBe(last.toISOString().slice(0, 10));
    // EOM Feb 2026 = 2026-02-28 + 30 = 2026-03-30.
    expect(first.toISOString().slice(0, 10)).toBe('2026-03-30');
  });
});
