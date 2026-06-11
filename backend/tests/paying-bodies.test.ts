import { describe, it, expect } from 'vitest';
import { createSchema, updateSchema, isComplete } from '../src/routes/paying-bodies.js';

// Required fields (decided with Inna): name, taxId (ח.פ/ת.ז), contactName, email.
// Phone + address fields are optional. Enforcement is on create only — legacy
// rows are completed gradually via the all-optional update schema.
describe('paying-body createSchema (required fields)', () => {
  it('accepts a complete paying body', () => {
    const result = createSchema.safeParse({
      name: 'עיריית באר שבע',
      taxId: '500001234',
      contactName: 'אינה גרויס',
      email: 'inna@example.com',
      phone: '0501234567',
    });
    expect(result.success).toBe(true);
  });

  it('rejects when taxId is missing', () => {
    const result = createSchema.safeParse({
      name: 'עיריית באר שבע',
      contactName: 'אינה גרויס',
      email: 'inna@example.com',
    });
    expect(result.success).toBe(false);
  });

  it('rejects when contactName is missing', () => {
    const result = createSchema.safeParse({
      name: 'עיריית באר שבע',
      taxId: '500001234',
      email: 'inna@example.com',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid email on create', () => {
    const result = createSchema.safeParse({
      name: 'עיריית באר שבע',
      taxId: '500001234',
      contactName: 'אינה גרויס',
      email: 'not-an-email',
    });
    expect(result.success).toBe(false);
  });

  it('trims whitespace and rejects whitespace-only required fields', () => {
    const result = createSchema.safeParse({
      name: '   ',
      taxId: '500001234',
      contactName: 'אינה גרויס',
      email: 'inna@example.com',
    });
    expect(result.success).toBe(false);
  });

  it('keeps morningClientId when linking an existing Morning client', () => {
    const result = createSchema.safeParse({
      name: 'עיריית באר שבע',
      taxId: '500001234',
      contactName: 'אינה גרויס',
      email: 'inna@example.com',
      morningClientId: 'abc123',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.morningClientId).toBe('abc123');
  });
});

// On update every field is optional so an incomplete legacy row can be
// completed one field at a time.
describe('paying-body updateSchema (all-optional, transition)', () => {
  it('accepts a partial update (just a phone)', () => {
    const result = updateSchema.safeParse({ phone: '0501234567' });
    expect(result.success).toBe(true);
  });

  it('accepts clearing email with an empty string', () => {
    const result = updateSchema.safeParse({ email: '' });
    expect(result.success).toBe(true);
  });

  it('still rejects a malformed (non-empty) email on update', () => {
    const result = updateSchema.safeParse({ email: 'nope' });
    expect(result.success).toBe(false);
  });
});

// isComplete drives the "חסר השלמה" badge and flips a legacy row to complete
// once all four required fields are present.
describe('isComplete', () => {
  it('is true only when all required fields are present', () => {
    expect(
      isComplete({ name: 'X', taxId: '1', contactName: 'Y', email: 'a@b.com' }),
    ).toBe(true);
  });

  it('is false when any required field is missing', () => {
    expect(isComplete({ name: 'X', taxId: '1', contactName: 'Y', email: null })).toBe(false);
    expect(isComplete({ name: 'X', taxId: null, contactName: 'Y', email: 'a@b.com' })).toBe(false);
    expect(isComplete({ name: 'X' })).toBe(false);
  });
});
