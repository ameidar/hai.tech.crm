import { Router } from 'express';
import { cyclesController } from '../controllers/cycles.controller.js';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { validate, validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import { idParamSchema } from '../validators/common.js';
import { requireScopeOrRole } from '../middleware/scope-check.js';
import { opsIdParamSchema } from '../validators/ops.js';
import { sendCreated, sendSuccess } from '../../../common/utils/response.js';
import { createCycle, updateCycle } from '../../../services/cycle-admin.service.js';
import {
  cycleQuerySchema,
  createCycleRegistrationSchema,
  duplicateCycleSchema,
  bulkUpdateCyclesSchema,
} from '../validators/cycles.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

const CYCLE_WRITE_ROLES = ['admin', 'manager', 'operations_manager'] as const; // internal: operationsManagerOrAdmin

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
 * Create new cycle. Same logic as the CRM UI (services/cycle-admin.service.ts):
 * internal createCycleSchema validation (branch required; institutional types require
 * institutionalOrderId), automatic endDate (holiday-aware) and meeting generation
 * (except trial_private), audit.
 * API key: write:cycles. JWT: admin / manager / operations_manager.
 */
router.post('/', requireScopeOrRole('write:cycles', CYCLE_WRITE_ROLES), async (req, res, next) => {
  try {
    sendCreated(res, await createCycle(req.body, req));
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /cycles/:id
 * Update cycle. Same logic as the CRM UI: remainingMeetings recalculation on
 * totalMeetings/completedMeetings/status, institutional-order guard, cancellation of future
 * meetings when status→cancelled, instructor payment recalculation, optional
 * `regenerateMeetings: true` to rebuild the open schedule, audit.
 * API key: write:cycles. JWT: admin / manager / operations_manager.
 */
router.put(
  '/:id',
  requireScopeOrRole('write:cycles', CYCLE_WRITE_ROLES),
  validateParams(opsIdParamSchema),
  async (req, res, next) => {
    try {
      sendSuccess(res, await updateCycle(req.params.id, req.body, req));
    } catch (error) {
      next(error);
    }
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
