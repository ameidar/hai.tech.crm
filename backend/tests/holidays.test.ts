import { describe, it, expect } from 'vitest';
import { dayNameToNumber } from '../src/utils/holidays.js';

describe('Holidays Utility', () => {
  describe('dayNameToNumber', () => {
    it('should convert Hebrew day names to numbers', () => {
      expect(dayNameToNumber('sunday')).toBe(0);
      expect(dayNameToNumber('monday')).toBe(1);
      expect(dayNameToNumber('tuesday')).toBe(2);
      expect(dayNameToNumber('wednesday')).toBe(3);
      expect(dayNameToNumber('thursday')).toBe(4);
      expect(dayNameToNumber('friday')).toBe(5);
      expect(dayNameToNumber('saturday')).toBe(6);
    });

    it('should return 0 for unknown day names', () => {
      expect(dayNameToNumber('invalid' as any)).toBe(0);
    });
  });
});
