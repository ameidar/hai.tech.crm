import { z } from 'zod';

/**
 * Date range filter - common for all reports
 */
export const dateRangeSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
});

/**
 * Revenue report query params
 */
export const revenueReportSchema = dateRangeSchema.extend({
  groupBy: z.enum(['day', 'week', 'month', 'branch', 'course', 'instructor']).default('month'),
  branchId: z.string().uuid().optional(),
  courseId: z.string().uuid().optional(),
  instructorId: z.string().uuid().optional(),
});

export type RevenueReportParams = z.infer<typeof revenueReportSchema>;

/**
 * Instructor payments report query params
 */
export const instructorPaymentsSchema = dateRangeSchema.extend({
  instructorId: z.string().uuid().optional(),
  status: z.enum(['all', 'completed', 'pending']).default('completed'),
});

export type InstructorPaymentsParams = z.infer<typeof instructorPaymentsSchema>;

/**
 * Attendance summary report query params
 */
export const attendanceSummarySchema = dateRangeSchema.extend({
  cycleId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  groupBy: z.enum(['cycle', 'student', 'branch']).default('cycle'),
});

export type AttendanceSummaryParams = z.infer<typeof attendanceSummarySchema>;

/**
 * Cycle progress report query params
 */
export const cycleProgressSchema = z.object({
  status: z.enum(['active', 'completed', 'all']).default('active'),
  branchId: z.string().uuid().optional(),
  instructorId: z.string().uuid().optional(),
});

export type CycleProgressParams = z.infer<typeof cycleProgressSchema>;

/**
 * Export format
 */
export const exportFormatSchema = z.object({
  format: z.enum(['csv', 'json']).default('csv'),
});

export type ExportFormat = z.infer<typeof exportFormatSchema>;
