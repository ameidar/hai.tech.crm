import { describe, expect, it } from 'vitest';
import { buildMissingGoogleMeetArtifactsAlert } from '../google-meet.js';

describe('buildMissingGoogleMeetArtifactsAlert', () => {
  it('formats an operations alert when Google Meet does not produce artifacts', () => {
    const alert = buildMissingGoogleMeetArtifactsAlert({
      cycleName: 'שיעורים פרטיים דניאל- עם ניר',
      instructorName: 'ניר ברמן',
      instructorEmail: 'bermannir@gmail.com',
      scheduledDate: new Date('2026-08-26T00:00:00.000Z'),
      startTime: new Date('1970-01-01T17:00:00.000Z'),
      endTime: new Date('1970-01-01T17:45:00.000Z'),
      joinUrl: 'https://meet.google.com/qts-jvcb-izs',
      hostEmail: 'ami@hai.tech',
      recordingExpected: true,
      transcriptExpected: true,
      conferenceRecordFound: true,
    });

    expect(alert).toContain('חסר artifact מ-Google Meet');
    expect(alert).toContain('שיעורים פרטיים דניאל- עם ניר');
    expect(alert).toContain('ניר ברמן (bermannir@gmail.com)');
    expect(alert).toContain('17:00-17:45');
    expect(alert).toContain('הקלטה + תמלול');
    expect(alert).toContain('הפגישה התקיימה');
  });
});
