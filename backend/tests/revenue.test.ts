import { describe, it, expect } from 'vitest';
import {
  netAmount,
  meetingRevenueFromRegistrations,
  isVatInclusive,
  VAT_RATE,
} from '../src/utils/revenue.js';

describe('revenue helpers', () => {
  describe('isVatInclusive', () => {
    it('private and trial_private are gross', () => {
      expect(isVatInclusive('private')).toBe(true);
      expect(isVatInclusive('trial_private')).toBe(true);
    });

    it('institutional types are net', () => {
      expect(isVatInclusive('institutional_fixed')).toBe(false);
      expect(isVatInclusive('institutional_per_child')).toBe(false);
    });

    it('null/undefined defaults to net', () => {
      expect(isVatInclusive(null)).toBe(false);
      expect(isVatInclusive(undefined)).toBe(false);
    });
  });

  describe('netAmount', () => {
    it('strips 18% VAT for private cycles', () => {
      // 1180 gross → 1000 net
      expect(netAmount(1180, 'private')).toBeCloseTo(1000, 2);
      expect(netAmount(118, 'trial_private')).toBeCloseTo(100, 2);
    });

    it('returns gross unchanged for institutional cycles', () => {
      expect(netAmount(600, 'institutional_fixed')).toBe(600);
      expect(netAmount(1200, 'institutional_per_child')).toBe(1200);
    });

    it('handles zero/negative input', () => {
      expect(netAmount(0, 'private')).toBe(0);
      expect(netAmount(-10, 'private')).toBe(0);
    });

    it('VAT_RATE is 0.18', () => {
      expect(VAT_RATE).toBe(0.18);
    });
  });

  describe('meetingRevenueFromRegistrations', () => {
    it('private: sums gross, strips VAT, divides by totalMeetings', () => {
      // 1180 + 1180 = 2360 gross → 2000 net → 200/meeting over 10
      const regs = [{ amount: 1180 }, { amount: 1180 }];
      expect(meetingRevenueFromRegistrations(regs, 10, 'private')).toBe(200);
    });

    it('institutional_per_child: no VAT stripping', () => {
      const regs = [{ amount: 1000 }, { amount: 1000 }];
      expect(meetingRevenueFromRegistrations(regs, 10, 'institutional_per_child')).toBe(200);
    });

    it('handles string amounts (Decimal-like)', () => {
      const regs = [{ amount: '1180' }, { amount: '1180' }];
      expect(meetingRevenueFromRegistrations(regs, 10, 'private')).toBe(200);
    });

    it('returns 0 when totalMeetings is 0 or negative', () => {
      const regs = [{ amount: 1180 }];
      expect(meetingRevenueFromRegistrations(regs, 0, 'private')).toBe(0);
      expect(meetingRevenueFromRegistrations(regs, -5, 'private')).toBe(0);
    });

    it('skips registrations with missing amount', () => {
      const regs = [{ amount: 1180 }, { amount: null }, {}];
      expect(meetingRevenueFromRegistrations(regs, 10, 'private')).toBe(100);
    });

    it('rounds to nearest integer', () => {
      // 1000 gross / 1.18 = 847.4576... → / 3 = 282.485... → rounds to 282
      const regs = [{ amount: 1000 }];
      expect(meetingRevenueFromRegistrations(regs, 3, 'private')).toBe(282);
    });
  });
});
