import { Router } from 'express';
import { coursesController } from '../controllers/courses.controller.js';
import { authenticate, adminOnly } from '../middleware/auth.js';
import { validate, validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import { idParamSchema } from '../validators/common.js';
import { courseQuerySchema, createCourseSchema, updateCourseSchema } from '../validators/courses.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /courses
 * List all courses with pagination and filters
 */
router.get('/', validateQuery(courseQuerySchema), (req, res, next) => {
  coursesController.list(req, res, next);
});

/**
 * GET /courses/:id
 * Get single course by ID
 */
router.get('/:id', validateParams(idParamSchema), (req, res, next) => {
  coursesController.getById(req, res, next);
});

/**
 * POST /courses
 * Create new course (admin only)
 */
router.post('/', adminOnly, validateBody(createCourseSchema), (req, res, next) => {
  coursesController.create(req, res, next);
});

/**
 * PUT /courses/:id
 * Update course (admin only)
 */
router.put(
  '/:id',
  adminOnly,
  validate({ params: idParamSchema, body: updateCourseSchema }),
  (req, res, next) => {
    coursesController.update(req, res, next);
  }
);

/**
 * DELETE /courses/:id
 * Delete course (admin only)
 */
router.delete('/:id', adminOnly, validateParams(idParamSchema), (req, res, next) => {
  coursesController.delete(req, res, next);
});

/**
 * GET /courses/:id/cycles
 * Get cycles of a course
 */
router.get('/:id/cycles', validateParams(idParamSchema), (req, res, next) => {
  coursesController.getCycles(req, res, next);
});

export { router as coursesRouter };
