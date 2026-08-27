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
    zoomJoinUrl: 'zoomJoinUrl' in overrides ? overrides.zoomJoinUrl : 'https://meet.google.com/abc-defg-hij',
    zoomHostEmail: overrides.zoomHostEmail ?? null,
    instructorId: overrides.instructorId ?? 'instructor-1',
    activityType: overrides.activityType ?? 'frontal',
    instructor: overrides.instructor ?? { name: 'אור' },
    cycle: overrides.cycle || {
      name: 'מחזור בדיקה',
      type: 'institutional_per_child',
      isOnline: false,
      activityType: 'frontal',
      registrations: [{ status: 'active', paymentStatus: 'paid' }],
    },
  };
}

describe('buildMeetingCheckReport', () => {
  it('reports relevant meeting issues including Monday operational cycles', () => {
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
        cycle: { name: 'מנדיי - כן בדוח', registrations: [] },
      }),
    ]);

    expect(report.issueCount).toBeGreaterThan(0);
    expect(report.message).toContain('🔴 *חפיפת מדריך:*');
    expect(report.message).toContain('🟡 *אין רישומים פעילים:*');
    expect(report.message).toContain('🟠 *לא שולם');
    expect(report.message).toContain('⚠️ *סטטוס חריג:*');
    expect(report.message).toContain('מנדיי - כן בדוח');
  });

  it('reports scheduled online or private meetings that are missing a video link', () => {
    const report = buildMeetingCheckReport('2026-07-12', [
      meeting({
        id: 'private-no-link',
        startTime: time(10),
        endTime: time(11),
        instructorId: 'i1',
        zoomJoinUrl: null,
        cycle: {
          name: 'שיעור פרטי בלי לינק',
          type: 'private',
          activityType: 'private_lesson',
          isOnline: false,
          registrations: [{ status: 'active', paymentStatus: 'paid' }],
        },
      }),
      meeting({
        id: 'online-no-link',
        startTime: time(12),
        endTime: time(13),
        instructorId: 'i2',
        zoomJoinUrl: null,
        activityType: 'online',
        cycle: {
          name: 'אונליין בלי לינק',
          type: 'institutional_per_child',
          activityType: 'online',
          isOnline: true,
          registrations: [{ status: 'active', paymentStatus: 'paid' }],
        },
      }),
    ]);

    expect(report.issueCount).toBe(2);
    expect(report.message).toContain('🔴 *פגישת וידאו חסרה:*');
    expect(report.message).toContain('שיעור פרטי בלי לינק');
    expect(report.message).toContain('אונליין בלי לינק');
  });

  it('does not require a video link for frontal meetings', () => {
    const report = buildMeetingCheckReport('2026-07-12', [
      meeting({
        id: 'frontal-no-link',
        zoomJoinUrl: null,
        cycle: {
          name: 'פרונטלי בלי לינק',
          type: 'institutional_per_child',
          activityType: 'frontal',
          isOnline: false,
          registrations: [{ status: 'active', paymentStatus: 'paid' }],
        },
      }),
    ]);

    expect(report.issueCount).toBe(0);
  });

  it('returns an all-clear message when no issues are found', () => {
    const report = buildMeetingCheckReport('2026-07-12', [
      meeting({ id: 'ok', startTime: time(10), endTime: time(11), instructorId: 'i1' }),
    ]);

    expect(report.issueCount).toBe(0);
    expect(report.message).toBe('✅ *דוח בדיקת פגישות ל-2026-07-12*\nהכל בסדר');
  });
});
