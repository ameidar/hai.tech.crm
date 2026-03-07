import { Router } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { paginationSchema } from '../types/schemas.js';
import { z } from 'zod';

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

// Get single institutional order
institutionalOrdersRouter.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await prisma.institutionalOrder.findUnique({
      where: { id },
      include: {
        branch: { select: { id: true, name: true, city: true, type: true } },
        _count: { select: { cycles: true } },
      },
    });
    if (!order) throw new AppError(404, 'Institutional order not found');
    res.json(order);
  } catch (error) {
    next(error);
  }
});

const orderSchema = z.object({
  branchId: z.string().uuid(),
  orderNumber: z.string().optional(),
  orderDate: z.string().optional().nullable(),
  startDate: z.string(),
  endDate: z.string(),
  pricePerMeeting: z.number().positive(),
  estimatedMeetings: z.number().int().optional().nullable(),
  estimatedTotal: z.number().optional().nullable(),
  contactName: z.string().min(1),
  contactPhone: z.string().min(1),
  contactEmail: z.string().email().optional().nullable().or(z.literal('')),
  status: z.enum(['draft', 'active', 'completed', 'cancelled']).optional(),
  notes: z.string().optional().nullable(),
  totalAmount: z.number().optional().nullable(),
  invoiceNumber: z.string().optional().nullable(),
  paymentStatus: z.enum(['unpaid', 'partial', 'paid']).optional().nullable(),
  paidAmount: z.number().optional().nullable(),
});

// Create institutional order
institutionalOrdersRouter.post('/', managerOrAdmin, async (req, res, next) => {
  try {
    const data = orderSchema.parse(req.body);
    const order = await prisma.institutionalOrder.create({
      data: {
        branchId: data.branchId,
        orderNumber: data.orderNumber,
        orderDate: data.orderDate ? new Date(data.orderDate) : null,
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
        pricePerMeeting: data.pricePerMeeting,
        estimatedMeetings: data.estimatedMeetings ?? null,
        estimatedTotal: data.estimatedTotal ?? null,
        contactName: data.contactName,
        contactPhone: data.contactPhone,
        contactEmail: data.contactEmail || null,
        status: data.status || 'draft',
        notes: data.notes ?? null,
      },
      include: {
        branch: { select: { id: true, name: true, city: true, type: true } },
        _count: { select: { cycles: true } },
      },
    });
    res.status(201).json(order);
  } catch (error) {
    next(error);
  }
});

// Update institutional order
institutionalOrdersRouter.put('/:id', managerOrAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const data = orderSchema.partial().parse(req.body);
    const existing = await prisma.institutionalOrder.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Institutional order not found');

    const order = await prisma.institutionalOrder.update({
      where: { id },
      data: {
        ...(data.branchId && { branchId: data.branchId }),
        ...(data.orderNumber !== undefined && { orderNumber: data.orderNumber }),
        ...(data.orderDate !== undefined && { orderDate: data.orderDate ? new Date(data.orderDate) : null }),
        ...(data.startDate && { startDate: new Date(data.startDate) }),
        ...(data.endDate && { endDate: new Date(data.endDate) }),
        ...(data.pricePerMeeting !== undefined && { pricePerMeeting: data.pricePerMeeting }),
        ...(data.estimatedMeetings !== undefined && { estimatedMeetings: data.estimatedMeetings }),
        ...(data.estimatedTotal !== undefined && { estimatedTotal: data.estimatedTotal }),
        ...(data.contactName && { contactName: data.contactName }),
        ...(data.contactPhone && { contactPhone: data.contactPhone }),
        ...(data.contactEmail !== undefined && { contactEmail: data.contactEmail || null }),
        ...(data.status && { status: data.status }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.totalAmount !== undefined && { totalAmount: data.totalAmount }),
        ...(data.invoiceNumber !== undefined && { invoiceNumber: data.invoiceNumber }),
        ...(data.paymentStatus !== undefined && { paymentStatus: data.paymentStatus }),
        ...(data.paidAmount !== undefined && { paidAmount: data.paidAmount }),
      },
      include: {
        branch: { select: { id: true, name: true, city: true, type: true } },
        _count: { select: { cycles: true } },
      },
    });
    res.json(order);
  } catch (error) {
    next(error);
  }
});

// Delete institutional order
institutionalOrdersRouter.delete('/:id', managerOrAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await prisma.institutionalOrder.findUnique({
      where: { id },
      include: { _count: { select: { cycles: true } } },
    });
    if (!existing) throw new AppError(404, 'Institutional order not found');
    if (existing._count.cycles > 0) {
      throw new AppError(400, 'Cannot delete institutional order with associated cycles');
    }
    await prisma.institutionalOrder.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
