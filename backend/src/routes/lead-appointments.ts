import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';

export const leadAppointmentsRouter = Router();
leadAppointmentsRouter.use(authenticate);

// GET /api/lead-appointments
leadAppointmentsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string;
    const dateFrom = (req.query.dateFrom || req.query.from) as string;
    const dateTo = (req.query.dateTo || req.query.to) as string;

    const where: any = {};
    if (status) where.appointmentStatus = status;
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo + 'T23:59:59Z');
    }

    const [items, total] = await Promise.all([
      prisma.leadAppointment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { customer: { select: { id: true, name: true } } },
      }),
      prisma.leadAppointment.count({ where }),
    ]);

    res.json({
      success: true,
      data: items,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/lead-appointments/:id
leadAppointmentsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await prisma.leadAppointment.findUnique({
      where: { id: req.params.id },
      include: { customer: { select: { id: true, name: true, phone: true, email: true } } },
    });
    if (!item) throw new AppError(404, 'Lead appointment not found');
    res.json({ success: true, data: item });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/lead-appointments/:id
leadAppointmentsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { appointmentStatus, appointmentDate, appointmentTime, appointmentNotes } = req.body;
    const data: any = {};
    if (appointmentStatus) data.appointmentStatus = appointmentStatus;
    if (appointmentDate) data.appointmentDate = new Date(appointmentDate);
    if (appointmentTime !== undefined) data.appointmentTime = appointmentTime;
    if (appointmentNotes !== undefined) data.appointmentNotes = appointmentNotes;

    const item = await prisma.leadAppointment.update({
      where: { id: req.params.id },
      data,
    });
    res.json({ success: true, data: item });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/lead-appointments/:id
leadAppointmentsRouter.delete('/:id', managerOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.leadAppointment.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});
