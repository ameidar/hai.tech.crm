import { z } from 'zod';

/**
 * UUID schema - validates UUIDv4 format
 */
export const uuidSchema = z.string().uuid('Invalid UUID format');

/**
 * ID parameter schema for route params
 */
export const idParamSchema = z.object({
  id: uuidSchema,
});

/**
 * Pagination query parameters
 */
export const paginationSchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 20))
    .refine((val) => val >= 1 && val <= 100, {
      message: 'Limit must be between 1 and 100',
    }),
  offset: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 0))
    .refine((val) => val >= 0, {
      message: 'Offset must be non-negative',
    }),
});

/**
 * Cursor-based pagination (alternative)
 */
export const cursorPaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 20))
    .refine((val) => val >= 1 && val <= 100, {
      message: 'Limit must be between 1 and 100',
    }),
});

/**
 * Sorting parameters
 */
export const sortingSchema = z.object({
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional().default('asc'),
});

/**
 * Date range filter
 */
export const dateRangeSchema = z
  .object({
    from: z
      .string()
      .optional()
      .refine((val) => !val || !isNaN(Date.parse(val)), {
        message: 'Invalid from date format',
      })
      .transform((val) => (val ? new Date(val) : undefined)),
    to: z
      .string()
      .optional()
      .refine((val) => !val || !isNaN(Date.parse(val)), {
        message: 'Invalid to date format',
      })
      .transform((val) => (val ? new Date(val) : undefined)),
  })
  .refine(
    (data) => {
      if (data.from && data.to) {
        return data.from <= data.to;
      }
      return true;
    },
    {
      message: 'from date must be before or equal to to date',
    }
  );

/**
 * Search query parameter
 */
export const searchSchema = z.object({
  search: z
    .string()
    .optional()
    .transform((val) => val?.trim()),
  q: z
    .string()
    .optional()
    .transform((val) => val?.trim()),
});

/**
 * Common query parameters combining pagination, sorting, and search
 */
export const listQuerySchema = paginationSchema
  .merge(sortingSchema)
  .merge(searchSchema);

/**
 * Date string schema (ISO format)
 */
export const dateStringSchema = z
  .string()
  .refine((val) => !isNaN(Date.parse(val)), {
    message: 'Invalid date format. Use ISO 8601 format (e.g., 2024-01-15)',
  });

/**
 * Datetime string schema (ISO format with time)
 */
export const datetimeStringSchema = z
  .string()
  .refine((val) => !isNaN(Date.parse(val)), {
    message: 'Invalid datetime format. Use ISO 8601 format (e.g., 2024-01-15T10:30:00Z)',
  });

/**
 * Email schema
 */
export const emailSchema = z.string().email('Invalid email format');

/**
 * Phone number schema (Israeli format)
 */
export const phoneSchema = z
  .string()
  .regex(/^(\+972|0)([23489]|5[0-9]|7[0-9])[0-9]{7}$/, {
    message: 'Invalid Israeli phone number format',
  })
  .optional()
  .or(z.literal(''));

/**
 * Non-empty string
 */
export const nonEmptyStringSchema = z.string().min(1, 'This field is required');

/**
 * Positive integer
 */
export const positiveIntSchema = z.number().int().positive();

/**
 * Non-negative integer
 */
export const nonNegativeIntSchema = z.number().int().nonnegative();

/**
 * Decimal/money amount schema
 */
export const moneySchema = z.number().nonnegative().multipleOf(0.01);

/**
 * Helper to create enum schema from values
 */
export function createEnumSchema<T extends string>(values: readonly T[], message?: string) {
  return z.enum(values as [T, ...T[]], {
    errorMap: () => ({ message: message || `Must be one of: ${values.join(', ')}` }),
  });
}

/**
 * Export types
 */
export type IdParam = z.infer<typeof idParamSchema>;
export type Pagination = z.infer<typeof paginationSchema>;
export type CursorPagination = z.infer<typeof cursorPaginationSchema>;
export type Sorting = z.infer<typeof sortingSchema>;
export type DateRange = z.infer<typeof dateRangeSchema>;
export type Search = z.infer<typeof searchSchema>;
export type ListQuery = z.infer<typeof listQuerySchema>;
