import { Router } from 'express';
import { meetingsController } from '../controllers/meetings.controller.js';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { validate, validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import { idParamSchema } from '../validators/common.js';
import {
  meetingQuerySchema,
  createMeetingSchema,
  updateMeetingSchema,
  postponeMeetingSchema,
  completeMeetingSchema,
  cancelMeetingSchema,
  bulkRecalculateMeetingsSchema,
  bulkUpdateMeetingStatusSchema,
  bulkDeleteMeetingsSchema,
} from '../validators/meetings.js';
import { bulkAttendanceSchema } from '../validators/attendance.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /meetings
 * List all meetings with pagination and filters
 */
router.get('/', validateQuery(meetingQuerySchema), (req, res, next) => {
  meetingsController.list(req, res, next);
});

/**
 * GET /meetings/:id
 * Get single meeting by ID with full details
 */
router.get('/:id', validateParams(idParamSchema), (req, res, next) => {
  meetingsController.getById(req, res, next);
});

/**
 * POST /meetings
 * Create new meeting (manager or admin only)
 */
router.post('/', managerOrAdmin, validateBody(createMeetingSchema), (req, res, next) => {
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

/**
 * POST /meetings/bulk-recalculate
 * Bulk recalculate meetings (manager or admin only)
 */
router.post(
  '/bulk-recalculate',
  managerOrAdmin,
  validateBody(bulkRecalculateMeetingsSchema),
  (req, res, next) => {
    meetingsController.bulkRecalculate(req, res, next);
  }
);

/**
 * POST /meetings/bulk-update-status
 * Bulk update meeting status (manager or admin only)
 */
router.post(
  '/bulk-update-status',
  managerOrAdmin,
  validateBody(bulkUpdateMeetingStatusSchema),
  (req, res, next) => {
    meetingsController.bulkUpdateStatus(req, res, next);
  }
);

/**
 * POST /meetings/bulk-delete
 * Bulk delete meetings (manager or admin only)
 */
router.post(
  '/bulk-delete',
  managerOrAdmin,
  validateBody(bulkDeleteMeetingsSchema),
  (req, res, next) => {
    meetingsController.bulkDelete(req, res, next);
  }
);

export { router as meetingsRouter };
