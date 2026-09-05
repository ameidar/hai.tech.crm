import { describe, expect, it } from 'vitest';
import {
  findZoomHostConflictGroups,
  formatZoomHostConflictAlert,
} from '../zoom-conflicts.js';
import type { ZoomConflictMeeting } from '../zoom-conflicts.js';

function dbTime(value: string): Date {
  return new Date(`1970-01-01T${value}:00.000Z`);
}

function meeting(overrides: Partial<ZoomConflictMeeting>): ZoomConflictMeeting {
  return {
    id: overrides.id || 'meeting-id',
    scheduledDate: new Date('2026-07-08T00:00:00.000Z'),
    startTime: overrides.startTime || dbTime('10:00'),
    endTime: overrides.endTime || dbTime('10:45'),
    zoomHostEmail: overrides.zoomHostEmail || 'inna@hai.tech',
    zoomMeetingId: overrides.zoomMeetingId || '123',
    cycle: overrides.cycle || { name: 'שיעור ניסיון' },
    instructor: overrides.instructor || { name: 'ניר ברמן' },
  };
}

describe('zoom host conflicts', () => {
  it('groups overlapping tomorrow meetings on the same Zoom host', () => {
    const conflicts = findZoomHostConflictGroups([
      meeting({
        id: 'romi',
        startTime: dbTime('17:30'),
        endTime: dbTime('18:15'),
        zoomMeetingId: '89643321583',
        cycle: { name: 'שיעורים פרטיים רובלוקס לרומי' },
        instructor: { name: 'מורין לוגסי בן הרוש' },
      }),
      meeting({
        id: 'regina',
        startTime: dbTime('17:30'),
        endTime: dbTime('18:15'),
        zoomMeetingId: '89914849949',
        cycle: { name: 'שיעורי ניסיון פרטיים - גנרי' },
      }),
      meeting({
        id: 'other-host',
        startTime: dbTime('17:30'),
        endTime: dbTime('18:15'),
        zoomHostEmail: 'hila@hai.tech',
      }),
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].zoomHostEmail).toBe('inna@hai.tech');
    expect(conflicts[0].meetings.map(m => m.id)).toEqual(['romi', 'regina']);
  });

  it('does not flag back-to-back meetings on the same host', () => {
    const conflicts = findZoomHostConflictGroups([
      meeting({ id: 'first', startTime: dbTime('16:45'), endTime: dbTime('17:30') }),
      meeting({ id: 'second', startTime: dbTime('17:30'), endTime: dbTime('18:15') }),
    ]);

    expect(conflicts).toEqual([]);
  });

  it('formats conflict alerts for the daily summary', () => {
    const [conflict] = findZoomHostConflictGroups([
      meeting({ id: 'a', startTime: dbTime('17:30'), endTime: dbTime('18:15'), zoomMeetingId: '89643321583' }),
      meeting({ id: 'b', startTime: dbTime('17:45'), endTime: dbTime('18:30'), zoomMeetingId: '89914849949' }),
    ]);

    expect(formatZoomHostConflictAlert(conflict)).toContain('התנגשות Zoom מחר בחשבון inna@hai.tech');
    expect(formatZoomHostConflictAlert(conflict)).toContain('17:30-18:15');
    expect(formatZoomHostConflictAlert(conflict)).toContain('17:45-18:30');
  });
});
