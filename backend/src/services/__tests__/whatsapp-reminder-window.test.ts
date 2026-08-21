import { describe, expect, it } from 'vitest';
import { formatLessonProgress, isPreMeetingReminderDue } from '../whatsapp-reminder.service.js';

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

describe('instructor lesson progress text', () => {
  it('formats lesson number and remaining lessons after the meeting', () => {
    expect(formatLessonProgress({
      lessonNumber: 5,
      totalMeetings: 16,
      remainingAfter: 11,
    })).toBe('📊 שיעור 5 מתוך 16 | נותרו 11 לסיום אחרי השיעור.');
  });

  it('formats compact progress for WhatsApp template parameters', () => {
    expect(formatLessonProgress({
      lessonNumber: 5,
      totalMeetings: 16,
      remainingAfter: 11,
    }, true)).toBe('שיעור 5/16, נותרו 11');
  });
});
