import { describe, expect, it } from 'vitest';
import { resolveRegistrationAmount } from '../registration-amount.js';

describe('resolveRegistrationAmount', () => {
  it('prefers an explicit registration amount over the cycle default', () => {
    expect(resolveRegistrationAmount(1500, { defaultRegistrationAmount: 2980 })).toBe(1500);
  });

  it('falls back to the cycle default registration amount when amount is missing', () => {
    expect(resolveRegistrationAmount(undefined, { defaultRegistrationAmount: '2980.00' })).toBe(2980);
    expect(resolveRegistrationAmount(null, { defaultRegistrationAmount: 2980 })).toBe(2980);
  });

  it('returns null when neither amount is configured', () => {
    expect(resolveRegistrationAmount(undefined, { defaultRegistrationAmount: null })).toBeNull();
    expect(resolveRegistrationAmount(0, { defaultRegistrationAmount: 0 })).toBeNull();
  });
});
