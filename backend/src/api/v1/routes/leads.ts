import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../../utils/prisma.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { requireScope } from '../middleware/scope-check.js';
import { validateParams, validateQuery, validateBody } from '../middleware/validate.js';
import { idParamSchema } from '../validators/common.js';

const router = Router();

router.use(authenticate);

const leadQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  salesStatus: z.string().optional(),
  source: z.string().optional(),
  assignedToId: z.string().optional(),
  followUp: z.enum(['due']).optional(),
  updatedSince: z.string().datetime().optional(),
});

const updateLeadSchema = z.object({
  salesStatus: z.string().optional(),
  assignedToId: z.string().uuid().nullable().optional(),
  nextFollowUpAt: z.string().datetime().nullable().optional(),
  lastContactResult: z.string().nullable().optional(),
  activityType: z.string().optional(),
  activityNote: z.string().nullable().optional(),
}).strict();

const createActivitySchema = z.object({
  type: z.string().default('note'),
  result: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  nextFollowUpAt: z.string().datetime().nullable().optional(),
  salesStatus: z.string().optional(),
}).strict();

function userId(req: AuthRequest) {
  return req.user?.userId || null;
}

function leadInclude(withActivities = false) {
  return {
    assignedTo: { select: { id: true, name: true, email: true, role: true } },
    ...(withActivities ? {
      activities: {
        orderBy: { createdAt: 'desc' as const },
        take: 25,
        include: { user: { select: { id: true, name: true, email: true, role: true } } },
      },
    } : {}),
  };
}

router.get('/', requireScope('read:leads'), validateQuery(leadQuerySchema), async (req, res, next) => {
  try {
    const query = req.query as unknown as z.infer<typeof leadQuerySchema>;
    const where: any = {};

    if (query.salesStatus) where.salesStatus = query.salesStatus;
    if (query.source) where.source = query.source;
    if (query.assignedToId) where.assignedToId = query.assignedToId === 'unassigned' ? null : query.assignedToId;
    if (query.followUp === 'due') {
      where.nextFollowUpAt = { lte: new Date() };
      where.salesStatus = { notIn: ['converted', 'not_relevant'] };
    }
    if (query.updatedSince) where.updatedAt = { gte: new Date(query.updatedSince) };

    const [items, total] = await Promise.all([
      prisma.leadAppointment.findMany({
        where,
        orderBy: [{ nextFollowUpAt: 'asc' }, { updatedAt: 'desc' }],
        skip: query.offset,
        take: query.limit,
        include: leadInclude(false),
      }),
      prisma.leadAppointment.count({ where }),
    ]);

    res.json({ data: items, meta: { total, limit: query.limit, offset: query.offset } });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', requireScope('read:leads'), validateParams(idParamSchema), async (req, res, next) => {
  try {
    const item = await prisma.leadAppointment.findUnique({
      where: { id: req.params.id },
      include: leadInclude(true),
    });

    if (!item) {
      res.status(404).json({ error: { message: 'Lead not found' } });
      return;
    }

    res.json({ data: item });
  } catch (error) {
    next(error);
  }
});

router.patch(
  '/:id',
  requireScope('write:leads'),
  validateParams(idParamSchema),
  validateBody(updateLeadSchema),
  async (req: AuthRequest, res, next) => {
    try {
      const body = req.body as z.infer<typeof updateLeadSchema>;
      const nextFollowUpAt = body.nextFollowUpAt === undefined
        ? undefined
        : body.nextFollowUpAt
          ? new Date(body.nextFollowUpAt)
          : null;

      const item = await prisma.$transaction(async (tx) => {
        const updated = await tx.leadAppointment.update({
          where: { id: req.params.id },
          data: {
            ...(body.salesStatus ? { salesStatus: body.salesStatus } : {}),
            ...(body.assignedToId !== undefined ? { assignedToId: body.assignedToId } : {}),
            ...(nextFollowUpAt !== undefined ? { nextFollowUpAt } : {}),
            ...(body.lastContactResult !== undefined ? {
              lastContactResult: body.lastContactResult,
              lastContactedAt: body.lastContactResult ? new Date() : null,
            } : {}),
          },
          include: leadInclude(true),
        });

        if (body.activityType || body.activityNote || body.lastContactResult) {
          await tx.leadActivity.create({
            data: {
              leadAppointmentId: req.params.id,
              userId: userId(req),
              type: body.activityType || 'note',
              result: body.lastContactResult || null,
              note: body.activityNote || null,
              nextFollowUpAt: nextFollowUpAt === undefined ? null : nextFollowUpAt,
            },
          });
        }

        return updated;
      });

      res.json({ data: item });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/:id/activities',
  requireScope('write:leads'),
  validateParams(idParamSchema),
  validateBody(createActivitySchema),
  async (req: AuthRequest, res, next) => {
    try {
      const body = req.body as z.infer<typeof createActivitySchema>;
      const nextFollowUpAt = body.nextFollowUpAt ? new Date(body.nextFollowUpAt) : null;

      const activity = await prisma.$transaction(async (tx) => {
        const created = await tx.leadActivity.create({
          data: {
            leadAppointmentId: req.params.id,
            userId: userId(req),
            type: body.type,
            result: body.result || null,
            note: body.note || null,
            nextFollowUpAt,
          },
          include: { user: { select: { id: true, name: true, email: true, role: true } } },
        });

        await tx.leadAppointment.update({
          where: { id: req.params.id },
          data: {
            ...(body.salesStatus ? { salesStatus: body.salesStatus } : {}),
            ...(body.result ? { lastContactResult: body.result, lastContactedAt: new Date() } : {}),
            ...(body.nextFollowUpAt !== undefined ? { nextFollowUpAt } : {}),
          },
        });

        return created;
      });

      res.status(201).json({ data: activity });
    } catch (error) {
      next(error);
    }
  }
);

export { router as leadsRouter };
