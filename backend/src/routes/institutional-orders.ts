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
  branchId: z.string().uuid().optional().nullable(),
  orderName: z.string().optional().nullable(),
  orderNumber: z.string().optional().nullable(),
  orderDate: z.string().optional().nullable(),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  pricePerMeeting: z.number().positive().optional().nullable(),
  estimatedMeetings: z.number().int().optional().nullable(),
  estimatedTotal: z.number().optional().nullable(),
  contactName: z.string().optional().nullable(),
  contactPhone: z.string().optional().nullable(),
  contactEmail: z.string().email().optional().nullable().or(z.literal('')),
  status: z.enum(['draft', 'active', 'completed', 'cancelled']).optional(),
  fireberryStatus: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  totalAmount: z.number().optional().nullable(),
  invoiceNumber: z.string().optional().nullable(),
  invoiceLink: z.string().optional().nullable(),
  paymentStatus: z.enum(['unpaid', 'partial', 'paid']).optional().nullable(),
  paidAmount: z.number().optional().nullable(),
  payingBody: z.string().optional().nullable(),
  followUpDate: z.string().optional().nullable(),
  salesperson: z.string().optional().nullable(),
  orderType: z.string().optional().nullable(),
  createdBy: z.string().optional().nullable(),
  // Billing fields — needed for issuing monthly proforma to Morning
  taxId: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  zip: z.string().optional().nullable(),
});

// Create institutional order
institutionalOrdersRouter.post('/', managerOrAdmin, async (req, res, next) => {
  try {
    const data = orderSchema.parse(req.body);
    const order = await prisma.institutionalOrder.create({
      data: {
        branchId: data.branchId || undefined,
        orderName: data.orderName ?? null,
        orderNumber: data.orderNumber ?? null,
        orderDate: data.orderDate ? new Date(data.orderDate) : null,
        startDate: data.startDate ? new Date(data.startDate) : null,
        endDate: data.endDate ? new Date(data.endDate) : null,
        pricePerMeeting: data.pricePerMeeting ?? null,
        estimatedMeetings: data.estimatedMeetings ?? null,
        estimatedTotal: data.estimatedTotal ?? null,
        contactName: data.contactName ?? null,
        contactPhone: data.contactPhone ?? null,
        contactEmail: data.contactEmail || null,
        status: data.status || 'draft',
        fireberryStatus: data.fireberryStatus ?? null,
        notes: data.notes ?? null,
        totalAmount: data.totalAmount ?? null,
        invoiceLink: data.invoiceLink ?? null,
        payingBody: data.payingBody ?? null,
        followUpDate: data.followUpDate ? new Date(data.followUpDate) : null,
        salesperson: data.salesperson ?? null,
        orderType: data.orderType ?? null,
        createdBy: data.createdBy ?? null,
        taxId: data.taxId ?? null,
        address: data.address ?? null,
        city: data.city ?? null,
        zip: data.zip ?? null,
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
        ...(data.branchId !== undefined && { branchId: data.branchId || null }),
        ...(data.orderName !== undefined && { orderName: data.orderName }),
        ...(data.orderNumber !== undefined && { orderNumber: data.orderNumber }),
        ...(data.orderDate !== undefined && { orderDate: data.orderDate ? new Date(data.orderDate) : null }),
        ...(data.startDate !== undefined && { startDate: data.startDate ? new Date(data.startDate) : null }),
        ...(data.endDate !== undefined && { endDate: data.endDate ? new Date(data.endDate) : null }),
        ...(data.pricePerMeeting !== undefined && { pricePerMeeting: data.pricePerMeeting }),
        ...(data.estimatedMeetings !== undefined && { estimatedMeetings: data.estimatedMeetings }),
        ...(data.estimatedTotal !== undefined && { estimatedTotal: data.estimatedTotal }),
        ...(data.contactName !== undefined && { contactName: data.contactName }),
        ...(data.contactPhone !== undefined && { contactPhone: data.contactPhone }),
        ...(data.contactEmail !== undefined && { contactEmail: data.contactEmail || null }),
        ...(data.status && { status: data.status }),
        ...(data.fireberryStatus !== undefined && { fireberryStatus: data.fireberryStatus }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.totalAmount !== undefined && { totalAmount: data.totalAmount }),
        ...(data.invoiceNumber !== undefined && { invoiceNumber: data.invoiceNumber }),
        ...(data.invoiceLink !== undefined && { invoiceLink: data.invoiceLink }),
        ...(data.paymentStatus !== undefined && { paymentStatus: data.paymentStatus }),
        ...(data.paidAmount !== undefined && { paidAmount: data.paidAmount }),
        ...(data.payingBody !== undefined && { payingBody: data.payingBody }),
        ...(data.followUpDate !== undefined && { followUpDate: data.followUpDate ? new Date(data.followUpDate) : null }),
        ...(data.salesperson !== undefined && { salesperson: data.salesperson }),
        ...(data.orderType !== undefined && { orderType: data.orderType }),
        ...(data.createdBy !== undefined && { createdBy: data.createdBy }),
        ...(data.taxId !== undefined && { taxId: data.taxId }),
        ...(data.address !== undefined && { address: data.address }),
        ...(data.city !== undefined && { city: data.city }),
        ...(data.zip !== undefined && { zip: data.zip }),
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
