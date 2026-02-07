import { Router } from 'express';
import { attendanceController } from '../controllers/attendance.controller.js';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { validate, validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import { idParamSchema } from '../validators/common.js';
import {
  attendanceQuerySchema,
  createAttendanceSchema,
  updateAttendanceSchema,
  bulkAttendanceSchema,
} from '../validators/attendance.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /attendance
 * List all attendance records with pagination and filters
 */
router.get('/', validateQuery(attendanceQuerySchema), (req, res, next) => {
  attendanceController.list(req, res, next);
});

/**
 * GET /attendance/:id
 * Get single attendance record by ID
 */
router.get('/:id', validateParams(idParamSchema), (req, res, next) => {
  attendanceController.getById(req, res, next);
});

/**
 * POST /attendance
 * Create attendance record (manager, admin, or instructor)
 */
router.post('/', validateBody(createAttendanceSchema), (req, res, next) => {
  attendanceController.create(req, res, next);
});

/**
 * PUT /attendance/:id
 * Update attendance record (manager, admin, or instructor)
 */
router.put(
  '/:id',
  validate({ params: idParamSchema, body: updateAttendanceSchema }),
  (req, res, next) => {
    attendanceController.update(req, res, next);
  }
);

/**
 * DELETE /attendance/:id
 * Delete attendance record (manager or admin only)
 */
router.delete('/:id', managerOrAdmin, validateParams(idParamSchema), (req, res, next) => {
  attendanceController.delete(req, res, next);
});

/**
 * POST /attendance/bulk
 * Bulk create/update attendance records (manager, admin, or instructor)
 */
router.post('/bulk', validateBody(bulkAttendanceSchema), (req, res, next) => {
  attendanceController.bulkUpdate(req, res, next);
});

export { router as attendanceRouter };
