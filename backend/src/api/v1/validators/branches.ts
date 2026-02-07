import { z } from 'zod';
import { 
  paginationSchema, 
  sortingSchema, 
  searchSchema,
  nonEmptyStringSchema,
  emailSchema,
  createEnumSchema
} from './common.js';

// Branch type enum values
const branchTypeValues = ['school', 'community_center', 'frontal', 'online'] as const;

/**
 * Branch query parameters
 */
export const branchQuerySchema = paginationSchema
  .merge(sortingSchema)
  .merge(searchSchema)
  .extend({
    type: createEnumSchema(branchTypeValues).optional(),
    city: z.string().optional(),
    isActive: z
      .string()
      .optional()
      .transform((val) => val === undefined ? undefined : val === 'true'),
  });

/**
 * Create branch schema
 */
export const createBranchSchema = z.object({
  name: nonEmptyStringSchema,
  type: createEnumSchema(branchTypeValues),
  address: z.string().optional(),
  city: z.string().optional(),
  contactName: z.string().optional(),
  contactPhone: z.string().optional(),
  contactEmail: emailSchema.optional().or(z.literal('')),
  isActive: z.boolean().optional().default(true),
});

/**
 * Update branch schema
 */
export const updateBranchSchema = z.object({
  name: nonEmptyStringSchema.optional(),
  type: createEnumSchema(branchTypeValues).optional(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  contactName: z.string().optional().nullable(),
  contactPhone: z.string().optional().nullable(),
  contactEmail: emailSchema.optional().or(z.literal('')).nullable(),
  isActive: z.boolean().optional(),
});

// Export types
export type BranchQuery = z.infer<typeof branchQuerySchema>;
export type CreateBranchInput = z.infer<typeof createBranchSchema>;
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;
