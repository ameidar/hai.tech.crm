import { z } from 'zod';
import { 
  paginationSchema, 
  sortingSchema, 
  searchSchema,
  nonEmptyStringSchema,
  createEnumSchema
} from './common.js';

// Course category enum values
const courseCategoryValues = ['programming', 'ai', 'robotics', 'printing_3d'] as const;

/**
 * Course query parameters
 */
export const courseQuerySchema = paginationSchema
  .merge(sortingSchema)
  .merge(searchSchema)
  .extend({
    category: createEnumSchema(courseCategoryValues).optional(),
    isActive: z
      .string()
      .optional()
      .transform((val) => val === undefined ? undefined : val === 'true'),
  });

/**
 * Create course schema
 */
export const createCourseSchema = z.object({
  name: nonEmptyStringSchema,
  description: z.string().optional(),
  targetAudience: z.string().optional(),
  category: createEnumSchema(courseCategoryValues),
  isActive: z.boolean().optional().default(true),
});

/**
 * Update course schema
 */
export const updateCourseSchema = z.object({
  name: nonEmptyStringSchema.optional(),
  description: z.string().optional().nullable(),
  targetAudience: z.string().optional().nullable(),
  category: createEnumSchema(courseCategoryValues).optional(),
  isActive: z.boolean().optional(),
});

// Export types
export type CourseQuery = z.infer<typeof courseQuerySchema>;
export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;
