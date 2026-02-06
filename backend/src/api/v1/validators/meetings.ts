import { z } from 'zod';
import {
  paginationSchema,
  sortingSchema,
  uuidSchema,
} from './common.js';
import { activityTypeEnum, timeStringSchema } from './cycles.js';

/**
 * Meeting status enum
 */
export const meetingStatusEnum = z.enum(['scheduled', 'completed', 'cancelled', 'postponed']);

/**
 * Meeting query parameters
 */
export const meetingQuerySchema = paginationSchema
  .merge(sortingSchema)
  .extend({
    cycleId: uuidSchema.optional(),
    instructorId: uuidSchema.optional(),
    branchId: uuidSchema.optional(),
    status: meetingStatusEnum.optional(),
    activityType: activityTypeEnum.optional(),
    date: z.string().optional().transform((val) => (val ? new Date(val) : undefined)),
    from: z.string().optional().transform((val) => (val ? new Date(val) : undefined)),
    to: z.string().optional().transform((val) => (val ? new Date(val) : undefined)),
  });

/**
 * Create meeting schema
 */
export const createMeetingSchema = z.object({
  cycleId: uuidSchema,
  instructorId: uuidSchema,
  scheduledDate: z.string().transform((val) => new Date(val)),
  startTime: timeStringSchema,
  endTime: timeStringSchema,
  activityType: activityTypeEnum.optional(),
  topic: z.string().optional(),
  notes: z.string().optional(),
  withZoom: z.boolean().optional().default(false),
});

/**
 * Update meeting schema
 */
export const updateMeetingSchema = z.object({
  instructorId: uuidSchema.optional(),
  scheduledDate: z.string().optional().transform((val) => (val ? new Date(val) : undefined)),
  startTime: timeStringSchema.optional(),
  endTime: timeStringSchema.optional(),
  status: meetingStatusEnum.optional(),
  activityType: activityTypeEnum.optional(),
  topic: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  revenue: z.number().nonnegative().optional(),
  instructorPayment: z.number().nonnegative().optional(),
  profit: z.number().optional(),
  zoomMeetingId: z.string().optional().nullable(),
  zoomJoinUrl: z.string().url().optional().nullable(),
  zoomStartUrl: z.string().url().optional().nullable(),
  zoomPassword: z.string().optional().nullable(),
  zoomHostKey: z.string().optional().nullable(),
  zoomHostEmail: z.string().email().optional().nullable(),
  zoomRecordingUrl: z.string().url().optional().nullable(),
  zoomRecordingPassword: z.string().optional().nullable(),
  lessonTranscript: z.string().optional().nullable(),
  lessonSummary: z.string().optional().nullable(),
});

/**
 * Postpone meeting schema
 */
export const postponeMeetingSchema = z.object({
  newDate: z.string().transform((val) => new Date(val)),
  newStartTime: timeStringSchema.optional(),
  newEndTime: timeStringSchema.optional(),
  notes: z.string().optional(),
});

/**
 * Bulk recalculate meetings schema
 */
export const bulkRecalculateMeetingsSchema = z.object({
  ids: z.array(uuidSchema).min(1),
});

/**
 * Bulk update meeting status schema
 */
export const bulkUpdateMeetingStatusSchema = z.object({
  ids: z.array(uuidSchema).min(1),
  status: meetingStatusEnum,
});

/**
 * Bulk delete meetings schema
 */
export const bulkDeleteMeetingsSchema = z.object({
  ids: z.array(uuidSchema).min(1),
});

/**
 * Complete meeting schema (optional notes)
 */
export const completeMeetingSchema = z.object({
  notes: z.string().optional(),
});

/**
 * Cancel meeting schema (optional reason)
 */
export const cancelMeetingSchema = z.object({
  reason: z.string().optional(),
});

// Export types
export type MeetingQuery = z.infer<typeof meetingQuerySchema>;
export type CreateMeetingInput = z.infer<typeof createMeetingSchema>;
export type UpdateMeetingInput = z.infer<typeof updateMeetingSchema>;
export type PostponeMeetingInput = z.infer<typeof postponeMeetingSchema>;
export type BulkRecalculateMeetingsInput = z.infer<typeof bulkRecalculateMeetingsSchema>;
export type BulkUpdateMeetingStatusInput = z.infer<typeof bulkUpdateMeetingStatusSchema>;
export type BulkDeleteMeetingsInput = z.infer<typeof bulkDeleteMeetingsSchema>;
export type CompleteMeetingInput = z.infer<typeof completeMeetingSchema>;
export type CancelMeetingInput = z.infer<typeof cancelMeetingSchema>;
