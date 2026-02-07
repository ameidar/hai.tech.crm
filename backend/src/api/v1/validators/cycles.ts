import { z } from 'zod';
import {
  paginationSchema,
  sortingSchema,
  searchSchema,
  uuidSchema,
  nonEmptyStringSchema,
} from './common.js';

/**
 * Cycle type enum
 */
export const cycleTypeEnum = z.enum(['private', 'institutional_per_child', 'institutional_fixed']);

/**
 * Cycle status enum
 */
export const cycleStatusEnum = z.enum(['active', 'completed', 'cancelled']);

/**
 * Day of week enum
 */
export const dayOfWeekEnum = z.enum([
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
]);

/**
 * Activity type enum
 */
export const activityTypeEnum = z.enum(['online', 'frontal', 'private_lesson']);

/**
 * Time string schema (HH:MM format)
 */
export const timeStringSchema = z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, {
  message: 'Invalid time format. Use HH:MM (e.g., 14:30)',
});

/**
 * Cycle query parameters
 */
export const cycleQuerySchema = paginationSchema
  .merge(sortingSchema)
  .merge(searchSchema)
  .extend({
    from: z.string().optional().transform((val) => (val ? new Date(val) : undefined)),
    to: z.string().optional().transform((val) => (val ? new Date(val) : undefined)),
    courseId: uuidSchema.optional(),
    branchId: uuidSchema.optional(),
    instructorId: uuidSchema.optional(),
    institutionalOrderId: uuidSchema.optional(),
    type: cycleTypeEnum.optional(),
    status: cycleStatusEnum.optional(),
    dayOfWeek: dayOfWeekEnum.optional(),
    activityType: activityTypeEnum.optional(),
    isOnline: z
      .string()
      .optional()
      .transform((val) => (val === 'true' ? true : val === 'false' ? false : undefined)),
  });

/**
 * Create cycle schema
 */
export const createCycleSchema = z.object({
  name: nonEmptyStringSchema,
  courseId: uuidSchema,
  branchId: uuidSchema,
  instructorId: uuidSchema,
  institutionalOrderId: uuidSchema.optional(),
  type: cycleTypeEnum,
  startDate: z.string().transform((val) => new Date(val)),
  endDate: z.string().optional().transform((val) => (val ? new Date(val) : undefined)),
  dayOfWeek: dayOfWeekEnum,
  startTime: timeStringSchema,
  endTime: timeStringSchema,
  durationMinutes: z.number().int().positive(),
  totalMeetings: z.number().int().positive(),
  pricePerStudent: z.number().nonnegative().optional(),
  meetingRevenue: z.number().nonnegative().optional(),
  studentCount: z.number().int().nonnegative().optional(),
  maxStudents: z.number().int().positive().optional(),
  sendParentReminders: z.boolean().optional().default(false),
  activityType: activityTypeEnum.optional().default('frontal'),
  zoomHostId: z.string().optional(),
  zoomHostEmail: z.string().email().optional(),
});

/**
 * Update cycle schema
 */
export const updateCycleSchema = z.object({
  name: nonEmptyStringSchema.optional(),
  courseId: uuidSchema.optional(),
  branchId: uuidSchema.optional(),
  instructorId: uuidSchema.optional(),
  institutionalOrderId: uuidSchema.optional().nullable(),
  type: cycleTypeEnum.optional(),
  startDate: z.string().optional().transform((val) => (val ? new Date(val) : undefined)),
  endDate: z.string().optional().transform((val) => (val ? new Date(val) : undefined)),
  dayOfWeek: dayOfWeekEnum.optional(),
  startTime: timeStringSchema.optional(),
  endTime: timeStringSchema.optional(),
  durationMinutes: z.number().int().positive().optional(),
  totalMeetings: z.number().int().positive().optional(),
  completedMeetings: z.number().int().nonnegative().optional(),
  pricePerStudent: z.number().nonnegative().optional().nullable(),
  meetingRevenue: z.number().nonnegative().optional().nullable(),
  studentCount: z.number().int().nonnegative().optional().nullable(),
  maxStudents: z.number().int().positive().optional().nullable(),
  sendParentReminders: z.boolean().optional(),
  activityType: activityTypeEnum.optional(),
  status: cycleStatusEnum.optional(),
  zoomHostId: z.string().optional().nullable(),
  zoomHostEmail: z.string().email().optional().nullable(),
  zoomMeetingId: z.string().optional().nullable(),
  zoomJoinUrl: z.string().url().optional().nullable(),
  zoomHostKey: z.string().optional().nullable(),
  zoomPassword: z.string().optional().nullable(),
});

/**
 * Create registration for cycle schema
 */
export const createCycleRegistrationSchema = z.object({
  studentId: uuidSchema,
  registrationDate: z.string().optional().transform((val) => (val ? new Date(val) : new Date())),
  status: z.enum(['registered', 'active', 'completed', 'cancelled', 'trial']).optional().default('registered'),
  amount: z.number().nonnegative().optional(),
  paymentStatus: z.enum(['unpaid', 'partial', 'paid']).optional(),
  paymentMethod: z.enum(['credit', 'transfer', 'cash']).optional(),
  invoiceLink: z.string().url().optional(),
  notes: z.string().optional(),
});

/**
 * Duplicate cycle schema
 */
export const duplicateCycleSchema = z.object({
  newStartDate: z.string().transform((val) => new Date(val)),
  newName: z.string().optional(),
  copyRegistrations: z.boolean().optional().default(false),
  generateMeetings: z.boolean().optional().default(true),
});

/**
 * Bulk update cycles schema
 */
export const bulkUpdateCyclesSchema = z.object({
  ids: z.array(uuidSchema).min(1),
  data: z.object({
    status: cycleStatusEnum.optional(),
    instructorId: uuidSchema.optional(),
    courseId: uuidSchema.optional(),
    branchId: uuidSchema.optional(),
    meetingRevenue: z.number().nonnegative().optional(),
    pricePerStudent: z.number().nonnegative().optional(),
    studentCount: z.number().int().nonnegative().optional(),
    sendParentReminders: z.boolean().optional(),
    activityType: activityTypeEnum.optional(),
  }),
});

// Export types
export type CycleQuery = z.infer<typeof cycleQuerySchema>;
export type CreateCycleInput = z.infer<typeof createCycleSchema>;
export type UpdateCycleInput = z.infer<typeof updateCycleSchema>;
export type CreateCycleRegistrationInput = z.infer<typeof createCycleRegistrationSchema>;
export type DuplicateCycleInput = z.infer<typeof duplicateCycleSchema>;
export type BulkUpdateCyclesInput = z.infer<typeof bulkUpdateCyclesSchema>;
