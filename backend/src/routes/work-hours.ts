import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { logAudit } from '../utils/audit.js';

export const workHoursRouter = Router();

workHoursRouter.use(authenticate);

const createSchema = z.object({
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'workDate must be YYYY-MM-DD'),
  hours: z.number().positive('hours must be greater than 0').max(24, 'hours must be 24 or less'),
  description: z.string().max(500).optional().nullable(),
});

const updateSchema = createSchema.partial();

const reviewSchema = z.object({
  action: z.enum(['approve', 'reject']),
  rejectionReason: z.string().max(500).optional().nullable(),
});

// Resolve the operations-staff Instructor linked to the logged-in user.
async function getOwnInstructor(userId: string) {
  const instructor = await prisma.instructor.findUnique({ where: { userId } });
  if (!instructor) {
    throw new AppError(403, 'אין רשומת עובד מקושרת לחשבון זה');
  }
  return instructor;
}

// Build [from, to) UTC range for a "YYYY-MM" month.
function monthRange(month: string): { from: Date; to: Date } {
  const [year, m] = month.split('-').map(Number);
  return { from: new Date(Date.UTC(year, m - 1, 1)), to: new Date(Date.UTC(year, m, 1)) };
}

// ── Self-service (operations staff) ───────────────────────────────────────────

// GET /api/work-hours/mine?month=YYYY-MM — own entries + monthly summary
workHoursRouter.get('/mine', async (req, res, next) => {
  try {
    const instructor = await getOwnInstructor(req.user!.userId);
    const month = (req.query.month as string) || undefined;
    const where: Record<string, unknown> = { instructorId: instructor.id };
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const { from, to } = monthRange(month);
      where.workDate = { gte: from, lt: to };
    }

    const entries = await prisma.workHourEntry.findMany({
      where,
      orderBy: { workDate: 'desc' },
    });

    const rate = Number(instructor.hourlyRate ?? 0);
    const sumHours = (status?: string) => entries
      .filter((e) => !status || e.status === status)
      .reduce((s, e) => s + Number(e.hours), 0);
    const approvedHours = sumHours('approved');

    res.json({
      instructor: { id: instructor.id, name: instructor.name, hourlyRate: rate },
      entries,
      summary: {
        totalHours: sumHours(),
        approvedHours,
        pendingHours: sumHours('pending'),
        approvedPayment: Math.round(approvedHours * rate),
      },
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/work-hours — report own hours
workHoursRouter.post('/', async (req, res, next) => {
  try {
    const instructor = await getOwnInstructor(req.user!.userId);
    if (instructor.kind !== 'operations') {
      throw new AppError(403, 'דיווח שעות זמין לאנשי תפעול בלבד');
    }
    const data = createSchema.parse(req.body);

    const entry = await prisma.workHourEntry.create({
      data: {
        instructorId: instructor.id,
        workDate: new Date(`${data.workDate}T00:00:00.000Z`),
        hours: data.hours,
        description: data.description ?? null,
        status: 'pending',
      },
    });

    res.status(201).json(entry);
  } catch (error) {
    next(error);
  }
});

// PUT /api/work-hours/:id — edit own pending entry
workHoursRouter.put('/:id', async (req, res, next) => {
  try {
    const instructor = await getOwnInstructor(req.user!.userId);
    const data = updateSchema.parse(req.body);

    const existing = await prisma.workHourEntry.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.instructorId !== instructor.id) {
      throw new AppError(404, 'דיווח לא נמצא');
    }
    if (existing.status !== 'pending') {
      throw new AppError(400, 'לא ניתן לערוך דיווח שכבר אושר או נדחה');
    }

    const entry = await prisma.workHourEntry.update({
      where: { id: existing.id },
      data: {
        ...(data.workDate && { workDate: new Date(`${data.workDate}T00:00:00.000Z`) }),
        ...(data.hours !== undefined && { hours: data.hours }),
        ...(data.description !== undefined && { description: data.description ?? null }),
      },
    });

    res.json(entry);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/work-hours/:id — delete own pending entry
workHoursRouter.delete('/:id', async (req, res, next) => {
  try {
    const instructor = await getOwnInstructor(req.user!.userId);
    const existing = await prisma.workHourEntry.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.instructorId !== instructor.id) {
      throw new AppError(404, 'דיווח לא נמצא');
    }
    if (existing.status !== 'pending') {
      throw new AppError(400, 'לא ניתן למחוק דיווח שכבר אושר או נדחה');
    }
    await prisma.workHourEntry.delete({ where: { id: existing.id } });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ── Admin / manager (approval) ────────────────────────────────────────────────

// GET /api/work-hours?month=YYYY-MM&instructorId=&status= — all entries
workHoursRouter.get('/', managerOrAdmin, async (req, res, next) => {
  try {
    const month = req.query.month as string | undefined;
    const instructorId = req.query.instructorId as string | undefined;
    const status = req.query.status as string | undefined;

    const where: Record<string, unknown> = {};
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const { from, to } = monthRange(month);
      where.workDate = { gte: from, lt: to };
    }
    if (instructorId) where.instructorId = instructorId;
    if (status) where.status = status;

    const entries = await prisma.workHourEntry.findMany({
      where,
      include: { instructor: { select: { id: true, name: true, hourlyRate: true } } },
      orderBy: [{ workDate: 'desc' }],
    });

    res.json(entries);
  } catch (error) {
    next(error);
  }
});

// POST /api/work-hours/:id/review — approve or reject a single entry
workHoursRouter.post('/:id/review', managerOrAdmin, async (req, res, next) => {
  try {
    const { action, rejectionReason } = reviewSchema.parse(req.body);

    const existing = await prisma.workHourEntry.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError(404, 'דיווח לא נמצא');

    const entry = await prisma.workHourEntry.update({
      where: { id: existing.id },
      data: {
        status: action === 'approve' ? 'approved' : 'rejected',
        reviewedBy: req.user!.userId,
        reviewedAt: new Date(),
        rejectionReason: action === 'reject' ? (rejectionReason ?? null) : null,
      },
    });

    await logAudit({
      action: 'UPDATE',
      entity: 'WorkHourEntry',
      entityId: entry.id,
      newValue: { status: entry.status },
      req,
    });

    res.json(entry);
  } catch (error) {
    next(error);
  }
});

// POST /api/work-hours/approve-month — bulk-approve all pending entries in a month
workHoursRouter.post('/approve-month', managerOrAdmin, async (req, res, next) => {
  try {
    const schema = z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/),
      instructorId: z.string().min(1).optional(),
    });
    const { month, instructorId } = schema.parse(req.body);
    const { from, to } = monthRange(month);

    const result = await prisma.workHourEntry.updateMany({
      where: {
        status: 'pending',
        workDate: { gte: from, lt: to },
        ...(instructorId && { instructorId }),
      },
      data: {
        status: 'approved',
        reviewedBy: req.user!.userId,
        reviewedAt: new Date(),
      },
    });

    res.json({ success: true, approved: result.count });
  } catch (error) {
    next(error);
  }
});
