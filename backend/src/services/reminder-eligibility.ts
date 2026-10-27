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

// Institutional cycles billed per meeting (schools etc.) usually have no paying parent — the kids
// come through the institution — so parent reminders default to OFF for them. Staff can still turn
// them on explicitly per cycle. Cycles billed per child (institutional_per_child, private, group)
// have a parent customer and default to ON.
export function defaultSendParentReminders(type?: string | null): boolean {
  return type !== 'institutional_fixed';
}

/** sendParentReminders for a new cycle: an explicit choice wins, otherwise the type default. */
export function resolveSendParentReminders(type: string | null | undefined, requested?: boolean | null): boolean {
  return requested ?? defaultSendParentReminders(type);
}
