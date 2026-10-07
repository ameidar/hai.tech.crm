import { Router } from 'express';
import { instructorsController } from '../controllers/instructors.controller.js';
import { authenticate, adminOnly, managerOrAdmin } from '../middleware/auth.js';
import { validate, validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import { idParamSchema } from '../validators/common.js';
import { 
  instructorQuerySchema, 
  createInstructorSchema, 
  updateInstructorSchema,
  instructorMeetingsQuerySchema 
} from '../validators/instructors.js';
import { requireScopeOrRole } from '../middleware/scope-check.js';
import { opsIdParamSchema, fixedAdditionParamsSchema } from '../validators/ops.js';
import { sendSuccess, sendCreated, sendNoContent } from '../../../common/utils/response.js';
import {
  listFixedAdditions,
  createFixedAddition,
  updateFixedAddition,
  deleteFixedAddition,
} from '../../../services/instructor-fixed-additions.crud.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /instructors
 * List all instructors with pagination and filters
 */
router.get('/', validateQuery(instructorQuerySchema), (req, res, next) => {
  instructorsController.list(req, res, next);
});

/**
 * GET /instructors/:id
 * Get single instructor by ID
 */
router.get('/:id', validateParams(idParamSchema), (req, res, next) => {
  instructorsController.getById(req, res, next);
});

/**
 * POST /instructors
 * Create new instructor (admin only)
 */
router.post('/', adminOnly, validateBody(createInstructorSchema), (req, res, next) => {
  instructorsController.create(req, res, next);
});

/**
 * PUT /instructors/:id
 * Update instructor (manager or admin)
 */
router.put(
  '/:id',
  managerOrAdmin,
  validate({ params: idParamSchema, body: updateInstructorSchema }),
  (req, res, next) => {
    instructorsController.update(req, res, next);
  }
);

/**
 * DELETE /instructors/:id
 * Delete instructor (admin only)
 */
router.delete('/:id', adminOnly, validateParams(idParamSchema), (req, res, next) => {
  instructorsController.delete(req, res, next);
});

/**
 * GET /instructors/:id/cycles
 * Get cycles of an instructor
 */
router.get('/:id/cycles', validateParams(idParamSchema), (req, res, next) => {
  instructorsController.getCycles(req, res, next);
});

/**
 * GET /instructors/:id/meetings
 * Get meetings of an instructor
 */
router.get(
  '/:id/meetings', 
  validate({ params: idParamSchema, query: instructorMeetingsQuerySchema }), 
  (req, res, next) => {
    instructorsController.getMeetings(req, res, next);
  }
);

// =============================================================================
// Fixed monthly additions (תוספות קבועות) — v1 ops API (v1.62.0)
// Same logic as /api/instructors/:id/fixed-additions
// (services/instructor-fixed-additions.crud.ts). Months are "YYYY-MM"; endMonth inclusive.
// =============================================================================

const ADDITION_ROLES = ['admin', 'manager', 'operations_manager'] as const; // internal: operationsManagerOrAdmin

router.get(
  '/:id/fixed-additions',
  requireScopeOrRole('read:instructor_additions', ADDITION_ROLES),
  validateParams(opsIdParamSchema),
  async (req, res, next) => {
    try {
      sendSuccess(res, await listFixedAdditions(req.params.id));
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/:id/fixed-additions',
  requireScopeOrRole('write:instructor_additions', ADDITION_ROLES),
  validateParams(opsIdParamSchema),
  async (req, res, next) => {
    try {
      sendCreated(res, await createFixedAddition(req.params.id, req.body, req));
    } catch (error) {
      next(error);
    }
  }
);

router.put(
  '/:id/fixed-additions/:additionId',
  requireScopeOrRole('write:instructor_additions', ADDITION_ROLES),
  validateParams(fixedAdditionParamsSchema),
  async (req, res, next) => {
    try {
      sendSuccess(res, await updateFixedAddition(req.params.id, req.params.additionId, req.body, req));
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  '/:id/fixed-additions/:additionId',
  requireScopeOrRole('write:instructor_additions', ADDITION_ROLES),
  validateParams(fixedAdditionParamsSchema),
  async (req, res, next) => {
    try {
      await deleteFixedAddition(req.params.id, req.params.additionId, req);
      sendNoContent(res);
    } catch (error) {
      next(error);
    }
  }
);

export { router as instructorsRouter };
