import type { Prisma } from '@prisma/client';

export const REMINDER_MEETING_STATUS = 'scheduled' as const;
export const REMINDER_CYCLE_STATUS = 'active' as const;

export function reminderEligibleCycleWhereForDate(
  meetingDate: Date,
  extra?: Prisma.CycleWhereInput,
): Prisma.CycleWhereInput {
  const base: Prisma.CycleWhereInput = {
    status: REMINDER_CYCLE_STATUS,
    deletedAt: null,
    remainingMeetings: { gt: 0 },
    startDate: { lte: meetingDate },
    endDate: { gte: meetingDate },
  };

  return extra ? { AND: [base, extra] } : base;
}

export function reminderEligibleMeetingWhereForDate(
  meetingDate: Date,
  extra?: Prisma.MeetingWhereInput,
): Prisma.MeetingWhereInput {
  const base: Prisma.MeetingWhereInput = {
    scheduledDate: meetingDate,
    status: REMINDER_MEETING_STATUS,
    deletedAt: null,
    cycle: reminderEligibleCycleWhereForDate(meetingDate),
  };

  return extra ? { AND: [base, extra] } : base;
}
