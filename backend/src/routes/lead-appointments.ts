import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { findOrCreateCustomer } from '../utils/lead-customer.js';
import { sendLeadWelcomeTemplate } from '../services/lead-welcome.js';

export const leadAppointmentsRouter = Router();
leadAppointmentsRouter.use(authenticate);

const LEAD_INCLUDE = {
  customer: { select: { id: true, name: true, phone: true, email: true } },
  assignedTo: { select: { id: true, name: true, email: true, role: true } },
} as const;

const LEAD_DETAIL_INCLUDE = {
  ...LEAD_INCLUDE,
  activities: {
    orderBy: { createdAt: 'desc' as const },
    take: 25,
    include: { user: { select: { id: true, name: true, email: true, role: true } } },
  },
} as const;

function parseNullableDate(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return new Date(value as string);
}

function requestUserId(req: Request) {
  return (req.user as any)?.userId || (req.user as any)?.id || null;
}

// GET /api/lead-appointments
leadAppointmentsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string;
    const salesStatus = req.query.salesStatus as string;
    const assignedToId = req.query.assignedToId as string;
    const followUp = req.query.followUp as string;
    const source = req.query.source as string;
    const dateFrom = (req.query.dateFrom || req.query.from) as string;
    const dateTo = (req.query.dateTo || req.query.to) as string;

    const sortBy = req.query.sortBy as string; // 'createdAt' | 'updatedAt' | 'nextFollowUpAt'
    const orderField = sortBy === 'updatedAt'
      ? 'updatedAt'
      : sortBy === 'nextFollowUpAt'
        ? 'nextFollowUpAt'
        : 'createdAt';

    const where: any = {};
    if (status) where.appointmentStatus = status;
    if (salesStatus) where.salesStatus = salesStatus;
    if (assignedToId) where.assignedToId = assignedToId === 'unassigned' ? null : assignedToId;
    if (followUp === 'due') {
      where.nextFollowUpAt = { lte: new Date() };
      where.salesStatus = { notIn: ['converted', 'not_relevant'] };
    }
    if (source) where.source = source;
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo + 'T23:59:59Z');
    }

    const [items, total] = await Promise.all([
      prisma.leadAppointment.findMany({
        where,
        orderBy: orderField === 'nextFollowUpAt'
          ? [{ nextFollowUpAt: 'asc' }, { updatedAt: 'desc' }]
          : { [orderField]: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: LEAD_INCLUDE,
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

// POST /api/lead-appointments — create manually from CRM
leadAppointmentsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      customerName,
      customerPhone,
      customerEmail,
      childName,
      interest,
      source = 'manual',
      appointmentStatus = 'new',
      appointmentDate,
      appointmentTime,
      appointmentNotes,
      salesStatus = 'new',
      assignedToId,
      nextFollowUpAt,
      notes,
      sendWelcome = false,
    } = req.body;

    if (!customerName && !customerPhone && !customerEmail) {
      throw new AppError(400, 'name, phone, or email required');
    }

    // Find or create customer
    const { customerId } = await findOrCreateCustomer({
      name: customerName,
      phone: customerPhone,
      email: customerEmail,
      source,
      notes: notes || interest || 'יצירה ידנית מ-CRM',
      childName,
    });

    const item = await prisma.leadAppointment.create({
      data: {
        customerId: customerId || null,
        customerName: customerName || customerPhone || 'לא ידוע',
        customerPhone: customerPhone || '',
        customerEmail: customerEmail || null,
        childName: childName || null,
        interest: interest || null,
        source,
        appointmentStatus,
        appointmentDate: appointmentDate ? new Date(appointmentDate) : null,
        appointmentTime: appointmentTime || null,
        appointmentNotes: appointmentNotes || null,
        salesStatus,
        assignedToId: assignedToId || null,
        nextFollowUpAt: nextFollowUpAt ? new Date(nextFollowUpAt) : null,
      },
      include: LEAD_INCLUDE,
    });

    // Send welcome WhatsApp template only when the salesperson opted in
    // (also gated by LEAD_WELCOME_WA_ENABLED inside the service)
    if (customerPhone && sendWelcome) {
      sendLeadWelcomeTemplate(customerPhone, customerName || customerPhone)
        .catch(err => console.error('[lead-appointments] welcome template error:', err));
    }

    res.status(201).json({ success: true, data: item });
  } catch (error) {
    next(error);
  }
});

// GET /api/lead-appointments/:id
leadAppointmentsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await prisma.leadAppointment.findUnique({
      where: { id: req.params.id },
      include: LEAD_DETAIL_INCLUDE,
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
    const {
      appointmentStatus,
      appointmentDate,
      appointmentTime,
      appointmentNotes,
      salesStatus,
      assignedToId,
      nextFollowUpAt,
      lastContactResult,
      activityType,
      activityNote,
    } = req.body;
    const data: any = {};
    if (appointmentStatus) data.appointmentStatus = appointmentStatus;
    const parsedAppointmentDate = parseNullableDate(appointmentDate);
    if (parsedAppointmentDate !== undefined) data.appointmentDate = parsedAppointmentDate;
    if (appointmentTime !== undefined) data.appointmentTime = appointmentTime;
    if (appointmentNotes !== undefined) data.appointmentNotes = appointmentNotes;
    if (salesStatus) data.salesStatus = salesStatus;
    if (assignedToId !== undefined) data.assignedToId = assignedToId || null;
    const parsedNextFollowUpAt = parseNullableDate(nextFollowUpAt);
    if (parsedNextFollowUpAt !== undefined) data.nextFollowUpAt = parsedNextFollowUpAt;
    if (lastContactResult !== undefined) {
      data.lastContactResult = lastContactResult || null;
      data.lastContactedAt = lastContactResult ? new Date() : null;
    }

    const item = await prisma.$transaction(async (tx) => {
      const updated = await tx.leadAppointment.update({
        where: { id: req.params.id },
        data,
        include: LEAD_DETAIL_INCLUDE,
      });

      if (activityType || activityNote || lastContactResult) {
        await tx.leadActivity.create({
          data: {
            leadAppointmentId: req.params.id,
            userId: requestUserId(req),
            type: activityType || 'note',
            result: lastContactResult || null,
            note: activityNote || appointmentNotes || null,
            nextFollowUpAt: parsedNextFollowUpAt === undefined ? null : parsedNextFollowUpAt,
          },
        });
      }

      return updated;
    });

    res.json({ success: true, data: item });
  } catch (error) {
    next(error);
  }
});

// POST /api/lead-appointments/:id/activities
leadAppointmentsRouter.post('/:id/activities', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { type = 'note', result, note, nextFollowUpAt, salesStatus } = req.body;
    const parsedNextFollowUpAt = parseNullableDate(nextFollowUpAt);

    const item = await prisma.$transaction(async (tx) => {
      const activity = await tx.leadActivity.create({
        data: {
          leadAppointmentId: req.params.id,
          userId: requestUserId(req),
          type,
          result: result || null,
          note: note || null,
          nextFollowUpAt: parsedNextFollowUpAt === undefined ? null : parsedNextFollowUpAt,
        },
        include: { user: { select: { id: true, name: true, email: true, role: true } } },
      });

      await tx.leadAppointment.update({
        where: { id: req.params.id },
        data: {
          ...(salesStatus ? { salesStatus } : {}),
          ...(result ? { lastContactResult: result, lastContactedAt: new Date() } : {}),
          ...(parsedNextFollowUpAt !== undefined ? { nextFollowUpAt: parsedNextFollowUpAt } : {}),
        },
      });

      return activity;
    });

    res.status(201).json({ success: true, data: item });
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
