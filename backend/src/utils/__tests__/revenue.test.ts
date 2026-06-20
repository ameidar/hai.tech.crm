import { describe, expect, it } from 'vitest';
import {
  meetingRevenueFromRegistrations,
  revenueRegistrationCount,
} from '../revenue.js';

describe('revenue helpers', () => {
  it('counts completed registrations as revenue-bearing', () => {
    const registrations = [
      { status: 'completed', amount: 2880 },
      { status: 'completed', amount: 2880 },
      { status: 'completed', amount: 2880 },
      { status: 'completed', amount: 2880 },
      { status: 'completed', amount: 2880 },
    ];

    expect(revenueRegistrationCount(registrations)).toBe(5);
    expect(meetingRevenueFromRegistrations(registrations, 32, 'private')).toBe(381.36);
  });

  it('excludes cancelled and pending-cancellation registrations from revenue', () => {
    const registrations = [
      { status: 'registered', amount: 1000 },
      { status: 'active', amount: 1000 },
      { status: 'completed', amount: 1000 },
      { status: 'cancelled', amount: 1000 },
      { status: 'pending_cancellation', amount: 1000 },
    ];

    expect(revenueRegistrationCount(registrations)).toBe(3);
    expect(meetingRevenueFromRegistrations(registrations, 10, 'institutional_fixed')).toBe(300);
  });
});
