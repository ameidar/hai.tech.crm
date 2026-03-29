import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFreebusyQuery = vi.fn();
const mockEventsInsert = vi.fn();

vi.mock('googleapis', () => {
  return {
    google: {
      auth: {
        GoogleAuth: class MockGoogleAuth {
          constructor() {}
        },
      },
      calendar: vi.fn().mockImplementation(() => ({
        freebusy: { query: mockFreebusyQuery },
        events: { insert: mockEventsInsert },
      })),
    },
  };
});

import { getAvailableSlots, bookAppointment } from '../google-calendar.js';

describe('getAvailableSlots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all slots when calendar is completely free', async () => {
    mockFreebusyQuery.mockResolvedValue({
      data: { calendars: { 'info@hai.tech': { busy: [] } } },
    });

    const slots = await getAvailableSlots('2026-02-16');
    expect(slots.length).toBe(18);
    expect(slots[0]).toBe('09:00');
    expect(slots[slots.length - 1]).toBe('17:30');
  });

  it('filters out busy slots correctly', async () => {
    mockFreebusyQuery.mockResolvedValue({
      data: {
        calendars: {
          'info@hai.tech': {
            busy: [{ start: '2026-02-16T08:00:00Z', end: '2026-02-16T09:00:00Z' }],
          },
        },
      },
    });

    const slots = await getAvailableSlots('2026-02-16');
    expect(slots).not.toContain('10:00');
    expect(slots).not.toContain('10:30');
    expect(slots).toContain('09:00');
    expect(slots).toContain('11:00');
  });

  it('returns empty array when entire day is booked', async () => {
    mockFreebusyQuery.mockResolvedValue({
      data: {
        calendars: {
          'info@hai.tech': {
            busy: [{ start: '2026-02-16T06:00:00Z', end: '2026-02-16T17:00:00Z' }],
          },
        },
      },
    });

    const slots = await getAvailableSlots('2026-02-16');
    expect(slots).toEqual([]);
  });

  it('handles summer time (IDT UTC+3) dates', async () => {
    mockFreebusyQuery.mockResolvedValue({
      data: {
        calendars: {
          'info@hai.tech': {
            busy: [{ start: '2026-07-15T11:00:00Z', end: '2026-07-15T12:00:00Z' }],
          },
        },
      },
    });

    const slots = await getAvailableSlots('2026-07-15');
    expect(slots).not.toContain('14:00');
    expect(slots).not.toContain('14:30');
    expect(slots).toContain('13:30');
    expect(slots).toContain('15:00');
  });
});

describe('bookAppointment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a calendar event successfully', async () => {
    mockEventsInsert.mockResolvedValue({ data: { id: 'event-123' } });

    const result = await bookAppointment('2026-02-16', '10:00', 'דוד כהן', '0501234567', 'שיעור ניסיון');
    expect(result.success).toBe(true);
    expect(result.eventId).toBe('event-123');
    expect(mockEventsInsert).toHaveBeenCalledOnce();

    const insertCall = mockEventsInsert.mock.calls[0][0];
    expect(insertCall.calendarId).toBe('info@hai.tech');
    expect(insertCall.requestBody.summary).toContain('דוד כהן');
    expect(insertCall.requestBody.start.dateTime).toBe('2026-02-16T10:00:00');
    expect(insertCall.requestBody.end.dateTime).toBe('2026-02-16T10:30:00');
    expect(insertCall.requestBody.start.timeZone).toBe('Asia/Jerusalem');
  });

  it('handles end time rolling over from :30', async () => {
    mockEventsInsert.mockResolvedValue({ data: { id: 'event-456' } });
    await bookAppointment('2026-02-16', '10:30', 'Test User');
    const insertCall = mockEventsInsert.mock.calls[0][0];
    expect(insertCall.requestBody.end.dateTime).toBe('2026-02-16T11:00:00');
  });

  it('returns error on API failure', async () => {
    mockEventsInsert.mockRejectedValue(new Error('Calendar API error'));
    const result = await bookAppointment('2026-02-16', '10:00', 'Test User');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Calendar API error');
  });

  it('includes phone and notes in description', async () => {
    mockEventsInsert.mockResolvedValue({ data: { id: 'e1' } });
    await bookAppointment('2026-02-16', '14:00', 'יעל', '0521234567', 'תכנות לילדים');
    const desc = mockEventsInsert.mock.calls[0][0].requestBody.description;
    expect(desc).toContain('0521234567');
    expect(desc).toContain('תכנות לילדים');
    expect(desc).toContain('Vapi AI');
  });
});
