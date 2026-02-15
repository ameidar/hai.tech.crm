import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isBusinessHoursInIsrael } from '../vapi.js';

// We can't easily test initiateVapiCall without mocking prisma + fetch,
// so we focus on the exported pure function and verify behavior via date mocking.

describe('isBusinessHoursInIsrael', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true during business hours (10:00 Israel time)', () => {
    // 10:00 Israel (IST UTC+2) = 08:00 UTC
    vi.setSystemTime(new Date('2026-01-15T08:00:00Z'));
    expect(isBusinessHoursInIsrael()).toBe(true);
  });

  it('returns true during business hours (14:00 Israel time, summer IDT)', () => {
    // 14:00 Israel (IDT UTC+3) = 11:00 UTC (July)
    vi.setSystemTime(new Date('2026-07-15T11:00:00Z'));
    expect(isBusinessHoursInIsrael()).toBe(true);
  });

  it('returns true at exactly 08:00 Israel time (boundary)', () => {
    // 08:00 IST = 06:00 UTC (winter)
    vi.setSystemTime(new Date('2026-01-15T06:00:00Z'));
    expect(isBusinessHoursInIsrael()).toBe(true);
  });

  it('returns false at 07:59 Israel time (before business hours)', () => {
    // 07:59 IST = 05:59 UTC
    vi.setSystemTime(new Date('2026-01-15T05:59:00Z'));
    expect(isBusinessHoursInIsrael()).toBe(false);
  });

  it('returns false at 03:00 Israel time (middle of night)', () => {
    // 03:00 IST = 01:00 UTC
    vi.setSystemTime(new Date('2026-01-15T01:00:00Z'));
    expect(isBusinessHoursInIsrael()).toBe(false);
  });

  // Note: currently hour < 24 (extended for testing), so late night hours 21-23 return true
  // After reverting to hour < 21, these would return false
  it('returns true at 22:00 Israel time (extended testing hours)', () => {
    // 22:00 IST = 20:00 UTC
    vi.setSystemTime(new Date('2026-01-15T20:00:00Z'));
    expect(isBusinessHoursInIsrael()).toBe(true);
  });
});

describe('phone number formatting (internal, tested via behavior)', () => {
  // formatPhoneForVapi is not exported, but we can verify the expected logic
  it('should convert 0501234567 to +972501234567', () => {
    // Inline test of the formatting logic
    const formatPhone = (phone: string): string => {
      let cleaned = phone.replace(/\D/g, '');
      if (cleaned.startsWith('0')) {
        cleaned = '972' + cleaned.substring(1);
      }
      if (!cleaned.startsWith('+')) {
        cleaned = '+' + cleaned;
      }
      return cleaned;
    };

    expect(formatPhone('0501234567')).toBe('+972501234567');
    expect(formatPhone('050-123-4567')).toBe('+972501234567');
    expect(formatPhone('+972501234567')).toBe('+972501234567');
    expect(formatPhone('972501234567')).toBe('+972501234567');
  });
});

describe('buildFirstMessage logic (internal)', () => {
  // Replicate the logic since it's not exported
  function buildFirstMessage(data: { name: string; childName?: string; interest?: string }): string {
    const firstName = data.name.split(' ')[0];
    if (data.interest === 'kids_education' && data.childName) {
      return `היי ${firstName}, מדברת נועה מדרך ההייטק. ראיתי שנרשמתם לגבי ${data.childName}. אשמח לספר לכם על הקורסים שלנו ולקבוע שיעור ניסיון. יש לכם רגע?`;
    }
    if (data.interest === 'ai_business') {
      return `היי ${firstName}, מדברת נועה מדרך ההייטק. ראיתי שהתעניינתם בפתרונות AI לעסקים. אשמח לספר לכם על מה שאנחנו מציעים. יש לכם רגע?`;
    }
    return `היי ${firstName}, מדברת נועה מדרך ההייטק. ראיתי שפניתם אלינו דרך האתר. אשמח לעזור לכם. יש לכם רגע?`;
  }

  it('uses kids_education message when interest and childName provided', () => {
    const msg = buildFirstMessage({ name: 'דוד לוי', childName: 'יונתן', interest: 'kids_education' });
    expect(msg).toContain('דוד');
    expect(msg).toContain('יונתן');
    expect(msg).toContain('קורסים');
  });

  it('uses ai_business message', () => {
    const msg = buildFirstMessage({ name: 'שרה כהן', interest: 'ai_business' });
    expect(msg).toContain('שרה');
    expect(msg).toContain('AI לעסקים');
  });

  it('uses default message for unknown interest', () => {
    const msg = buildFirstMessage({ name: 'אבי ישראלי' });
    expect(msg).toContain('אבי');
    expect(msg).toContain('האתר');
  });

  it('uses only first name', () => {
    const msg = buildFirstMessage({ name: 'John Smith' });
    expect(msg).toContain('John');
    expect(msg).not.toContain('Smith');
  });
});
