/**
 * Payment Calculation Utility
 * 
 * Calculates instructor payment based on:
 * 1. Instructor Role (primary/support)
 * 2. Cycle budget envelope (for primary instructors)
 * 3. Activity type rates (fallback)
 */

import { Decimal } from '@prisma/client/runtime/library';

export type ActivityType = 'online' | 'frontal' | 'private_lesson';
export type InstructorRole = 'primary' | 'support' | null;

interface InstructorRates {
  rateFrontal?: Decimal | number | null;
  rateOnline?: Decimal | number | null;
  ratePrivate?: Decimal | number | null;
  rateSupport?: Decimal | number | null;
}

interface CycleBudget {
  instructorTotalBudget?: Decimal | number | null;
  primaryInstructorId?: string | null;
  totalMeetings: number;
}

interface PaymentCalculationParams {
  instructor: InstructorRates;
  cycle: CycleBudget;
  meetingInstructorId: string;
  instructorRole?: InstructorRole;
  activityType: ActivityType;
  durationMinutes: number;
}

interface PaymentResult {
  instructorPayment: number;
  calculationMethod: 'envelope' | 'support_rate' | 'activity_rate';
}

/**
 * Calculate instructor payment for a meeting
 * 
 * Logic:
 * 1. If instructor is PRIMARY and cycle has envelope budget:
 *    → payment = total_budget / total_meetings
 * 
 * 2. If instructor is SUPPORT:
 *    → payment = rateSupport * hours
 * 
 * 3. Otherwise (default):
 *    → payment = rate[activityType] * hours
 */
export function calculateInstructorPayment(params: PaymentCalculationParams): PaymentResult {
  const {
    instructor,
    cycle,
    meetingInstructorId,
    instructorRole,
    activityType,
    durationMinutes,
  } = params;

  const hours = durationMinutes / 60;

  // Case 1: Primary instructor with envelope budget
  const isPrimaryInstructor = 
    instructorRole === 'primary' || 
    (cycle.primaryInstructorId && meetingInstructorId === cycle.primaryInstructorId);
  
  if (isPrimaryInstructor && cycle.instructorTotalBudget && cycle.totalMeetings > 0) {
    const totalBudget = Number(cycle.instructorTotalBudget);
    const payment = Math.round(totalBudget / cycle.totalMeetings);
    return {
      instructorPayment: payment,
      calculationMethod: 'envelope',
    };
  }

  // Case 2: Support instructor
  if (instructorRole === 'support') {
    const supportRate = Number(instructor.rateSupport) || 0;
    const payment = Math.round(supportRate * hours);
    return {
      instructorPayment: payment,
      calculationMethod: 'support_rate',
    };
  }

  // Case 3: Default - use activity type rate
  let hourlyRate = 0;
  switch (activityType) {
    case 'online':
      hourlyRate = Number(instructor.rateOnline) || Number(instructor.rateFrontal) || 0;
      break;
    case 'private_lesson':
      hourlyRate = Number(instructor.ratePrivate) || Number(instructor.rateFrontal) || 0;
      break;
    case 'frontal':
    default:
      hourlyRate = Number(instructor.rateFrontal) || 0;
      break;
  }

  const payment = Math.round(hourlyRate * hours);
  return {
    instructorPayment: payment,
    calculationMethod: 'activity_rate',
  };
}

/**
 * Get the hourly rate for an activity type
 * (Kept for backward compatibility)
 */
export function getHourlyRate(instructor: InstructorRates, activityType: ActivityType): number {
  switch (activityType) {
    case 'online':
      return Number(instructor.rateOnline) || Number(instructor.rateFrontal) || 0;
    case 'private_lesson':
      return Number(instructor.ratePrivate) || Number(instructor.rateFrontal) || 0;
    case 'frontal':
    default:
      return Number(instructor.rateFrontal) || 0;
  }
}
