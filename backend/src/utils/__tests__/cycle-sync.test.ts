import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../prisma.js', () => ({
  prisma: {
    cycle: {
      update: vi.fn(),
    },
    meeting: {
      findFirst: vi.fn(),
    },
  },
}));

import { syncCycleEndDate } from '../cycle-sync.js';
import { prisma } from '../prisma.js';

const mockPrisma = vi.mocked(prisma);

describe('syncCycleEndDate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates the cycle end date to the latest real meeting date', async () => {
    const latestMeetingDate = new Date('2026-07-30T00:00:00.000Z');
    mockPrisma.meeting.findFirst.mockResolvedValue({
      scheduledDate: latestMeetingDate,
    } as any);

    await expect(syncCycleEndDate('cycle-1')).resolves.toBe(latestMeetingDate);

    expect(mockPrisma.meeting.findFirst).toHaveBeenCalledWith({
      where: {
        cycleId: 'cycle-1',
        deletedAt: null,
        status: { notIn: ['cancelled', 'postponed'] },
      },
      orderBy: { scheduledDate: 'desc' },
      select: { scheduledDate: true },
    });
    expect(mockPrisma.cycle.update).toHaveBeenCalledWith({
      where: { id: 'cycle-1' },
      data: { endDate: latestMeetingDate },
    });
  });

  it('keeps the existing end date when the cycle has no real meetings', async () => {
    mockPrisma.meeting.findFirst.mockResolvedValue(null);

    await expect(syncCycleEndDate('cycle-1')).resolves.toBeNull();

    expect(mockPrisma.cycle.update).not.toHaveBeenCalled();
  });
});
