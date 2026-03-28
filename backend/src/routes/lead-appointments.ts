import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { findOrCreateCustomer } from '../utils/lead-customer.js';
import { sendLeadWelcomeTemplate } from '../services/lead-welcome.js';

export const leadAppointmentsRouter = Router();
leadAppointmentsRouter.use(authenticate);

// GET /api/lead-appointments
leadAppointmentsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string;
    const source = req.query.source as string;
    const dateFrom = (req.query.dateFrom || req.query.from) as string;
    const dateTo = (req.query.dateTo || req.query.to) as string;

    const sortBy = req.query.sortBy as string; // 'createdAt' | 'updatedAt'
    const orderField = sortBy === 'updatedAt' ? 'updatedAt' : 'createdAt';

    const where: any = {};
    if (status) where.appointmentStatus = status;
    if (source) where.source = source;
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo + 'T23:59:59Z');
    }

    const [items, total] = await Promise.all([
      prisma.leadAppointment.findMany({
        where,
        orderBy: { [orderField]: 'desc' },
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
      notes,
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
      },
      include: { customer: { select: { id: true, name: true } } },
    });

    // Send welcome WhatsApp template (gated by LEAD_WELCOME_WA_ENABLED)
    if (customerPhone) {
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
