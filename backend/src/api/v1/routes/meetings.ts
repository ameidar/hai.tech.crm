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
} from '../validators/meetings.js';

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

export { router as meetingsRouter };
