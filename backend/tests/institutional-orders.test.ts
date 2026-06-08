import { describe, it, expect } from 'vitest';
import { orderSchema } from '../src/routes/institutional-orders.js';

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
});
