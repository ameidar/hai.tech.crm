import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { calculateCycleEndDate, fetchHolidays, isHoliday } = await import('../holidays.js');

describe('holidays', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('includes Ministry of Education vacation bridge days even when Hebcal has no event', async () => {
    await expect(isHoliday(new Date('2026-09-24T00:00:00.000Z'))).resolves.toBe(true);
  });

  it('keeps Ministry of Education vacations when Hebcal is unavailable', async () => {
    const holidays = await fetchHolidays(2027);

    expect(holidays.has('2027-04-15')).toBe(true);
    expect(holidays.has('2027-04-18')).toBe(true);
  });

  it('skips Ministry of Education vacation dates when calculating cycle dates', async () => {
    const result = await calculateCycleEndDate(
      new Date('2026-09-03T00:00:00.000Z'),
      4,
      4
    );

    expect(result.meetingDates.map(date => date.toISOString().split('T')[0])).toEqual([
      '2026-09-03',
      '2026-09-10',
      '2026-09-17',
      '2026-10-08',
    ]);
  });
});
