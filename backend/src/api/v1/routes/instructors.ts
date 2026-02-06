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

export { router as instructorsRouter };
