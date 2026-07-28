import { describe, expect, it } from 'vitest';
import { isPreMeetingReminderDue } from '../whatsapp-reminder.service.js';

describe('pre-meeting WhatsApp reminder window', () => {
  it('sends in the normal 60-minute reminder window', () => {
    expect(isPreMeetingReminderDue(14 * 60 + 15, 15 * 60 + 15)).toBe(true);
  });

  it('catches up when node-cron missed the exact run', () => {
    expect(isPreMeetingReminderDue(14 * 60 + 30, 15 * 60 + 15)).toBe(true);
  });

  it('does not send too early or after the late grace window', () => {
    expect(isPreMeetingReminderDue(14 * 60, 15 * 60 + 15)).toBe(false);
    expect(isPreMeetingReminderDue(14 * 60 + 50, 15 * 60 + 15)).toBe(false);
  });
});
