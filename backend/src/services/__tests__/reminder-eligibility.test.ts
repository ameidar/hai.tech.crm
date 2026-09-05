import { describe, expect, it } from 'vitest';
import {
  reminderEligibleCycleWhereForDate,
  reminderEligibleMeetingWhereForDate,
} from '../reminder-eligibility.js';

describe('reminder eligibility filters', () => {
  const meetingDate = new Date('2026-06-30T00:00:00.000Z');

  it('requires an active non-deleted cycle with remaining meetings on the meeting date', () => {
    expect(reminderEligibleCycleWhereForDate(meetingDate)).toEqual({
      status: 'active',
      deletedAt: null,
      remainingMeetings: { gt: 0 },
      startDate: { lte: meetingDate },
      endDate: { gte: meetingDate },
    });
  });

  it('requires a scheduled non-deleted meeting and the eligible cycle filter', () => {
    expect(reminderEligibleMeetingWhereForDate(meetingDate)).toEqual({
      scheduledDate: meetingDate,
      status: 'scheduled',
      deletedAt: null,
      cycle: reminderEligibleCycleWhereForDate(meetingDate),
    });
  });

  it('keeps channel-specific filters as an AND condition', () => {
    expect(reminderEligibleMeetingWhereForDate(meetingDate, {
      cycle: { sendParentReminders: true },
    })).toEqual({
      AND: [
        {
          scheduledDate: meetingDate,
          status: 'scheduled',
          deletedAt: null,
          cycle: reminderEligibleCycleWhereForDate(meetingDate),
        },
        {
          cycle: { sendParentReminders: true },
        },
      ],
    });
  });
});
