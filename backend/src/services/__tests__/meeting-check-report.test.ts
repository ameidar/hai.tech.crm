import { describe, expect, it } from 'vitest';
import { buildMeetingCheckReport, MeetingCheckMeeting } from '../meeting-check-report.js';

function time(hours: number, minutes = 0): Date {
  return new Date(Date.UTC(1970, 0, 1, hours, minutes));
}

function meeting(overrides: Partial<MeetingCheckMeeting>): MeetingCheckMeeting {
  return {
    id: overrides.id || crypto.randomUUID(),
    scheduledDate: new Date('2026-07-12T00:00:00.000Z'),
    startTime: overrides.startTime || time(10),
    endTime: overrides.endTime || time(11),
    status: overrides.status || 'scheduled',
    zoomMeetingId: overrides.zoomMeetingId ?? null,
    zoomHostEmail: overrides.zoomHostEmail ?? null,
    instructorId: overrides.instructorId ?? 'instructor-1',
    instructor: overrides.instructor ?? { name: 'אור' },
    cycle: overrides.cycle || {
      name: 'מחזור בדיקה',
      registrations: [{ status: 'active', paymentStatus: 'paid' }],
    },
  };
}

describe('buildMeetingCheckReport', () => {
  it('reports relevant meeting issues and excludes Monday operational cycles', () => {
    const report = buildMeetingCheckReport('2026-07-12', [
      meeting({ id: 'a', startTime: time(10), endTime: time(11), instructorId: 'i1' }),
      meeting({ id: 'b', startTime: time(10, 30), endTime: time(11, 30), instructorId: 'i1' }),
      meeting({
        id: 'no-active',
        startTime: time(12),
        endTime: time(13),
        cycle: { name: 'קייטנה', registrations: [{ status: 'cancelled', paymentStatus: 'paid' }] },
      }),
      meeting({
        id: 'unpaid',
        startTime: time(13),
        endTime: time(14),
        cycle: { name: 'רובלוקס', registrations: [{ status: 'active', paymentStatus: 'unpaid' }] },
      }),
      meeting({ id: 'postponed', startTime: time(15), endTime: time(16), status: 'postponed' }),
      meeting({
        id: 'monday',
        startTime: time(16),
        endTime: time(17),
        cycle: { name: 'מנדיי - לא בדוח', registrations: [] },
      }),
    ]);

    expect(report.issueCount).toBeGreaterThan(0);
    expect(report.message).toContain('🔴 *חפיפת מדריך:*');
    expect(report.message).toContain('🟡 *אין רישומים פעילים:*');
    expect(report.message).toContain('🟠 *לא שולם');
    expect(report.message).toContain('⚠️ *סטטוס חריג:*');
    expect(report.message).not.toContain('מנדיי - לא בדוח');
  });

  it('returns an all-clear message when no issues are found', () => {
    const report = buildMeetingCheckReport('2026-07-12', [
      meeting({ id: 'ok', startTime: time(10), endTime: time(11), instructorId: 'i1' }),
    ]);

    expect(report.issueCount).toBe(0);
    expect(report.message).toBe('✅ *דוח בדיקת פגישות ל-2026-07-12*\nהכל בסדר');
  });
});
