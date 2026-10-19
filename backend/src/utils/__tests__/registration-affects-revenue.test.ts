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
