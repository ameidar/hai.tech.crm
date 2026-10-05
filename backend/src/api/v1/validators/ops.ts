import { z } from 'zod';

/**
 * Validators for the ops/admin v1 endpoints (v1.62.0).
 * Body validation is done by the shared CRM services (same zod schemas as the UI routes);
 * these only cover v1-specific params and query strings.
 */

/** Lenient id: UUIDs and Fireberry-imported CUIDs both occur in this database. */
export const anyIdSchema = z.string().trim().min(1).max(64);

export const opsIdParamSchema = z.object({ id: anyIdSchema });

export const fixedAdditionParamsSchema = z.object({
  id: anyIdSchema,
  additionId: anyIdSchema,
});

const booleanString = z.enum(['true', 'false']).optional();

const pageQuery = {
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
};

export const institutionalOrderQuerySchema = z.object({
  ...pageQuery,
  status: z.enum(['draft', 'active', 'completed', 'cancelled']).optional(),
  search: z.string().trim().max(200).optional(),
  withCycles: booleanString,
  withRelevantCycles: booleanString,
  forBilling: booleanString,
});

export const payingBodyQuerySchema = z.object({
  ...pageQuery,
  q: z.string().trim().max(200).optional(),
  incomplete: booleanString,
});

/**
 * PUT /bot-config. knowledgeBase may be sent as a JSON string (exactly what is stored) or
 * as an object (serialized with 2-space indentation). At least one field is required.
 */
export const updateBotConfigSchema = z
  .object({
    systemPrompt: z.string().min(1, 'systemPrompt cannot be empty').optional(),
    knowledgeBase: z
      .union([z.string(), z.record(z.string(), z.unknown())])
      .optional()
      .transform((v) => (v === undefined || typeof v === 'string' ? v : JSON.stringify(v, null, 2))),
  })
  .strict()
  .refine((d) => d.systemPrompt !== undefined || d.knowledgeBase !== undefined, {
    message: 'Provide systemPrompt and/or knowledgeBase',
  });

export const salaryReportQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be YYYY-MM')
    .optional(),
});

const meetingStatusEnum = z.enum(['scheduled', 'completed', 'cancelled', 'postponed']);

/**
 * Selects meetings either by explicit ids, or by cycle (+ optional status/date filters).
 * Exactly one of `ids` / `cycleId` must be given.
 */
const meetingSelector = {
  ids: z.array(anyIdSchema).min(1).max(1000).optional(),
  cycleId: anyIdSchema.optional(),
  statuses: z.array(meetingStatusEnum).min(1).optional(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fromDate must be YYYY-MM-DD').optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'toDate must be YYYY-MM-DD').optional(),
};

const exactlyOneSelector = (d: { ids?: string[]; cycleId?: string; statuses?: unknown; fromDate?: unknown; toDate?: unknown }) =>
  (d.ids ? 1 : 0) + (d.cycleId ? 1 : 0) === 1 && Boolean(d.cycleId || (!d.statuses && !d.fromDate && !d.toDate));
const selectorError = {
  message: 'Provide exactly one of `ids` or `cycleId` (statuses/fromDate/toDate only apply with cycleId)',
};

export const v1BulkUpdateMeetingsSchema = z
  .object({
    ...meetingSelector,
    data: z
      .object({
        status: meetingStatusEnum.optional(),
        activityType: z.enum(['online', 'frontal', 'private_lesson']).optional(),
        topic: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
        scheduledDate: z.string().optional(),
        startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format').optional(),
        endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format').optional(),
        instructorId: anyIdSchema.optional(),
        registrationId: anyIdSchema.nullable().optional(),
        revenue: z.number().nonnegative().optional(),
        instructorPayment: z.number().nonnegative().optional(),
      })
      .strict()
      .refine((d) => Object.keys(d).length > 0, { message: 'data must contain at least one field' }),
  })
  .refine(exactlyOneSelector, selectorError);

export const v1BulkRecalculateMeetingsSchema = z
  .object({
    ...meetingSelector,
    force: z.boolean().optional().default(false),
  })
  .refine(exactlyOneSelector, selectorError);

export const v1BulkUpdateMeetingStatusSchema = z.object({
  ids: z.array(anyIdSchema).min(1).max(1000),
  status: meetingStatusEnum,
});

export const v1BulkDeleteMeetingsSchema = z.object({
  ids: z.array(anyIdSchema).min(1).max(1000),
});

export type V1MeetingSelector = {
  ids?: string[];
  cycleId?: string;
  statuses?: Array<z.infer<typeof meetingStatusEnum>>;
  fromDate?: string;
  toDate?: string;
};
