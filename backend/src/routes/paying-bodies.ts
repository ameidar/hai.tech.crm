import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { uuidSchema } from '../types/schemas.js';
import { logAudit, logUpdateAudit } from '../utils/audit.js';
import { isMorningConfigured } from '../services/morning/client.js';
import { searchClients, getMorningClient, updateMorningClient } from '../services/morning/clients.js';
import { comparePayingBodyToMorning, planSync } from '../services/payingBodySync.js';
import {
  createSchema,
  updateSchema,
  isComplete,
  listPayingBodies,
  getPayingBody,
  createPayingBody,
  updatePayingBody,
  type PayingBodyListQuery,
} from '../services/paying-bodies.service.js';

export const payingBodiesRouter = Router();

payingBodiesRouter.use(authenticate);

// Schemas + helpers live in the shared service; re-exported for existing importers/tests.
export { createSchema, updateSchema, isComplete };

// List paying bodies — financial counterparty data, admin/manager only.
// Optional `q` filters by name or taxId (substring).
payingBodiesRouter.get('/', managerOrAdmin, async (req, res, next) => {
  try {
    res.json(await listPayingBodies(req.query as PayingBodyListQuery));
  } catch (error) {
    next(error);
  }
});

// Search Morning's client directory (by name and/or taxId) so the user can link an
// existing Morning client instead of creating a duplicate.
payingBodiesRouter.get('/morning/search', managerOrAdmin, async (req, res, next) => {
  try {
    if (!isMorningConfigured()) {
      throw new AppError(503, 'Morning is not configured');
    }
    const name = (req.query.name as string | undefined)?.trim();
    const taxId = (req.query.taxId as string | undefined)?.trim();
    if (!name && !taxId) {
      throw new AppError(400, 'Provide a name or taxId to search');
    }

    const results = await searchClients({ name: name || undefined, taxId: taxId || undefined, pageSize: 25 });
    res.json({
      data: results.map((c) => ({
        id: c.id,
        name: c.name,
        taxId: c.taxId ?? null,
        emails: c.emails ?? [],
        phone: c.phone ?? null,
        address: c.address ?? null,
        city: c.city ?? null,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// Compare a linked paying body against its Morning client, field by field.
payingBodiesRouter.get('/:id/morning/compare', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    if (!isMorningConfigured()) throw new AppError(503, 'Morning is not configured');
    const pb = await prisma.payingBody.findUnique({ where: { id } });
    if (!pb) throw new AppError(404, 'Paying body not found');
    if (!pb.morningClientId) throw new AppError(400, 'הגוף המשלם אינו מקושר ללקוח במורנינג');

    const client = await getMorningClient(pb.morningClientId);
    res.json({ data: { morningClientId: pb.morningClientId, fields: comparePayingBodyToMorning(pb, client) } });
  } catch (error) {
    next(error);
  }
});

const syncSchema = z.object({
  decisions: z.record(z.string(), z.enum(['fromMorning', 'toMorning'])),
});

// Apply per-field sync decisions between a paying body and its Morning client. Morning is updated
// first, then the CRM record; taxId is protected (planSync rejects overwriting an existing one).
payingBodiesRouter.post('/:id/morning/sync', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    if (!isMorningConfigured()) throw new AppError(503, 'Morning is not configured');
    const { decisions } = syncSchema.parse(req.body);

    const pb = await prisma.payingBody.findUnique({ where: { id } });
    if (!pb) throw new AppError(404, 'Paying body not found');
    if (!pb.morningClientId) throw new AppError(400, 'הגוף המשלם אינו מקושר ללקוח במורנינג');

    const client = await getMorningClient(pb.morningClientId);
    const plan = planSync(pb, client, decisions);
    if (plan.errors.length) throw new AppError(400, plan.errors.join(' | '));

    if (Object.keys(plan.morningChanges).length) {
      await updateMorningClient(pb.morningClientId, plan.morningChanges);
    }

    let updated = pb;
    if (Object.keys(plan.pbUpdates).length) {
      const merged = {
        name: plan.pbUpdates.name ?? pb.name,
        taxId: plan.pbUpdates.taxId ?? pb.taxId,
        contactName: pb.contactName,
        email: plan.pbUpdates.email ?? pb.email,
      };
      updated = await prisma.payingBody.update({
        where: { id },
        data: { ...(plan.pbUpdates as Prisma.PayingBodyUpdateInput), isComplete: isComplete(merged) },
      });
      await logUpdateAudit({ entity: 'PayingBody', entityId: id, oldRecord: pb, newRecord: updated, req });
    }

    const freshClient = await getMorningClient(pb.morningClientId);
    res.json({ data: { morningClientId: pb.morningClientId, fields: comparePayingBodyToMorning(updated, freshClient) } });
  } catch (error) {
    next(error);
  }
});

// Get one
payingBodiesRouter.get('/:id', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    res.json(await getPayingBody(id));
  } catch (error) {
    next(error);
  }
});

// Create
payingBodiesRouter.post('/', managerOrAdmin, async (req, res, next) => {
  try {
    const body = await createPayingBody(req.body, req);
    res.status(201).json(body);
  } catch (error) {
    next(error);
  }
});

// Update — recomputes isComplete from the merged record (see service).
payingBodiesRouter.put('/:id', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    res.json(await updatePayingBody(id, req.body, req));
  } catch (error) {
    next(error);
  }
});

// Delete — blocked while institutional orders still point to it.
payingBodiesRouter.delete('/:id', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const linked = await prisma.institutionalOrder.count({ where: { payingBodyId: id } });
    if (linked > 0) {
      throw new AppError(400, `לא ניתן למחוק — ${linked} הזמנות מקושרות לגוף המשלם`);
    }
    const existing = await prisma.payingBody.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Paying body not found');

    await prisma.payingBody.delete({ where: { id } });
    await logAudit({ action: 'DELETE', entity: 'PayingBody', entityId: id, oldValue: { name: existing.name, taxId: existing.taxId }, req });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
