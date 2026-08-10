import { describe, expect, it } from 'vitest';
import {
  meetingRevenueForCycle,
  meetingRevenueForMeeting,
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

  it('uses explicit meeting revenue for trial private cycles', () => {
    expect(meetingRevenueForCycle({
      type: 'trial_private',
      meetingRevenue: 175,
      totalMeetings: 100,
      registrations: [
        { status: 'active', amount: 175 },
        { status: 'active', amount: 175 },
      ],
    })).toBe(175);
  });

  it('uses explicit meeting revenue for private cycles before splitting registrations', () => {
    expect(meetingRevenueForCycle({
      type: 'private',
      meetingRevenue: 250,
      totalMeetings: 10,
      registrations: [
        { status: 'active', amount: 1000 },
      ],
    })).toBe(250);
  });

  it('falls back to registration split for private cycles without explicit meeting revenue', () => {
    expect(meetingRevenueForCycle({
      type: 'private',
      totalMeetings: 10,
      registrations: [
        { status: 'active', amount: 1180 },
      ],
    })).toBe(100);
  });

  it('does not use pricePerStudent for private cycle revenue', () => {
    expect(meetingRevenueForCycle({
      type: 'private',
      pricePerStudent: 9999,
      totalMeetings: 10,
      registrations: [
        { status: 'active', amount: 1180 },
      ],
    })).toBe(100);
  });

  it('returns zero revenue for no-revenue meetings even when the cycle has fixed revenue', () => {
    expect(meetingRevenueForMeeting({
      type: 'institutional_fixed',
      meetingRevenue: 500,
      registrations: [],
    }, {
      nature: 'no_revenue',
    })).toBe(0);
  });

  it('returns normal cycle revenue for regular meetings', () => {
    expect(meetingRevenueForMeeting({
      type: 'private',
      meetingRevenue: 250,
      totalMeetings: 10,
      registrations: [
        { status: 'active', amount: 1000 },
      ],
    }, {
      nature: 'regular',
    })).toBe(250);
  });
});
