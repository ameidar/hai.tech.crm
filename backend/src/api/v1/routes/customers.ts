import { Router } from 'express';
import { customersController } from '../controllers/customers.controller.js';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { validate, validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import { idParamSchema } from '../validators/common.js';
import { 
  customerQuerySchema, 
  createCustomerSchema, 
  updateCustomerSchema,
  createStudentForCustomerSchema 
} from '../validators/customers.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /customers
 * List all customers with pagination and filters
 */
router.get('/', validateQuery(customerQuerySchema), (req, res, next) => {
  customersController.list(req, res, next);
});

/**
 * GET /customers/:id
 * Get single customer by ID
 */
router.get('/:id', validateParams(idParamSchema), (req, res, next) => {
  customersController.getById(req, res, next);
});

/**
 * POST /customers
 * Create new customer (manager or admin only)
 */
router.post('/', managerOrAdmin, validateBody(createCustomerSchema), (req, res, next) => {
  customersController.create(req, res, next);
});

/**
 * PUT /customers/:id
 * Update customer (manager or admin only)
 */
router.put(
  '/:id', 
  managerOrAdmin, 
  validate({ params: idParamSchema, body: updateCustomerSchema }), 
  (req, res, next) => {
    customersController.update(req, res, next);
  }
);

/**
 * DELETE /customers/:id
 * Soft delete customer (manager or admin only)
 */
router.delete('/:id', managerOrAdmin, validateParams(idParamSchema), (req, res, next) => {
  customersController.delete(req, res, next);
});

/**
 * GET /customers/:id/students
 * Get students of a customer
 */
router.get('/:id/students', validateParams(idParamSchema), (req, res, next) => {
  customersController.getStudents(req, res, next);
});

/**
 * POST /customers/:id/students
 * Add student to customer (manager or admin only)
 */
router.post(
  '/:id/students', 
  managerOrAdmin, 
  validate({ params: idParamSchema, body: createStudentForCustomerSchema }), 
  (req, res, next) => {
    customersController.addStudent(req, res, next);
  }
);

export { router as customersRouter };
