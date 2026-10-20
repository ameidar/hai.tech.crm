import { describe, expect, it } from 'vitest';
import {
  getRange,
  layoutOverlaps,
  shiftAnchor,
  timeToMinutes,
  toDateKey,
  fromDateKey,
} from './calendarLayout';

describe('calendarLayout', () => {
  it('parses both time formats', () => {
    expect(timeToMinutes('08:30')).toBe(510);
    expect(timeToMinutes('17:45:00')).toBe(1065);
    expect(timeToMinutes('1970-01-01T12:05:00.000Z')).toBe(725);
  });

  it('builds Sunday-first week and full-week month ranges', () => {
    const wed = fromDateKey('2026-10-21');
    const week = getRange('week', wed);
    expect(toDateKey(week.start)).toBe('2026-10-18');
    expect(toDateKey(week.end)).toBe('2026-10-24');

    const month = getRange('month', wed);
    expect(toDateKey(month.start)).toBe('2026-09-27');
    expect(toDateKey(month.end)).toBe('2026-10-31');
    expect(toDateKey(shiftAnchor('month', wed, 1))).toBe('2026-11-01');
  });

  it('places overlapping meetings side by side and keeps others full width', () => {
    const placed = layoutOverlaps([
      { id: 'a', start: 480, end: 570 },
      { id: 'b', start: 480, end: 570 },
      { id: 'c', start: 540, end: 600 },
      { id: 'd', start: 720, end: 810 },
    ]);
    const by = Object.fromEntries(placed.map((p) => [p.item.id, p]));
    expect(by.a.columns).toBe(3);
    expect(new Set([by.a.column, by.b.column, by.c.column]).size).toBe(3);
    expect(by.d).toMatchObject({ column: 0, columns: 1 });
  });

  it('reuses a freed column within a cluster', () => {
    const placed = layoutOverlaps([
      { id: 'a', start: 480, end: 540 },
      { id: 'b', start: 500, end: 600 },
      { id: 'c', start: 540, end: 580 },
    ]);
    const by = Object.fromEntries(placed.map((p) => [p.item.id, p]));
    expect(by.c.column).toBe(by.a.column);
    expect(by.a.columns).toBe(2);
  });
});
