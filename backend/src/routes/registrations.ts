import { Router } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { updateRegistrationSchema, uuidSchema } from '../types/schemas.js';
import { z } from 'zod';
import { parsePaginationParams, paginatedResponse } from '../utils/pagination.js';

export const registrationsRouter = Router();

registrationsRouter.use(authenticate);

// List registrations
registrationsRouter.get('/', async (req, res, next) => {
  try {
    const { page, limit, skip, take, sort, order } = parsePaginationParams(req.query);
    const status = req.query.status as string | undefined;
    const paymentStatus = req.query.paymentStatus as string | undefined;
    const cycleId = req.query.cycleId as string | undefined;
    const studentId = req.query.studentId as string | undefined;

    const where = {
      ...(status && { status: status as any }),
      ...(paymentStatus && { paymentStatus: paymentStatus as any }),
      ...(cycleId && { cycleId }),
      ...(studentId && { studentId }),
    };

    const [registrations, total] = await Promise.all([
      prisma.registration.findMany({
        where,
        include: {
          student: {
            include: {
              customer: { select: { id: true, name: true, phone: true, email: true } },
            },
          },
          cycle: {
            include: {
              course: { select: { id: true, name: true } },
              branch: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { [sort || 'registrationDate']: order },
        skip,
        take,
      }),
      prisma.registration.count({ where }),
    ]);

    res.json(paginatedResponse(registrations, total, page, limit));
  } catch (error) {
    next(error);
  }
});

// Get registration by ID
registrationsRouter.get('/:id', async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);

    const registration = await prisma.registration.findUnique({
      where: { id },
      include: {
        student: {
          include: {
            customer: true,
          },
        },
        cycle: {
          include: {
            course: true,
            branch: true,
            instructor: { select: { id: true, name: true } },
          },
        },
        attendance: {
          include: {
            meeting: {
              select: { id: true, scheduledDate: true, status: true },
            },
          },
          orderBy: { recordedAt: 'desc' },
        },
      },
    });

    if (!registration) {
      throw new AppError(404, 'Registration not found');
    }

    res.json(registration);
  } catch (error) {
    next(error);
  }
});

// Update registration
registrationsRouter.put('/:id', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const data = updateRegistrationSchema.parse(req.body);

    const registration = await prisma.registration.update({
      where: { id },
      data: {
        ...data,
        cancellationDate: data.status === 'cancelled' ? new Date() : undefined,
      },
      include: {
        student: {
          include: {
            customer: { select: { id: true, name: true, phone: true } },
          },
        },
        cycle: {
          select: { id: true, name: true },
        },
      },
    });

    res.json(registration);
  } catch (error) {
    next(error);
  }
});

// Delete registration
registrationsRouter.delete('/:id', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);

    await prisma.registration.delete({
      where: { id },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Cancel registration
registrationsRouter.post('/:id/cancel', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const { reason } = z.object({ reason: z.string().optional() }).parse(req.body);

    const registration = await prisma.registration.update({
      where: { id },
      data: {
        status: 'cancelled',
        cancellationDate: new Date(),
        cancellationReason: reason,
      },
      include: {
        student: { select: { name: true } },
        cycle: { select: { name: true } },
      },
    });

    res.json(registration);
  } catch (error) {
    next(error);
  }
});

// Update payment status
registrationsRouter.post('/:id/payment', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const data = z.object({
      paymentStatus: z.enum(['unpaid', 'partial', 'paid']),
      paymentMethod: z.enum(['credit', 'transfer', 'cash']).optional(),
      amount: z.number().positive().optional(),
      invoiceLink: z.string().optional(),
    }).parse(req.body);

    const registration = await prisma.registration.update({
      where: { id },
      data,
      include: {
        student: { select: { name: true } },
        cycle: { select: { name: true } },
      },
    });

    res.json(registration);
  } catch (error) {
    next(error);
  }
});
