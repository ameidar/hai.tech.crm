import { z } from 'zod';
import { 
  paginationSchema, 
  sortingSchema, 
  searchSchema,
  emailSchema,
  nonEmptyStringSchema 
} from './common.js';

/**
 * Customer query parameters
 */
export const customerQuerySchema = paginationSchema
  .merge(sortingSchema)
  .merge(searchSchema)
  .extend({
    city: z.string().optional(),
    hasActiveRegistration: z
      .string()
      .optional()
      .transform((val) => val === 'true'),
  });

/**
 * Create customer schema
 */
export const createCustomerSchema = z.object({
  name: nonEmptyStringSchema,
  email: emailSchema.optional().or(z.literal('')),
  phone: z.string().min(9, 'Phone number required'),
  address: z.string().optional(),
  city: z.string().optional(),
  notes: z.string().optional(),
});

/**
 * Update customer schema
 */
export const updateCustomerSchema = z.object({
  name: nonEmptyStringSchema.optional(),
  email: emailSchema.optional().or(z.literal('')).nullable(),
  phone: z.string().min(9, 'Phone number required').optional(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

/**
 * Create student for customer schema
 */
export const createStudentForCustomerSchema = z.object({
  name: nonEmptyStringSchema,
  birthDate: z.string().optional().transform((val) => val ? new Date(val) : undefined),
  grade: z.string().optional(),
  notes: z.string().optional(),
});

// Export types
export type CustomerQuery = z.infer<typeof customerQuerySchema>;
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type CreateStudentForCustomerInput = z.infer<typeof createStudentForCustomerSchema>;
