import { z } from 'zod';
import { 
  paginationSchema, 
  sortingSchema, 
  searchSchema,
  nonEmptyStringSchema,
  emailSchema,
  moneySchema
} from './common.js';

/**
 * Instructor query parameters
 */
export const instructorQuerySchema = paginationSchema
  .merge(sortingSchema)
  .merge(searchSchema)
  .extend({
    isActive: z
      .string()
      .optional()
      .transform((val) => val === undefined ? undefined : val === 'true'),
    hasAvailability: z
      .string()
      .optional()
      .transform((val) => val === 'true'),
  });

/**
 * Create instructor schema
 */
export const createInstructorSchema = z.object({
  name: nonEmptyStringSchema,
  phone: z.string().min(9, 'Phone number required'),
  email: emailSchema.optional().or(z.literal('')),
  rateFrontal: moneySchema.optional(),
  rateOnline: moneySchema.optional(),
  ratePrivate: moneySchema.optional(),
  ratePreparation: moneySchema.optional(),
  isActive: z.boolean().optional().default(true),
  notes: z.string().optional(),
  // Optional: create associated user
  createUser: z.boolean().optional().default(false),
  userPassword: z.string().min(6, 'Password must be at least 6 characters').optional(),
});

/**
 * Update instructor schema
 */
export const updateInstructorSchema = z.object({
  name: nonEmptyStringSchema.optional(),
  phone: z.string().min(9).optional(),
  email: emailSchema.optional().or(z.literal('')).nullable(),
  rateFrontal: moneySchema.optional().nullable(),
  rateOnline: moneySchema.optional().nullable(),
  ratePrivate: moneySchema.optional().nullable(),
  ratePreparation: moneySchema.optional().nullable(),
  isActive: z.boolean().optional(),
  notes: z.string().optional().nullable(),
});

/**
 * Instructor meetings query parameters
 */
export const instructorMeetingsQuerySchema = paginationSchema.extend({
  status: z.enum(['scheduled', 'completed', 'cancelled', 'postponed']).optional(),
  from: z.string().optional().transform((val) => val ? new Date(val) : undefined),
  to: z.string().optional().transform((val) => val ? new Date(val) : undefined),
});

// Export types
export type InstructorQuery = z.infer<typeof instructorQuerySchema>;
export type CreateInstructorInput = z.infer<typeof createInstructorSchema>;
export type UpdateInstructorInput = z.infer<typeof updateInstructorSchema>;
export type InstructorMeetingsQuery = z.infer<typeof instructorMeetingsQuerySchema>;
