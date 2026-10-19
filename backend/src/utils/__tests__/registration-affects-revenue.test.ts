import { describe, expect, it } from 'vitest';
import { registrationAffectsRevenue } from '../revenue.js';

const old = { status: 'registered', amount: 0, paymentStatus: 'unpaid' };

describe('registrationAffectsRevenue', () => {
  it('recalculates on cancellation', () => {
    expect(registrationAffectsRevenue(old, { status: 'cancelled' })).toBe(true);
    expect(registrationAffectsRevenue(old, { status: 'pending_cancellation' })).toBe(true);
  });

  it('recalculates when a late payment sets the amount', () => {
    expect(registrationAffectsRevenue(old, { amount: 2980, paymentStatus: 'paid' })).toBe(true);
    expect(registrationAffectsRevenue(old, { amount: 2980 })).toBe(true);
  });

  it('recalculates on payment status or status change', () => {
    expect(registrationAffectsRevenue(old, { paymentStatus: 'paid' })).toBe(true);
    expect(registrationAffectsRevenue(old, { status: 'active' })).toBe(true);
  });

  it('skips unrelated or unchanged edits', () => {
    expect(registrationAffectsRevenue(old, { notes: 'x' } as any)).toBe(false);
    expect(registrationAffectsRevenue(old, { amount: 0, status: 'registered', paymentStatus: 'unpaid' })).toBe(false);
    expect(registrationAffectsRevenue({ ...old, amount: '2980.00' }, { amount: 2980 })).toBe(false);
  });
});

import { meetingRevenueFromRegistrations } from '../revenue.js';

describe('group revenue counts paid registrations only', () => {
  const regs = [
    { amount: 2980, status: 'registered', paymentStatus: 'paid' },
    { amount: 2980, status: 'registered', paymentStatus: 'unpaid' }, // form price, not paid yet
    { amount: 2980, status: 'registered', paymentStatus: 'partial' },
    { amount: 0, status: 'registered', paymentStatus: 'unpaid' },
  ];

  it('ignores unpaid registrations in group cycles', () => {
    // 2 × 2980 / 1.18 / 32
    expect(meetingRevenueFromRegistrations(regs, 32, 'group')).toBe(157.84);
  });

  it('keeps legacy behavior for private cycles', () => {
    expect(meetingRevenueFromRegistrations(regs, 32, 'private')).toBe(236.76);
  });

  it('keeps registrations when paymentStatus was not loaded', () => {
    expect(meetingRevenueFromRegistrations([{ amount: 2980, status: 'registered' }], 32, 'group')).toBe(78.92);
  });
});
