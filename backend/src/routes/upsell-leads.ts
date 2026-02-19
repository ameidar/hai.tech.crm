import { Router } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { paginationSchema } from '../types/schemas.js';

export const upsellLeadsRouter = Router();

upsellLeadsRouter.use(authenticate);
upsellLeadsRouter.use(managerOrAdmin);

// GET /api/upsell-leads
upsellLeadsRouter.get('/', async (req, res, next) => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const status = req.query.status as string | undefined;

    const where: any = {};
    if (status && ['new', 'contacted', 'converted', 'dismissed'].includes(status)) {
      where.status = status;
    }

    const [items, total] = await Promise.all([
      prisma.upsellLead.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, phone: true, email: true } },
          cycle: { select: { id: true, name: true } },
          registration: {
            include: {
              student: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.upsellLead.count({ where }),
    ]);

    res.json({
      data: items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/upsell-leads/:id
upsellLeadsRouter.patch('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw new AppError(400, 'Invalid ID');

    const { status, notes } = req.body;

    const updateData: any = {};
    if (status) {
      if (!['new', 'contacted', 'converted', 'dismissed'].includes(status)) {
        throw new AppError(400, 'Invalid status');
      }
      updateData.status = status;
    }
    if (notes !== undefined) {
      updateData.notes = notes;
    }

    const lead = await prisma.upsellLead.update({
      where: { id },
      data: updateData,
      include: {
        customer: { select: { id: true, name: true, phone: true, email: true } },
        cycle: { select: { id: true, name: true } },
        registration: {
          include: {
            student: { select: { id: true, name: true } },
          },
        },
      },
    });

    res.json(lead);
  } catch (error) {
    next(error);
  }
});
