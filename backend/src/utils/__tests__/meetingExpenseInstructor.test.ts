import { describe, it, expect } from 'vitest';
import { defaultExpenseInstructorId, effectiveExpenseInstructorId } from '../meetingExpenseInstructor.js';

describe('effectiveExpenseInstructorId', () => {
  it("falls back to the meeting's instructor when the expense has no instructor", () => {
    expect(effectiveExpenseInstructorId({ instructorId: null }, { instructorId: 'kim' })).toBe('kim');
    expect(effectiveExpenseInstructorId({}, { instructorId: 'kim' })).toBe('kim');
    expect(effectiveExpenseInstructorId({ instructorId: '' }, { instructorId: 'kim' })).toBe('kim');
  });

  it("prefers the expense's own instructor (e.g. extra_instructor)", () => {
    expect(effectiveExpenseInstructorId({ instructorId: 'dana' }, { instructorId: 'kim' })).toBe('dana');
  });

  it('returns null when neither is known', () => {
    expect(effectiveExpenseInstructorId({ instructorId: null }, null)).toBeNull();
    expect(effectiveExpenseInstructorId({ instructorId: null }, { instructorId: null })).toBeNull();
  });
});

describe('defaultExpenseInstructorId', () => {
  it("defaults to the meeting's instructor when none is provided", () => {
    expect(defaultExpenseInstructorId(undefined, 'kim')).toBe('kim');
    expect(defaultExpenseInstructorId(null, 'kim')).toBe('kim');
    expect(defaultExpenseInstructorId('', 'kim')).toBe('kim');
  });

  it('keeps an explicitly provided instructor', () => {
    expect(defaultExpenseInstructorId('dana', 'kim')).toBe('dana');
  });

  it('returns null only when the meeting has no instructor either', () => {
    expect(defaultExpenseInstructorId(undefined, null)).toBeNull();
  });
});
