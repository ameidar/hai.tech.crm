import { z } from 'zod';
import { 
  uuidSchema, 
  paginationSchema, 
  sortingSchema, 
  searchSchema,
  nonEmptyStringSchema 
} from './common.js';

/**
 * Student query parameters
 */
export const studentQuerySchema = paginationSchema
  .merge(sortingSchema)
  .merge(searchSchema)
  .extend({
    customerId: uuidSchema.optional(),
    grade: z.string().optional(),
  });

/**
 * Create student schema
 */
export const createStudentSchema = z.object({
  customerId: uuidSchema,
  name: nonEmptyStringSchema,
  birthDate: z.string().optional().transform((val) => val ? new Date(val) : undefined),
  grade: z.string().optional(),
  notes: z.string().optional(),
});

/**
 * Update student schema
 */
export const updateStudentSchema = z.object({
  name: nonEmptyStringSchema.optional(),
  birthDate: z.string().optional().nullable().transform((val) => val ? new Date(val) : null),
  grade: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

// Export types
export type StudentQuery = z.infer<typeof studentQuerySchema>;
export type CreateStudentInput = z.infer<typeof createStudentSchema>;
export type UpdateStudentInput = z.infer<typeof updateStudentSchema>;
