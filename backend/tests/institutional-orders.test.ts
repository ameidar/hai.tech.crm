import { describe, it, expect } from 'vitest';
import { orderSchema, createOrderSchema } from '../src/routes/institutional-orders.js';

// Regression: editing an institutional order round-trips ALL existing fields
// from the frontend. Legacy/imported records may hold free text in
// contactEmail or non-UUID branch ids, which previously failed strict
// .email()/.uuid() validation and blocked saving (e.g. when attaching a branch).
describe('institutional orderSchema (PUT round-trip tolerance)', () => {
  it('accepts free-text legacy contactEmail (not a valid email)', () => {
    const result = orderSchema.partial().safeParse({
      branchId: '046d5fac-1282-492f-ae12-e876566967c4',
      contactEmail: 'הנדסת מערכות... חשוב להם מאוד שיהיה ערך רגשי',
    });
    expect(result.success).toBe(true);
  });

  it('accepts non-UUID branch ids (e.g. imported/legacy)', () => {
    const result = orderSchema.partial().safeParse({ branchId: 'b1' });
    expect(result.success).toBe(true);
  });

  it('still accepts a valid order with a branch and clean email', () => {
    const result = orderSchema.safeParse({
      branchId: '046d5fac-1282-492f-ae12-e876566967c4',
      orderName: 'הזמנה מוסדית',
      contactEmail: 'school@example.com',
      pricePerMeeting: 350,
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty branchId / email (clearing the field)', () => {
    const result = orderSchema.partial().safeParse({ branchId: '', contactEmail: '' });
    expect(result.success).toBe(true);
  });

  // Regression: the API serializes Decimal fields as strings (e.g. "2500"),
  // so the edit form sends them back as strings. Strict z.number() rejected
  // them ("Expected number, received string") and blocked saving when
  // attaching a branch. Money fields now coerce string -> number.
  it('coerces stringified Decimal money fields back to numbers', () => {
    const result = orderSchema.partial().safeParse({
      branchId: 'ce2f732f-e7fd-436f-87bb-30251470021e',
      pricePerMeeting: '2500',
      estimatedTotal: '2500',
      totalAmount: '2500',
      paidAmount: '0',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pricePerMeeting).toBe(2500);
      expect(result.data.totalAmount).toBe(2500);
      expect(result.data.paidAmount).toBe(0);
    }
  });

  it('keeps null money fields as null (does not coerce to 0)', () => {
    const result = orderSchema.partial().safeParse({ totalAmount: null, pricePerMeeting: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.totalAmount).toBeNull();
      expect(result.data.pricePerMeeting).toBeNull();
    }
  });
});

// New orders must be tied to both a branch and a paying body. Same grandfather
// pattern as branch (#182): enforced on CREATE only — legacy orders stay editable
// via the all-optional update schema.
describe('createOrderSchema (branch + paying body required on create)', () => {
  it('accepts a create with both branchId and payingBodyId', () => {
    const result = createOrderSchema.safeParse({
      branchId: '046d5fac-1282-492f-ae12-e876566967c4',
      payingBodyId: 'a1b2c3d4-0000-0000-0000-000000000000',
      orderName: 'הזמנה מוסדית',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a create with no payingBodyId', () => {
    const result = createOrderSchema.safeParse({
      branchId: '046d5fac-1282-492f-ae12-e876566967c4',
      orderName: 'הזמנה מוסדית',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a create with an empty payingBodyId', () => {
    const result = createOrderSchema.safeParse({
      branchId: '046d5fac-1282-492f-ae12-e876566967c4',
      payingBodyId: '',
    });
    expect(result.success).toBe(false);
  });

  it('still requires a branch on create', () => {
    const result = createOrderSchema.safeParse({
      payingBodyId: 'a1b2c3d4-0000-0000-0000-000000000000',
    });
    expect(result.success).toBe(false);
  });

  it('update schema leaves payingBodyId optional (legacy rows stay editable)', () => {
    const result = orderSchema.partial().safeParse({ orderName: 'עדכון בלי גוף משלם' });
    expect(result.success).toBe(true);
  });
});
