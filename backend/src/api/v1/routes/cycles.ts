import { Router } from 'express';
import { cyclesController } from '../controllers/cycles.controller.js';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { validate, validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import { idParamSchema } from '../validators/common.js';
import {
  cycleQuerySchema,
  createCycleSchema,
  updateCycleSchema,
  createCycleRegistrationSchema,
  duplicateCycleSchema,
  bulkUpdateCyclesSchema,
} from '../validators/cycles.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /cycles
 * List all cycles with pagination and filters
 */
router.get('/', validateQuery(cycleQuerySchema), (req, res, next) => {
  cyclesController.list(req, res, next);
});

/**
 * GET /cycles/:id
 * Get single cycle by ID with full details
 */
router.get('/:id', validateParams(idParamSchema), (req, res, next) => {
  cyclesController.getById(req, res, next);
});

/**
 * POST /cycles
 * Create new cycle (manager or admin only)
 */
router.post('/', managerOrAdmin, validateBody(createCycleSchema), (req, res, next) => {
  cyclesController.create(req, res, next);
});

/**
 * PUT /cycles/:id
 * Update cycle (manager or admin only)
 */
router.put(
  '/:id',
  managerOrAdmin,
  validate({ params: idParamSchema, body: updateCycleSchema }),
  (req, res, next) => {
    cyclesController.update(req, res, next);
  }
);

/**
 * DELETE /cycles/:id
 * Soft delete cycle (manager or admin only)
 */
router.delete('/:id', managerOrAdmin, validateParams(idParamSchema), (req, res, next) => {
  cyclesController.delete(req, res, next);
});

/**
 * GET /cycles/:id/meetings
 * Get meetings of a cycle
 */
router.get('/:id/meetings', validateParams(idParamSchema), (req, res, next) => {
  cyclesController.getMeetings(req, res, next);
});

/**
 * GET /cycles/:id/registrations
 * Get registrations of a cycle
 */
router.get('/:id/registrations', validateParams(idParamSchema), (req, res, next) => {
  cyclesController.getRegistrations(req, res, next);
});

/**
 * POST /cycles/:id/registrations
 * Add registration to cycle (manager or admin only)
 */
router.post(
  '/:id/registrations',
  managerOrAdmin,
  validate({ params: idParamSchema, body: createCycleRegistrationSchema }),
  (req, res, next) => {
    cyclesController.addRegistration(req, res, next);
  }
);

/**
 * POST /cycles/:id/generate-meetings
 * Generate meetings for a cycle (manager or admin only)
 */
router.post(
  '/:id/generate-meetings',
  managerOrAdmin,
  validateParams(idParamSchema),
  (req, res, next) => {
    cyclesController.generateMeetings(req, res, next);
  }
);

/**
 * POST /cycles/:id/sync-progress
 * Sync cycle progress from meetings table (manager or admin only)
 */
router.post(
  '/:id/sync-progress',
  managerOrAdmin,
  validateParams(idParamSchema),
  (req, res, next) => {
    cyclesController.syncProgress(req, res, next);
  }
);

/**
 * POST /cycles/:id/duplicate
 * Duplicate a cycle with new start date (manager or admin only)
 */
router.post(
  '/:id/duplicate',
  managerOrAdmin,
  validate({ params: idParamSchema, body: duplicateCycleSchema }),
  (req, res, next) => {
    cyclesController.duplicate(req, res, next);
  }
);

/**
 * POST /cycles/bulk-update
 * Bulk update multiple cycles (admin only)
 */
router.post(
  '/bulk-update',
  managerOrAdmin,
  validateBody(bulkUpdateCyclesSchema),
  (req, res, next) => {
    cyclesController.bulkUpdate(req, res, next);
  }
);

export { router as cyclesRouter };
