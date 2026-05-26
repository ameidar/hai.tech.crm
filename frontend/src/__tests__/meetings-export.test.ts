import { describe, expect, it } from 'vitest';
import { buildMeetingsCsv, normalizeExportMonth } from '../utils/meetingsExcel';
import type { Meeting } from '../types';

const meeting = (overrides: Partial<Meeting>): Meeting => ({
  id: 'meeting-1',
  cycleId: 'cycle-1',
  instructorId: 'instructor-1',
  scheduledDate: '2026-05-17T00:00:00.000Z',
  startTime: '1970-01-01T17:30:00.000Z',
  endTime: '1970-01-01T18:30:00.000Z',
  status: 'completed',
  revenue: 0,
  instructorPayment: 0,
  profit: 0,
  createdAt: '2026-05-01T00:00:00.000Z',
  ...overrides,
});

describe('meetings export CSV', () => {
  it('exports a single cycle with the requested Hebrew columns and status labels', () => {
    const csv = buildMeetingsCsv([
      {
        name: 'מיינקראפט - קבוצה 1',
        meetings: [
          meeting({ status: 'scheduled', scheduledDate: '2026-05-24T00:00:00.000Z' }),
          meeting({ status: 'postponed', scheduledDate: '2026-05-10T00:00:00.000Z' }),
          meeting({ status: 'completed', scheduledDate: '2026-05-17T00:00:00.000Z' }),
        ],
      },
    ], false);

    expect(csv.split('\r\n')[0]).toBe('"תאריך","שעה","משך המפגש","סטטוס"');
    expect(csv).toMatch(/"10[/.]05[/.]2026","17:30 - 18:30","60 דקות","נדחה"/);
    expect(csv).toMatch(/"17[/.]05[/.]2026","17:30 - 18:30","60 דקות","התקיים"/);
    expect(csv).toMatch(/"24[/.]05[/.]2026","17:30 - 18:30","60 דקות",""/);
  });

  it('adds cycle name and filters meetings by selected month for multi-cycle export', () => {
    const csv = buildMeetingsCsv([
      {
        name: 'Scratch - עומר',
        meetings: [
          meeting({ scheduledDate: '2026-05-14T00:00:00.000Z' }),
          meeting({ scheduledDate: '2026-06-04T00:00:00.000Z' }),
        ],
      },
      {
        name: 'יזמות טכנולוגית ו-AI - עומר',
        meetings: [meeting({ scheduledDate: '2026-05-21T00:00:00.000Z' })],
      },
    ], true, { month: '2026-05' });

    expect(csv.split('\r\n')[0]).toBe('"שם המחזור","תאריך","שעה","משך המפגש","סטטוס"');
    expect(csv).toMatch(/"Scratch - עומר","14[/.]05[/.]2026"/);
    expect(csv).toMatch(/"יזמות טכנולוגית ו-AI - עומר","21[/.]05[/.]2026"/);
    expect(csv).not.toMatch(/04[/.]06[/.]2026/);
  });

  it('validates month picker values', () => {
    expect(normalizeExportMonth('2026-05')).toBe('2026-05');
    expect(normalizeExportMonth('')).toBeNull();
    expect(normalizeExportMonth(null)).toBeNull();
    expect(normalizeExportMonth('2026-13')).toBe('invalid');
    expect(normalizeExportMonth('05/2026')).toBe('invalid');
  });
});
