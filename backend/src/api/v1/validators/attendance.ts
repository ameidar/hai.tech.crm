import { z } from 'zod';
import {
  paginationSchema,
  sortingSchema,
  uuidSchema,
} from './common.js';

/**
 * Attendance status enum
 */
export const attendanceStatusEnum = z.enum(['present', 'absent', 'late']);

/**
 * Attendance query parameters
 */
export const attendanceQuerySchema = paginationSchema
  .merge(sortingSchema)
  .extend({
    meetingId: uuidSchema.optional(),
    studentId: uuidSchema.optional(),
    registrationId: uuidSchema.optional(),
    status: attendanceStatusEnum.optional(),
    isTrial: z
      .string()
      .optional()
      .transform((val) => (val === 'true' ? true : val === 'false' ? false : undefined)),
    from: z.string().optional().transform((val) => (val ? new Date(val) : undefined)),
    to: z.string().optional().transform((val) => (val ? new Date(val) : undefined)),
  });

/**
 * Create attendance schema
 */
export const createAttendanceSchema = z.object({
  meetingId: uuidSchema,
  registrationId: uuidSchema.optional(),
  studentId: uuidSchema.optional(),
  guestName: z.string().optional(),
  status: attendanceStatusEnum,
  isTrial: z.boolean().optional().default(false),
  notes: z.string().optional(),
}).refine(
  (data) => data.registrationId || data.studentId || data.guestName,
  {
    message: 'Either registrationId, studentId, or guestName must be provided',
  }
);

/**
 * Update attendance schema
 */
export const updateAttendanceSchema = z.object({
  status: attendanceStatusEnum.optional(),
  isTrial: z.boolean().optional(),
  notes: z.string().optional().nullable(),
});

/**
 * Bulk attendance record schema
 */
export const bulkAttendanceRecordSchema = z.object({
  registrationId: uuidSchema.optional(),
  studentId: uuidSchema.optional(),
  guestName: z.string().optional(),
  status: attendanceStatusEnum,
  isTrial: z.boolean().optional().default(false),
  notes: z.string().optional(),
});

/**
 * Bulk create/update attendance schema
 */
export const bulkAttendanceSchema = z.object({
  meetingId: uuidSchema,
  records: z.array(bulkAttendanceRecordSchema).min(1),
});

// Export types
export type AttendanceQuery = z.infer<typeof attendanceQuerySchema>;
export type CreateAttendanceInput = z.infer<typeof createAttendanceSchema>;
export type UpdateAttendanceInput = z.infer<typeof updateAttendanceSchema>;
export type BulkAttendanceInput = z.infer<typeof bulkAttendanceSchema>;
