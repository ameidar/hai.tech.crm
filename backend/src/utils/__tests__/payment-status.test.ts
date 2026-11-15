import { describe, expect, it } from 'vitest';
import {
  PAID_PAYMENT_STATUSES,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_LABELS_HE,
  isPaidPaymentStatus,
  isPaymentRecordStatus,
} from '../payment-status.js';
import { updateRegistrationSchema } from '../../types/schemas.js';
import { paymentStatusEnum } from '../../api/v1/validators/registrations.js';

describe('payment status — refunded (זוכה)', () => {
  it('labels refunded as "זוכה"', () => {
    expect(PAYMENT_STATUS_LABELS_HE.refunded).toBe('זוכה');
    expect(PAYMENT_STATUSES).toContain('refunded');
  });

  it('treats refunded as NOT paid', () => {
    expect(isPaidPaymentStatus('refunded')).toBe(false);
    expect(isPaidPaymentStatus('unpaid')).toBe(false);
    expect(isPaidPaymentStatus(null)).toBe(false);
    expect(isPaidPaymentStatus('paid')).toBe(true);
    expect(isPaidPaymentStatus('partial')).toBe(true);
    expect(PAID_PAYMENT_STATUSES).not.toContain('refunded');
  });

  it('accepts refunded in registration validators (manual selection)', () => {
    expect(paymentStatusEnum.parse('refunded')).toBe('refunded');
    expect(updateRegistrationSchema.parse({ paymentStatus: 'refunded' }).paymentStatus).toBe('refunded');
  });

  it('validates payments.status values incl. refunded', () => {
    expect(isPaymentRecordStatus('refunded')).toBe(true);
    expect(isPaymentRecordStatus('paid')).toBe(true);
    expect(isPaymentRecordStatus('bogus')).toBe(false);
  });
});
