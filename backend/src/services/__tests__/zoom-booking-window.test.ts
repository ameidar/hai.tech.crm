import { describe, expect, it } from 'vitest';
import { buildLocalZoomBookingWindow } from '../zoom.js';

describe('buildLocalZoomBookingWindow', () => {
  it('uses Israel local date and time when comparing against DB date/time columns', () => {
    const window = buildLocalZoomBookingWindow(new Date('2026-07-07T14:20:00.000Z'), 55);

    expect(window.scheduledDate.toISOString()).toBe('2026-07-07T00:00:00.000Z');
    expect(window.newStart.toISOString()).toBe('1970-01-01T17:20:00.000Z');
    expect(window.newEnd.toISOString()).toBe('1970-01-01T18:15:00.000Z');
  });

  it('handles Israel winter offset without hard-coded +03:00 assumptions', () => {
    const window = buildLocalZoomBookingWindow(new Date('2026-01-07T15:20:00.000Z'), 55);

    expect(window.scheduledDate.toISOString()).toBe('2026-01-07T00:00:00.000Z');
    expect(window.newStart.toISOString()).toBe('1970-01-01T17:20:00.000Z');
    expect(window.newEnd.toISOString()).toBe('1970-01-01T18:15:00.000Z');
  });
});
