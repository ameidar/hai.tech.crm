import { describe, expect, it } from 'vitest';
import {
  paymentStatusHebrew,
  paymentStatusBadgeClass,
  paymentStatusPillClass,
  paymentRecordStatusDisplay,
} from '../types';

describe('payment status labels — refunded (זוכה)', () => {
  it('labels refunded registrations as "זוכה" with a neutral gray badge', () => {
    expect(paymentStatusHebrew.refunded).toBe('זוכה');
    expect(paymentStatusBadgeClass.refunded).toBe('badge-gray');
    expect(paymentStatusPillClass.refunded).toContain('gray');
    expect(paymentStatusPillClass.refunded).not.toContain('red');
  });

  it('keeps existing labels', () => {
    expect(paymentStatusHebrew.paid).toBe('שולם');
    expect(paymentStatusBadgeClass.unpaid).toBe('badge-danger');
  });

  it('shows refunded payment-history rows as "זוכה" (not "ממתין")', () => {
    const d = paymentRecordStatusDisplay('refunded');
    expect(d.label).toBe('זוכה');
    expect(d.cls).toContain('gray');
    expect(paymentRecordStatusDisplay('pending').label).toContain('ממתין');
  });
});
