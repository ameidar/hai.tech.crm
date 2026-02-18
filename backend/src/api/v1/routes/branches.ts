import { Router } from 'express';
import { branchesController } from '../controllers/branches.controller.js';
import { authenticate, adminOnly, managerOrAdmin } from '../middleware/auth.js';
import { validate, validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import { idParamSchema } from '../validators/common.js';
import { branchQuerySchema, createBranchSchema, updateBranchSchema } from '../validators/branches.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /branches
 * List all branches with pagination and filters
 */
router.get('/', validateQuery(branchQuerySchema), (req, res, next) => {
  branchesController.list(req, res, next);
});

/**
 * GET /branches/:id
 * Get single branch by ID
 */
router.get('/:id', validateParams(idParamSchema), (req, res, next) => {
  branchesController.getById(req, res, next);
});

/**
 * POST /branches
 * Create new branch (admin only)
 */
router.post('/', adminOnly, validateBody(createBranchSchema), (req, res, next) => {
  branchesController.create(req, res, next);
});

/**
 * PUT /branches/:id
 * Update branch (manager or admin)
 */
router.put(
  '/:id',
  managerOrAdmin,
  validate({ params: idParamSchema, body: updateBranchSchema }),
  (req, res, next) => {
    branchesController.update(req, res, next);
  }
);

/**
 * DELETE /branches/:id
 * Delete branch (admin only)
 */
router.delete('/:id', adminOnly, validateParams(idParamSchema), (req, res, next) => {
  branchesController.delete(req, res, next);
});

/**
 * GET /branches/:id/cycles
 * Get cycles in a branch
 */
router.get('/:id/cycles', validateParams(idParamSchema), (req, res, next) => {
  branchesController.getCycles(req, res, next);
});

export { router as branchesRouter };
