import { z } from 'zod';
import {
  paginationSchema,
  sortingSchema,
  uuidSchema,
} from './common.js';

/**
 * Registration status enum
 */
export const registrationStatusEnum = z.enum(['registered', 'active', 'completed', 'cancelled', 'trial']);

/**
 * Payment status enum
 */
export const paymentStatusEnum = z.enum(['unpaid', 'partial', 'paid']);

/**
 * Payment method enum
 */
export const paymentMethodEnum = z.enum(['credit', 'transfer', 'cash']);

/**
 * Registration query parameters
 */
export const registrationQuerySchema = paginationSchema
  .merge(sortingSchema)
  .extend({
    studentId: uuidSchema.optional(),
    cycleId: uuidSchema.optional(),
    customerId: uuidSchema.optional(),
    status: registrationStatusEnum.optional(),
    paymentStatus: paymentStatusEnum.optional(),
    from: z.string().optional().transform((val) => (val ? new Date(val) : undefined)),
    to: z.string().optional().transform((val) => (val ? new Date(val) : undefined)),
  });

/**
 * Create registration schema
 */
export const createRegistrationSchema = z.object({
  studentId: uuidSchema,
  cycleId: uuidSchema,
  registrationDate: z.string().optional().transform((val) => (val ? new Date(val) : new Date())),
  status: registrationStatusEnum.optional().default('registered'),
  amount: z.number().nonnegative().optional(),
  paymentStatus: paymentStatusEnum.optional(),
  paymentMethod: paymentMethodEnum.optional(),
  invoiceLink: z.string().url().optional(),
  notes: z.string().optional(),
});

/**
 * Update registration schema
 */
export const updateRegistrationSchema = z.object({
  status: registrationStatusEnum.optional(),
  amount: z.number().nonnegative().optional().nullable(),
  paymentStatus: paymentStatusEnum.optional().nullable(),
  paymentMethod: paymentMethodEnum.optional().nullable(),
  invoiceLink: z.string().url().optional().nullable(),
  cancellationReason: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

/**
 * Update payment schema
 */
export const updatePaymentSchema = z.object({
  paymentStatus: paymentStatusEnum,
  paymentMethod: paymentMethodEnum.optional(),
  amount: z.number().positive().optional(),
  invoiceLink: z.string().url().optional(),
});

/**
 * Cancel registration schema
 */
export const cancelRegistrationSchema = z.object({
  reason: z.string().optional(),
});

// Export types
export type RegistrationQuery = z.infer<typeof registrationQuerySchema>;
export type CreateRegistrationInput = z.infer<typeof createRegistrationSchema>;
export type UpdateRegistrationInput = z.infer<typeof updateRegistrationSchema>;
export type UpdatePaymentInput = z.infer<typeof updatePaymentSchema>;
export type CancelRegistrationInput = z.infer<typeof cancelRegistrationSchema>;
