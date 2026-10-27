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

// Institutional cycles billed per meeting (schools etc.) have no paying parent — the kids come
// through the institution — so parents must never get lesson reminders for them. Cycles billed
// per child (institutional_per_child, private, group) do have a parent customer and keep them.
export const PARENT_REMINDER_EXCLUDED_CYCLE_TYPES = ['institutional_fixed'] as const;

export function cycleTypeAllowsParentReminders(type?: string | null): boolean {
  return !(PARENT_REMINDER_EXCLUDED_CYCLE_TYPES as readonly string[]).includes(type ?? '');
}

/** Effective sendParentReminders value for a cycle of the given type. */
export function resolveSendParentReminders(type: string | null | undefined, requested?: boolean | null): boolean {
  if (!cycleTypeAllowsParentReminders(type)) return false;
  return requested ?? true;
}
