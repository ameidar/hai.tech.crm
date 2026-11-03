import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  billingPeriod: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  billingPeriodLine: { deleteMany: vi.fn() },
  cycle: { findMany: vi.fn() },
  institutionalOrder: { findUnique: vi.fn() },
  meeting: { findMany: vi.fn() },
}));

vi.mock('../../utils/prisma.js', () => ({ prisma: prismaMock }));

import { generateBillingPeriod } from '../billing.js';

const cycle = (id: string, name: string, meetings: number) => ({
  id,
  name,
  type: 'institutional_fixed',
  meetingRevenue: 372.37,
  studentCount: 0,
  revenueIncludesVat: false,
  meetings: Array.from({ length: meetings }, (_, i) => ({ id: `${id}-m${i}`, scheduledDate: new Date('2026-10-05T00:00:00Z') })),
  registrations: [],
});

describe('generateBillingPeriod — monthly_fixed orders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.billingPeriod.findUnique.mockResolvedValue(null);
    prismaMock.billingPeriod.findFirst.mockResolvedValue(null);
    prismaMock.billingPeriod.create.mockImplementation(async ({ data }: any) => ({ id: 'p1', ...data }));
    prismaMock.cycle.findMany.mockResolvedValue([cycle('c1', 'ז׳3 חני', 4), cycle('c2', 'ח׳3 שרית', 2)]);
  });

  it('bills the stored monthly split (all active meetings), not meetings × meetingRevenue', async () => {
    prismaMock.institutionalOrder.findUnique.mockResolvedValue({ billingMode: 'monthly_fixed' });
    // c2 has a 3rd meeting later in the month that is not held yet — still part of the month's amount.
    prismaMock.meeting.findMany.mockResolvedValue([
      ...[0, 1, 2, 3].map((i) => ({ id: `c1-m${i}`, cycleId: 'c1', revenue: i === 3 ? 438.87 : 438.86 })),
      ...[0, 1, 2].map((i) => ({ id: `c2-m${i}`, cycleId: 'c2', revenue: 438.86 })),
    ]);

    await generateBillingPeriod('order-1', '2026-10', '2026-10');

    const data = prismaMock.billingPeriod.create.mock.calls[0][0].data;
    expect(Number(data.totalAmount)).toBeCloseTo(3072.03, 2);
    const lines = data.lines.create;
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ quantity: 1, unitPrice: 1755.45, total: 1755.45 });
    expect(lines[0].description).toContain('תשלום חודשי קבוע, 4 מפגשים');
    expect(lines[1]).toMatchObject({ quantity: 1, unitPrice: 1316.58, total: 1316.58 });
    expect(prismaMock.meeting.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { notIn: ['cancelled', 'postponed'] }, revenue: { gt: 0 } }),
    }));
  });

  it('per_meeting orders keep meetings × meetingRevenue', async () => {
    prismaMock.institutionalOrder.findUnique.mockResolvedValue({ billingMode: 'per_meeting' });

    await generateBillingPeriod('order-1', '2026-10', '2026-10');

    expect(prismaMock.meeting.findMany).not.toHaveBeenCalled();
    const lines = prismaMock.billingPeriod.create.mock.calls[0][0].data.lines.create;
    expect(lines[0]).toMatchObject({ quantity: 4, unitPrice: 372.37 });
  });
});
