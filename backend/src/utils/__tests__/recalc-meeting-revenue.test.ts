import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../prisma.js', () => ({
  prisma: {
    cycle: { findUnique: vi.fn(), update: vi.fn() },
    meeting: { findMany: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('../../services/negative-profit-alert.js', () => ({
  checkAndSendNegativeProfitAlert: vi.fn(),
}));

vi.mock('../../services/monthly-fixed-billing.js', () => ({
  redistributeMonthlyFixedRevenue: vi.fn(),
}));

import { recalcMeetingRevenue } from '../recalcMeetingRevenue.js';
import { redistributeMonthlyFixedRevenue } from '../../services/monthly-fixed-billing.js';
import { prisma } from '../prisma.js';

const mockPrisma = vi.mocked(prisma) as any;

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.meeting.findMany.mockResolvedValue([
    { id: 'm1', instructorPayment: 100, expenses: [] },
    { id: 'm2', instructorPayment: 100, expenses: [{ amount: 50 }] },
  ]);
});

describe('recalcMeetingRevenue', () => {
  it('delegates monthly_fixed orders to the month redistribution and never writes cycle.meetingRevenue', async () => {
    mockPrisma.cycle.findUnique.mockResolvedValue({
      type: 'institutional_per_child',
      pricePerStudent: 100,
      meetingRevenue: 500,
      totalMeetings: 10,
      institutionalOrder: { id: 'o1', billingMode: 'monthly_fixed' },
      registrations: [{ amount: 0 }],
    });

    await recalcMeetingRevenue('c1');

    expect(redistributeMonthlyFixedRevenue).toHaveBeenCalledWith('o1');
    expect(mockPrisma.cycle.update).not.toHaveBeenCalled();
    expect(mockPrisma.meeting.update).not.toHaveBeenCalled();
  });

  it('keeps per_meeting orders on the per-meeting path', async () => {
    mockPrisma.cycle.findUnique.mockResolvedValue({
      type: 'institutional_per_child',
      pricePerStudent: 100,
      meetingRevenue: 0,
      totalMeetings: 10,
      institutionalOrder: { id: 'o1', billingMode: 'per_meeting' },
      registrations: [{ amount: 0 }, { amount: 0 }],
    });

    await recalcMeetingRevenue('c1');

    expect(redistributeMonthlyFixedRevenue).not.toHaveBeenCalled();
    expect(mockPrisma.meeting.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { revenue: 200, profit: 100 },
    });
  });

  it('recomputes group revenue from all registrations even when meetingRevenue is already set', async () => {
    mockPrisma.cycle.findUnique.mockResolvedValue({
      type: 'group',
      pricePerStudent: 0,
      meetingRevenue: 236.76, // stale: computed from the first 3 sign-ups
      totalMeetings: 32,
      registrations: [
        { amount: 2980 }, { amount: 2980 }, { amount: 2980 },
        { amount: 2980 }, { amount: 2980 }, { amount: 2831 },
      ],
    });

    await recalcMeetingRevenue('c1');

    // 17731 gross / 1.18 / 32
    expect(mockPrisma.cycle.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { studentCount: 6, meetingRevenue: 469.57 },
    });
    expect(mockPrisma.meeting.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { revenue: 469.57, profit: 369.57 },
    });
    // approved meeting expenses are subtracted (previously NaN)
    const m2 = mockPrisma.meeting.update.mock.calls.find((c: any[]) => c[0].where.id === 'm2')[0];
    expect(m2.data.revenue).toBe(469.57);
    expect(m2.data.profit).toBeCloseTo(319.57, 2);
  });

  it('keeps the manual meetingRevenue override for private cycles', async () => {
    mockPrisma.cycle.findUnique.mockResolvedValue({
      type: 'private',
      pricePerStudent: 0,
      meetingRevenue: 140.68,
      totalMeetings: 32,
      registrations: [{ amount: 9999 }],
    });

    await recalcMeetingRevenue('c2');

    expect(mockPrisma.cycle.update).toHaveBeenCalledWith({
      where: { id: 'c2' },
      data: { studentCount: 1, meetingRevenue: 140.68 },
    });
  });
});
