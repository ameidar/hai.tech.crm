import { describe, expect, it } from 'vitest';
import { calculateCancellationRefund } from '../cancellations.js';

describe('calculateCancellationRefund', () => {
  it('returns the unused balance based on completed lessons', () => {
    expect(calculateCancellationRefund({
      paidAmount: 2656,
      totalMeetings: 16,
      completedMeetings: 12,
    })).toEqual({
      paidAmount: 2656,
      totalMeetings: 16,
      completedMeetings: 12,
      perMeeting: 166,
      consumedAmount: 1992,
      refundAmount: 664,
    });
  });

  it('does not return a negative refund when completed lessons exceed the cycle length', () => {
    expect(calculateCancellationRefund({
      paidAmount: 500,
      totalMeetings: 4,
      completedMeetings: 6,
    }).refundAmount).toBe(0);
  });
});
