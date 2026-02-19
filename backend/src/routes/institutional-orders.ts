import { Router } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { paginationSchema } from '../types/schemas.js';

export const institutionalOrdersRouter = Router();

institutionalOrdersRouter.use(authenticate);

// List all institutional orders with branch info
institutionalOrdersRouter.get('/', async (req, res, next) => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const status = req.query.status as string | undefined;

    const where = {
      ...(status && { status: status as any }),
    };

    const [orders, total] = await Promise.all([
      prisma.institutionalOrder.findMany({
        where,
        include: {
          branch: { select: { id: true, name: true, city: true, type: true } },
          _count: { select: { cycles: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.institutionalOrder.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);
    res.json({
      data: orders,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    next(error);
  }
});
