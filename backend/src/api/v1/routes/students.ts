import { Router } from 'express';
import { studentsController } from '../controllers/students.controller.js';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { validate, validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import { idParamSchema } from '../validators/common.js';
import { studentQuerySchema, createStudentSchema, updateStudentSchema } from '../validators/students.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /students
 * List all students with pagination and filters
 */
router.get('/', validateQuery(studentQuerySchema), (req, res, next) => {
  studentsController.list(req, res, next);
});

/**
 * GET /students/:id
 * Get single student by ID
 */
router.get('/:id', validateParams(idParamSchema), (req, res, next) => {
  studentsController.getById(req, res, next);
});

/**
 * POST /students
 * Create new student (manager or admin only)
 */
router.post('/', managerOrAdmin, validateBody(createStudentSchema), (req, res, next) => {
  studentsController.create(req, res, next);
});

/**
 * PUT /students/:id
 * Update student (manager or admin only)
 */
router.put(
  '/:id',
  managerOrAdmin,
  validate({ params: idParamSchema, body: updateStudentSchema }),
  (req, res, next) => {
    studentsController.update(req, res, next);
  }
);

/**
 * DELETE /students/:id
 * Soft delete student (manager or admin only)
 */
router.delete('/:id', managerOrAdmin, validateParams(idParamSchema), (req, res, next) => {
  studentsController.delete(req, res, next);
});

/**
 * GET /students/:id/registrations
 * Get registrations of a student
 */
router.get('/:id/registrations', validateParams(idParamSchema), (req, res, next) => {
  studentsController.getRegistrations(req, res, next);
});

export { router as studentsRouter };
