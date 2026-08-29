import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findDuplicateMeetingWarnings } from '../meeting-duplicate-warning.js';
import { prisma } from '../../utils/prisma.js';

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    meeting: {
      findMany: vi.fn(),
    },
  },
}));

const mockPrisma = prisma as unknown as {
  meeting: {
    findMany: ReturnType<typeof vi.fn>;
  };
};

describe('findDuplicateMeetingWarnings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('finds existing active meetings with the same instructor, date and time', async () => {
    mockPrisma.meeting.findMany.mockResolvedValue([
      {
        id: 'meeting-1',
        cycleId: 'cycle-1',
        instructorId: 'instructor-1',
        scheduledDate: new Date('2026-08-25T00:00:00.000Z'),
        startTime: new Date('1970-01-01T14:00:00.000Z'),
        endTime: new Date('1970-01-01T14:45:00.000Z'),
        status: 'scheduled',
        instructor: { id: 'instructor-1', name: 'ניר ברמן' },
        cycle: { id: 'cycle-1', name: 'רובלוקס מתקדמים' },
      },
    ]);

    const warnings = await findDuplicateMeetingWarnings([
      {
        instructorId: 'instructor-1',
        scheduledDate: new Date('2026-08-25T09:00:00.000Z'),
        startTime: new Date('1970-01-01T14:00:00.000Z'),
        endTime: new Date('1970-01-01T14:45:00.000Z'),
      },
    ]);

    expect(mockPrisma.meeting.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        instructorId: 'instructor-1',
        scheduledDate: new Date('2026-08-25T00:00:00.000Z'),
        startTime: new Date('1970-01-01T14:00:00.000Z'),
        endTime: new Date('1970-01-01T14:45:00.000Z'),
        deletedAt: null,
        status: { notIn: ['cancelled', 'postponed'] },
      }),
    }));
    expect(warnings).toEqual([
      expect.objectContaining({
        meetingId: 'meeting-1',
        cycleName: 'רובלוקס מתקדמים',
        instructorName: 'ניר ברמן',
        scheduledDate: '2026-08-25',
        startTime: '14:00',
        endTime: '14:45',
      }),
    ]);
    expect(warnings[0].message).toContain('התראת כפילות למדריך ניר ברמן');
  });
});
