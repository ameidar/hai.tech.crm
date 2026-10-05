import { Router } from 'express';
import { meetingsController } from '../controllers/meetings.controller.js';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { requireScope } from '../middleware/scope-check.js';
import { validate, validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import { idParamSchema } from '../validators/common.js';
import {
  meetingQuerySchema,
  createMeetingSchema,
  updateMeetingSchema,
  postponeMeetingSchema,
  completeMeetingSchema,
  cancelMeetingSchema,
} from '../validators/meetings.js';
import { requireScopeOrRole } from '../middleware/scope-check.js';
import {
  v1BulkUpdateMeetingsSchema,
  v1BulkRecalculateMeetingsSchema,
  v1BulkUpdateMeetingStatusSchema,
  v1BulkDeleteMeetingsSchema,
  type V1MeetingSelector,
} from '../validators/ops.js';
import { sendSuccess } from '../../../common/utils/response.js';
import { NotFoundError, ValidationError } from '../../../common/errors/index.js';
import { prisma } from '../../../utils/prisma.js';
import {
  bulkUpdateMeetings,
  bulkRecalculateMeetings,
  bulkUpdateMeetingStatus,
  bulkDeleteMeetings,
} from '../../../services/meeting-bulk.service.js';
import { bulkAttendanceSchema } from '../validators/attendance.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /meetings
 * List all meetings with pagination and filters
 */
router.get('/', requireScope('read:meetings'), validateQuery(meetingQuerySchema), (req, res, next) => {
  meetingsController.list(req, res, next);
});

/**
 * GET /meetings/:id
 * Get single meeting by ID with full details
 */
router.get('/:id', requireScope('read:meetings'), validateParams(idParamSchema), (req, res, next) => {
  meetingsController.getById(req, res, next);
});

/**
 * POST /meetings
 * Create new meeting (manager or admin only)
 */
router.post('/', requireScope('write:meetings'), managerOrAdmin, validateBody(createMeetingSchema), (req, res, next) => {
  meetingsController.create(req, res, next);
});

/**
 * PUT /meetings/:id
 * Update meeting (manager or admin only, or instructor on same day)
 */
router.put(
  '/:id',
  validate({ params: idParamSchema, body: updateMeetingSchema }),
  (req, res, next) => {
    meetingsController.update(req, res, next);
  }
);

/**
 * DELETE /meetings/:id
 * Soft delete meeting (manager or admin only)
 */
router.delete('/:id', managerOrAdmin, validateParams(idParamSchema), (req, res, next) => {
  meetingsController.delete(req, res, next);
});

/**
 * GET /meetings/:id/attendance
 * Get attendance of a meeting
 */
router.get('/:id/attendance', validateParams(idParamSchema), (req, res, next) => {
  meetingsController.getAttendance(req, res, next);
});

/**
 * POST /meetings/:id/postpone
 * Postpone meeting to new date (manager or admin only)
 */
router.post(
  '/:id/postpone',
  managerOrAdmin,
  validate({ params: idParamSchema, body: postponeMeetingSchema }),
  (req, res, next) => {
    meetingsController.postpone(req, res, next);
  }
);

/**
 * POST /meetings/:id/complete
 * Mark meeting as completed (manager, admin, or instructor)
 */
router.post(
  '/:id/complete',
  validate({ params: idParamSchema, body: completeMeetingSchema }),
  (req, res, next) => {
    meetingsController.complete(req, res, next);
  }
);

/**
 * POST /meetings/:id/cancel
 * Cancel a meeting (manager or admin only)
 */
router.post(
  '/:id/cancel',
  managerOrAdmin,
  validate({ params: idParamSchema, body: cancelMeetingSchema }),
  (req, res, next) => {
    meetingsController.cancel(req, res, next);
  }
);

/**
 * POST /meetings/:id/recalculate
 * Recalculate meeting financials (manager or admin only)
 */
router.post(
  '/:id/recalculate',
  managerOrAdmin,
  validateParams(idParamSchema),
  (req, res, next) => {
    meetingsController.recalculate(req, res, next);
  }
);

/**
 * POST /meetings/:id/attendance/bulk
 * Bulk record attendance for a meeting
 */
router.post(
  '/:id/attendance/bulk',
  validate({ params: idParamSchema, body: bulkAttendanceSchema }),
  (req, res, next) => {
    meetingsController.bulkRecordAttendance(req, res, next);
  }
);

// =============================================================================
// Bulk operations — same logic as the CRM UI's /api/meetings/bulk-* routes
// (services/meeting-bulk.service.ts): revenue/instructor-payment recalculation, cycle
// counters, billing locks, replacement meetings for postponed, audit per meeting.
// API key: write:meetings. JWT: admin / manager / operations_manager.
// =============================================================================

const BULK_ROLES = ['admin', 'manager', 'operations_manager'] as const; // internal: operationsManagerOrAdmin
const MAX_SELECTED_MEETINGS = 1000;

/** Resolve `ids` or `cycleId` (+ statuses/fromDate/toDate) into meeting ids. */
async function resolveMeetingIds(selector: V1MeetingSelector): Promise<string[]> {
  if (selector.ids) return selector.ids;
  const cycle = await prisma.cycle.findFirst({ where: { id: selector.cycleId!, deletedAt: null }, select: { id: true } });
  if (!cycle) throw new NotFoundError('Cycle', selector.cycleId);
  const meetings = await prisma.meeting.findMany({
    where: {
      cycleId: selector.cycleId!,
      deletedAt: null,
      ...(selector.statuses && { status: { in: selector.statuses } }),
      ...((selector.fromDate || selector.toDate) && {
        scheduledDate: {
          ...(selector.fromDate && { gte: new Date(`${selector.fromDate}T00:00:00.000Z`) }),
          ...(selector.toDate && { lte: new Date(`${selector.toDate}T00:00:00.000Z`) }),
        },
      }),
    },
    select: { id: true },
    orderBy: { scheduledDate: 'asc' },
    take: MAX_SELECTED_MEETINGS + 1,
  });
  if (meetings.length > MAX_SELECTED_MEETINGS) {
    throw new ValidationError(`Selector matches more than ${MAX_SELECTED_MEETINGS} meetings — narrow it down`);
  }
  return meetings.map((m) => m.id);
}

/**
 * POST /meetings/bulk-update
 * Body: { ids: [...] } or { cycleId, statuses?, fromDate?, toDate? } plus
 * data: { status?, activityType?, topic?, notes?, scheduledDate?, startTime?, endTime?,
 *         instructorId?, registrationId?, revenue?, instructorPayment? }
 * revenue/instructorPayment set a manual amount (profit = revenue − instructorPayment −
 * approved expenses); refused on meetings in an invoiced billing period; cannot be combined
 * with a status change.
 */
router.post(
  '/bulk-update',
  requireScopeOrRole('write:meetings', BULK_ROLES),
  validateBody(v1BulkUpdateMeetingsSchema),
  async (req, res, next) => {
    try {
      const ids = await resolveMeetingIds(req.body);
      if (ids.length === 0) return sendSuccess(res, { success: true, updated: 0, matched: 0 });
      const result = await bulkUpdateMeetings({ ids, data: req.body.data }, req);
      sendSuccess(res, { ...result, matched: ids.length });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /meetings/bulk-recalculate
 * Recalculate revenue / instructor payment / profit of COMPLETED meetings from the cycle.
 * Body: { ids } or { cycleId, ... }, force?: boolean (recalculate even if revenue > 0).
 */
router.post(
  '/bulk-recalculate',
  requireScopeOrRole('write:meetings', BULK_ROLES),
  validateBody(v1BulkRecalculateMeetingsSchema),
  async (req, res, next) => {
    try {
      const ids = await resolveMeetingIds(req.body);
      if (ids.length === 0) return sendSuccess(res, { success: true, recalculated: 0, skipped: 0, matched: 0 });
      const result = await bulkRecalculateMeetings({ ids, force: req.body.force }, req);
      sendSuccess(res, { ...result, matched: ids.length });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /meetings/bulk-update-status
 * Body: { ids, status }. Completion computes financials + cycle counters; postponed creates a
 * replacement meeting; postponed/cancelled zero the amounts.
 */
router.post(
  '/bulk-update-status',
  requireScopeOrRole('write:meetings', BULK_ROLES),
  validateBody(v1BulkUpdateMeetingStatusSchema),
  async (req, res, next) => {
    try {
      sendSuccess(res, await bulkUpdateMeetingStatus(req.body, req));
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /meetings/bulk-delete
 * Body: { ids }. Hard delete, identical to the CRM UI: refused (423) for meetings in an
 * invoiced billing period; fixes cycle counters; removes Google Meet events.
 */
router.post(
  '/bulk-delete',
  requireScopeOrRole('write:meetings', BULK_ROLES),
  validateBody(v1BulkDeleteMeetingsSchema),
  async (req, res, next) => {
    try {
      sendSuccess(res, await bulkDeleteMeetings(req.body, req));
    } catch (error) {
      next(error);
    }
  }
);

export { router as meetingsRouter };
