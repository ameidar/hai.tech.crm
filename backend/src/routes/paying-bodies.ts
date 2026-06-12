import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { paginationSchema, uuidSchema } from '../types/schemas.js';
import { logAudit, logUpdateAudit } from '../utils/audit.js';
import { isMorningConfigured } from '../services/morning/client.js';
import { searchClients, getMorningClient, updateMorningClient } from '../services/morning/clients.js';
import { comparePayingBodyToMorning, planSync } from '../services/payingBodySync.js';

export const payingBodiesRouter = Router();

payingBodiesRouter.use(authenticate);

const trimmed = (max = 255) => z.string().trim().min(1).max(max);

// Required on create (decided with Inna): name, taxId (ח.פ or ת.ז), contactName, email.
// Phone + address fields are optional. morningClientId links to an existing Morning client.
export const createSchema = z.object({
  name: trimmed(),
  taxId: trimmed(50),
  contactName: trimmed(),
  email: z.string().trim().email(),
  phone: z.string().trim().max(50).optional().nullable(),
  address: z.string().trim().max(255).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  zip: z.string().trim().max(20).optional().nullable(),
  morningClientId: z.string().trim().max(120).optional().nullable(),
});

// On update every field is optional so legacy incomplete rows can be completed gradually.
export const updateSchema = z.object({
  name: trimmed().optional(),
  taxId: z.string().trim().max(50).optional().nullable(),
  contactName: z.string().trim().max(255).optional().nullable(),
  email: z.union([z.string().trim().email(), z.literal('')]).optional().nullable(),
  phone: z.string().trim().max(50).optional().nullable(),
  address: z.string().trim().max(255).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  zip: z.string().trim().max(20).optional().nullable(),
  morningClientId: z.string().trim().max(120).optional().nullable(),
});

export const isComplete = (b: { name?: string | null; taxId?: string | null; contactName?: string | null; email?: string | null }) =>
  !!(b.name && b.taxId && b.contactName && b.email);

// List paying bodies — optional `q` filters by name or taxId (substring).
payingBodiesRouter.get('/', async (req, res, next) => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const q = (req.query.q as string | undefined)?.trim();
    const onlyIncomplete = req.query.incomplete === 'true';

    const where = {
      ...(q && {
        OR: [
          { name: { contains: q, mode: 'insensitive' as const } },
          { taxId: { contains: q, mode: 'insensitive' as const } },
        ],
      }),
      ...(onlyIncomplete && { isComplete: false }),
    };

    const [items, total] = await Promise.all([
      prisma.payingBody.findMany({
        where,
        include: { _count: { select: { institutionalOrders: true } } },
        orderBy: [{ isComplete: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.payingBody.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);
    res.json({
      data: items,
      pagination: { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
    });
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
payingBodiesRouter.get('/:id', async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const body = await prisma.payingBody.findUnique({
      where: { id },
      include: { _count: { select: { institutionalOrders: true } } },
    });
    if (!body) throw new AppError(404, 'Paying body not found');
    res.json(body);
  } catch (error) {
    next(error);
  }
});

// Create
payingBodiesRouter.post('/', managerOrAdmin, async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const body = await prisma.payingBody.create({
      data: { ...data, isComplete: isComplete(data) },
    });
    await logAudit({ action: 'CREATE', entity: 'PayingBody', entityId: body.id, newValue: { name: body.name, taxId: body.taxId }, req });
    res.status(201).json(body);
  } catch (error) {
    next(error);
  }
});

// Update — recompute isComplete from the merged record so legacy rows flip to complete
// once all required fields are filled.
payingBodiesRouter.put('/:id', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const data = updateSchema.parse(req.body);

    const existing = await prisma.payingBody.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Paying body not found');

    const merged = {
      name: data.name ?? existing.name,
      taxId: data.taxId ?? existing.taxId,
      contactName: data.contactName ?? existing.contactName,
      email: (data.email === '' ? null : data.email) ?? existing.email,
    };

    const body = await prisma.payingBody.update({
      where: { id },
      data: {
        ...data,
        email: data.email === '' ? null : data.email,
        isComplete: isComplete(merged),
      },
    });

    await logUpdateAudit({ entity: 'PayingBody', entityId: id, oldRecord: existing, newRecord: body, req });
    res.json(body);
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
