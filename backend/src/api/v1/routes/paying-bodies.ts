import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireScopeOrRole } from '../middleware/scope-check.js';
import { validateParams, validateQuery } from '../middleware/validate.js';
import { opsIdParamSchema, payingBodyQuerySchema } from '../validators/ops.js';
import { sendCreated, sendPaged, sendSuccess } from '../../../common/utils/response.js';
import {
  listPayingBodies,
  getPayingBody,
  createPayingBody,
  updatePayingBody,
} from '../../../services/paying-bodies.service.js';

/**
 * Paying bodies (גוף משלם) — v1 ops API.
 * Same rules as /api/paying-bodies (services/paying-bodies.service.ts):
 * - create requires name, taxId, contactName, email
 * - update: every field optional; isComplete is recomputed so partial rows can be completed
 * No Morning side effects (the internal create/update don't sync to Morning either).
 */
const router = Router();

router.use(authenticate);

const ROLES = ['admin', 'manager'] as const; // internal route: managerOrAdmin

router.get(
  '/',
  requireScopeOrRole('read:paying_bodies', ROLES),
  validateQuery(payingBodyQuerySchema),
  async (req, res, next) => {
    try {
      const q = req.query as any;
      sendPaged(res, await listPayingBodies({ page: q.page, limit: q.limit, q: q.q, incomplete: q.incomplete }));
    } catch (error) {
      next(error);
    }
  }
);

router.get('/:id', requireScopeOrRole('read:paying_bodies', ROLES), validateParams(opsIdParamSchema), async (req, res, next) => {
  try {
    sendSuccess(res, await getPayingBody(req.params.id));
  } catch (error) {
    next(error);
  }
});

router.post('/', requireScopeOrRole('write:paying_bodies', ROLES), async (req, res, next) => {
  try {
    sendCreated(res, await createPayingBody(req.body, req));
  } catch (error) {
    next(error);
  }
});

router.put('/:id', requireScopeOrRole('write:paying_bodies', ROLES), validateParams(opsIdParamSchema), async (req, res, next) => {
  try {
    sendSuccess(res, await updatePayingBody(req.params.id, req.body, req));
  } catch (error) {
    next(error);
  }
});

export { router as payingBodiesRouter };
