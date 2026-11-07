import { Router } from 'express';
import { registrationsController } from '../controllers/registrations.controller.js';
import { authenticate } from '../middleware/auth.js';
import { requireScopeOrRole } from '../middleware/scope-check.js';

// Same roles as the former canWriteRegistrations; API keys are decided by their own 'write:registrations' scope.
const REGISTRATION_WRITE_ROLES = ['admin', 'manager', 'operations_manager'] as const;
const canWriteRegistrations = requireScopeOrRole('write:registrations', REGISTRATION_WRITE_ROLES);
import { validate, validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import { idParamSchema } from '../validators/common.js';
import {
  registrationQuerySchema,
  createRegistrationSchema,
  updateRegistrationSchema,
  updatePaymentSchema,
  cancelRegistrationSchema,
} from '../validators/registrations.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /registrations
 * List all registrations with pagination and filters
 */
router.get('/', validateQuery(registrationQuerySchema), (req, res, next) => {
  registrationsController.list(req, res, next);
});

/**
 * GET /registrations/:id
 * Get single registration by ID with full details
 */
router.get('/:id', validateParams(idParamSchema), (req, res, next) => {
  registrationsController.getById(req, res, next);
});

/**
 * POST /registrations
 * Create new registration (manager or admin only)
 */
router.post('/', canWriteRegistrations, validateBody(createRegistrationSchema), (req, res, next) => {
  registrationsController.create(req, res, next);
});

/**
 * PUT /registrations/:id
 * Update registration (manager or admin only)
 */
router.put(
  '/:id',
  canWriteRegistrations,
  validate({ params: idParamSchema, body: updateRegistrationSchema }),
  (req, res, next) => {
    registrationsController.update(req, res, next);
  }
);

/**
 * DELETE /registrations/:id
 * Soft delete registration (manager or admin only)
 */
router.delete('/:id', canWriteRegistrations, validateParams(idParamSchema), (req, res, next) => {
  registrationsController.delete(req, res, next);
});

/**
 * GET /registrations/:id/attendance
 * Get attendance of a registration
 */
router.get('/:id/attendance', validateParams(idParamSchema), (req, res, next) => {
  registrationsController.getAttendance(req, res, next);
});

/**
 * POST /registrations/:id/cancel
 * Cancel registration (manager or admin only)
 */
router.post(
  '/:id/cancel',
  canWriteRegistrations,
  validate({ params: idParamSchema, body: cancelRegistrationSchema }),
  (req, res, next) => {
    registrationsController.cancel(req, res, next);
  }
);

/**
 * POST /registrations/:id/payment
 * Update payment status (manager or admin only)
 */
router.post(
  '/:id/payment',
  canWriteRegistrations,
  validate({ params: idParamSchema, body: updatePaymentSchema }),
  (req, res, next) => {
    registrationsController.updatePayment(req, res, next);
  }
);

export { router as registrationsRouter };
