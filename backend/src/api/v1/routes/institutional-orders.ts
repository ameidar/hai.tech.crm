import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireScopeOrRole } from '../middleware/scope-check.js';
import { validate, validateParams, validateQuery } from '../middleware/validate.js';
import { opsIdParamSchema, institutionalOrderQuerySchema } from '../validators/ops.js';
import { sendCreated, sendPaged, sendSuccess } from '../../../common/utils/response.js';
import {
  listInstitutionalOrders,
  getInstitutionalOrder,
  createInstitutionalOrder,
  updateInstitutionalOrder,
} from '../../../services/institutional-orders.service.js';

/**
 * Institutional orders (הזמנות מוסדיות) — v1 ops API.
 * Same business logic as /api/institutional-orders (services/institutional-orders.service.ts):
 * create requires branchId AND payingBodyId; update accepts partial payloads so legacy
 * rows stay editable.
 */
const router = Router();

router.use(authenticate);

const READ_ROLES = ['admin', 'manager', 'operations_manager'] as const;
const WRITE_ROLES = ['admin', 'manager'] as const; // internal route: managerOrAdmin

router.get(
  '/',
  requireScopeOrRole('read:institutional_orders', READ_ROLES),
  validateQuery(institutionalOrderQuerySchema),
  async (req, res, next) => {
    try {
      const q = req.query as any;
      const result = await listInstitutionalOrders({
        page: q.page,
        limit: q.limit,
        status: q.status,
        search: q.search,
        withCycles: q.withCycles,
        withRelevantCycles: q.withRelevantCycles,
        forBilling: q.forBilling,
      });
      sendPaged(res, result);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/:id',
  requireScopeOrRole('read:institutional_orders', READ_ROLES),
  validateParams(opsIdParamSchema),
  async (req, res, next) => {
    try {
      sendSuccess(res, await getInstitutionalOrder(req.params.id));
    } catch (error) {
      next(error);
    }
  }
);

router.post('/', requireScopeOrRole('write:institutional_orders', WRITE_ROLES), async (req, res, next) => {
  try {
    sendCreated(res, await createInstitutionalOrder(req.body, req));
  } catch (error) {
    next(error);
  }
});

router.put(
  '/:id',
  requireScopeOrRole('write:institutional_orders', WRITE_ROLES),
  validate({ params: opsIdParamSchema }),
  async (req, res, next) => {
    try {
      sendSuccess(res, await updateInstitutionalOrder(req.params.id, req.body, req));
    } catch (error) {
      next(error);
    }
  }
);

export { router as institutionalOrdersRouter };
