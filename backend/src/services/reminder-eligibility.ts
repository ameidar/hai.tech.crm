import type { Prisma } from '@prisma/client';

export const REMINDER_MEETING_STATUS = 'scheduled' as const;
export const REMINDER_CYCLE_STATUS = 'active' as const;

// Registrations whose parents get lesson reminders. Trial registrations are
// included so trial kids get reminders, while staying out of revenue
// (revenue counts only registered/active/completed — see utils/revenue.ts).
export const REMINDER_REGISTRATION_STATUSES = ['active', 'trial'] as const;

export function reminderEligibleRegistrationWhere(): Prisma.RegistrationWhereInput {
  return { status: { in: [...REMINDER_REGISTRATION_STATUSES] }, deletedAt: null };
}

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
