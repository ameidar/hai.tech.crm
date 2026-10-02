import { Router } from 'express';
import crypto from 'crypto';
import { prisma } from '../utils/prisma.js';
import { authenticate, operationsManagerOrAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { createInstructorSchema, updateInstructorSchema, uuidSchema } from '../types/schemas.js';
import { parsePaginationParams, paginatedResponse } from '../utils/pagination.js';
import { logAudit, logUpdateAudit } from '../utils/audit.js';
import { z } from 'zod';
import {
  MONTH_REGEX,
  monthToDate,
  dateToMonth,
} from '../services/instructor-fixed-additions.js';

export const instructorsRouter = Router();

instructorsRouter.use(authenticate);

// List instructors
instructorsRouter.get('/', async (req, res, next) => {
  try {
    const { page, limit, skip, take, sort, order } = parsePaginationParams(req.query);
    const search = req.query.search as string | undefined;
    const isActive = req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined;
    const kind = req.query.kind as string | undefined; // 'instructor' | 'operations'

    const searchFilter = search
      ? {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { phone: { contains: search } },
          { email: { contains: search, mode: 'insensitive' as const } },
        ],
      }
      : undefined;
    const kindFilter = kind
      ? { kind }
      : {
        OR: [
          { kind: 'instructor' },
          {
            kind: 'operations',
            user: {
              role: 'operations_control' as const,
              isActive: true,
            },
          },
        ],
      };

    const where = {
      ...(searchFilter && { AND: [searchFilter, kindFilter] }),
      ...(!searchFilter && kindFilter),
      ...(isActive !== undefined && { isActive }),
    };

    const [instructors, total] = await Promise.all([
      prisma.instructor.findMany({
        where,
        include: {
          _count: { 
            select: { 
              cycles: true,
              meetings: true,
            } 
          },
        },
        orderBy: { [sort || 'name']: order === 'desc' ? 'desc' : 'asc' },
        skip,
        take,
      }),
      prisma.instructor.count({ where }),
    ]);

    // Attach file counts (generic file_attachments table — no Prisma relation)
    const instructorIds = instructors.map((i) => i.id);
    let fileCounts: Record<string, number> = {};
    if (instructorIds.length > 0) {
      const rows = await prisma.$queryRaw<{ entity_id: string; cnt: bigint }[]>`
        SELECT entity_id, COUNT(*) AS cnt
        FROM file_attachments
        WHERE entity_type = 'instructor' AND entity_id = ANY(${instructorIds})
        GROUP BY entity_id
      `;
      rows.forEach((r) => { fileCounts[r.entity_id] = Number(r.cnt); });
    }

    const enriched = instructors.map((i) => ({
      ...i,
      _count: { ...i._count, files: fileCounts[i.id] || 0 },
    }));

    res.json(paginatedResponse(enriched, total, page, limit));
  } catch (error) {
    next(error);
  }
});

// Get instructor by ID
instructorsRouter.get('/:id', async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);

    const instructor = await prisma.instructor.findUnique({
      where: { id },
      include: {
        user: {
          select: { id: true, email: true, role: true },
        },
        cycles: {
          where: { status: 'active' },
          include: {
            course: { select: { id: true, name: true } },
            branch: { select: { id: true, name: true } },
            _count: { select: { registrations: true } },
          },
        },
      },
    });

    if (!instructor) {
      throw new AppError(404, 'Instructor not found');
    }

    res.json(instructor);
  } catch (error) {
    next(error);
  }
});

// Create instructor
instructorsRouter.post('/', operationsManagerOrAdmin, async (req, res, next) => {
  try {
    const data = createInstructorSchema.parse(req.body);

    const instructor = await prisma.instructor.create({
      data: {
        name: data.name,
        phone: data.phone,
        email: data.email,
        city: data.city,
        kind: data.kind || 'instructor',
        rateFrontal: data.rateFrontal,
        rateOnline: data.rateOnline,
        ratePrivate: data.ratePrivate,
        ratePreparation: data.ratePreparation,
        hourlyRate: data.hourlyRate,
        employmentType: data.employmentType || 'freelancer',
        userId: data.userId,
        isActive: data.isActive,
        notes: data.notes,
        bankName: data.bankName,
        bankBranch: data.bankBranch,
        accountNumber: data.accountNumber,
      },
    });

    // Audit log
    await logAudit({
      action: 'CREATE',
      entity: 'Instructor',
      entityId: instructor.id,
      newValue: {
        name: instructor.name,
        phone: instructor.phone,
        email: instructor.email,
        rateFrontal: Number(instructor.rateFrontal),
        rateOnline: Number(instructor.rateOnline),
        employmentType: instructor.employmentType,
        isActive: instructor.isActive,
      },
      req,
    });

    res.status(201).json(instructor);
  } catch (error) {
    next(error);
  }
});

// Update instructor
instructorsRouter.put('/:id', operationsManagerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const data = updateInstructorSchema.parse(req.body);

    // Get existing instructor for audit
    const existingInstructor = await prisma.instructor.findUnique({ where: { id } });
    if (!existingInstructor) throw new AppError(404, 'Instructor not found');

    const instructor = await prisma.instructor.update({
      where: { id },
      data,
    });

    // Audit log
    const oldRecord = {
      name: existingInstructor.name,
      phone: existingInstructor.phone,
      email: existingInstructor.email,
      rateFrontal: Number(existingInstructor.rateFrontal),
      rateOnline: Number(existingInstructor.rateOnline),
      ratePrivate: Number(existingInstructor.ratePrivate),
      employmentType: existingInstructor.employmentType,
      isActive: existingInstructor.isActive,
    };
    const newRecord = {
      name: instructor.name,
      phone: instructor.phone,
      email: instructor.email,
      rateFrontal: Number(instructor.rateFrontal),
      rateOnline: Number(instructor.rateOnline),
      ratePrivate: Number(instructor.ratePrivate),
      employmentType: instructor.employmentType,
      isActive: instructor.isActive,
    };
    await logUpdateAudit({
      entity: 'Instructor',
      entityId: id,
      oldRecord,
      newRecord,
      req,
    });

    res.json(instructor);
  } catch (error) {
    next(error);
  }
});

// Delete instructor
instructorsRouter.delete('/:id', operationsManagerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);

    // Get instructor for audit
    const instructor = await prisma.instructor.findUnique({ where: { id } });
    if (!instructor) throw new AppError(404, 'Instructor not found');

    // Check for active cycles
    const activeCycles = await prisma.cycle.count({
      where: { instructorId: id, status: 'active' },
    });

    if (activeCycles > 0) {
      throw new AppError(400, `לא ניתן למחוק מדריך עם ${activeCycles} מחזורים פעילים`);
    }

    // Check for any meetings (completed or scheduled)
    const meetingsCount = await prisma.meeting.count({
      where: { instructorId: id },
    });

    if (meetingsCount > 0) {
      throw new AppError(400, `לא ניתן למחוק מדריך עם ${meetingsCount} פגישות במערכת. יש להעביר את הפגישות למדריך אחר קודם`);
    }

    // Check for any cycles (even inactive)
    const cyclesCount = await prisma.cycle.count({
      where: { instructorId: id },
    });

    if (cyclesCount > 0) {
      throw new AppError(400, `לא ניתן למחוק מדריך עם ${cyclesCount} מחזורים במערכת. יש להעביר את המחזורים למדריך אחר קודם`);
    }

    // Audit log before delete
    await logAudit({
      action: 'DELETE',
      entity: 'Instructor',
      entityId: id,
      oldValue: {
        name: instructor.name,
        phone: instructor.phone,
        email: instructor.email,
        rateFrontal: Number(instructor.rateFrontal),
        rateOnline: Number(instructor.rateOnline),
        employmentType: instructor.employmentType,
      },
      req,
    });

    await prisma.instructor.delete({
      where: { id },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Bulk update instructors
instructorsRouter.post('/bulk-update', operationsManagerOrAdmin, async (req, res, next) => {
  try {
    const { instructorIds, data } = req.body;
    
    if (!Array.isArray(instructorIds) || instructorIds.length === 0) {
      throw new AppError(400, 'instructorIds must be a non-empty array');
    }
    
    // Validate data - only allow certain fields for bulk update
    const allowedFields = ['employmentType', 'isActive'];
    const updateData: Record<string, any> = {};
    
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updateData[field] = data[field];
      }
    }
    
    if (Object.keys(updateData).length === 0) {
      throw new AppError(400, 'No valid fields to update');
    }
    
    // Update all instructors
    const result = await prisma.instructor.updateMany({
      where: { id: { in: instructorIds } },
      data: updateData,
    });
    
    res.json({ 
      success: true, 
      updated: result.count,
      message: `עודכנו ${result.count} מדריכים`
    });
  } catch (error) {
    next(error);
  }
});

// ==================== Fixed monthly additions (תוספות קבועות) ====================

const monthField = z.string().regex(MONTH_REGEX, 'חודש חייב להיות בפורמט YYYY-MM');

const fixedAdditionBaseSchema = z.object({
  description: z.string().trim().min(1, 'תיאור הוא שדה חובה').max(200),
  amount: z.coerce.number().positive('הסכום חייב להיות גדול מ-0').max(1_000_000),
  isNet: z.boolean().default(true),
  startMonth: monthField,
  endMonth: monthField.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

const endNotBeforeStart = (d: { startMonth?: string; endMonth?: string | null }) =>
  !d.startMonth || !d.endMonth || d.endMonth >= d.startMonth;
const endBeforeStartError = { message: 'חודש סיום חייב להיות זהה או מאוחר מחודש ההתחלה', path: ['endMonth'] };

export const createFixedAdditionSchema = fixedAdditionBaseSchema.refine(endNotBeforeStart, endBeforeStartError);
export const updateFixedAdditionSchema = fixedAdditionBaseSchema.partial().refine(endNotBeforeStart, endBeforeStartError);

type FixedAdditionRow = {
  id: string;
  instructorId: string;
  description: string;
  amount: { toString(): string };
  isNet: boolean;
  startMonth: Date;
  endMonth: Date | null;
  notes: string | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const serializeFixedAddition = (a: FixedAdditionRow) => {
  const currentMonth = dateToMonth(new Date());
  const endMonth = a.endMonth ? dateToMonth(a.endMonth) : null;
  const startMonth = dateToMonth(a.startMonth);
  return {
    id: a.id,
    instructorId: a.instructorId,
    description: a.description,
    amount: Number(a.amount.toString()),
    isNet: a.isNet,
    startMonth,
    endMonth,
    notes: a.notes,
    createdById: a.createdById,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    status: endMonth && endMonth < currentMonth ? 'ended' : startMonth > currentMonth ? 'future' : 'active',
  };
};

const auditFixedAddition = (a: FixedAdditionRow) => ({
  instructorId: a.instructorId,
  description: a.description,
  amount: Number(a.amount.toString()),
  isNet: a.isNet,
  startMonth: dateToMonth(a.startMonth),
  endMonth: a.endMonth ? dateToMonth(a.endMonth) : null,
  notes: a.notes,
});

const findFixedAdditionOr404 = async (instructorId: string, additionId: string) => {
  const existing = await prisma.instructorFixedAddition.findFirst({
    where: { id: additionId, instructorId, deletedAt: null },
  });
  if (!existing) throw new AppError(404, 'Fixed addition not found');
  return existing;
};

// List fixed additions for an instructor
instructorsRouter.get('/:id/fixed-additions', operationsManagerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const additions = await prisma.instructorFixedAddition.findMany({
      where: { instructorId: id, deletedAt: null },
      orderBy: [{ startMonth: 'desc' }, { createdAt: 'desc' }],
    });
    res.json(additions.map(serializeFixedAddition));
  } catch (error) {
    next(error);
  }
});

// Create fixed addition
instructorsRouter.post('/:id/fixed-additions', operationsManagerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const data = createFixedAdditionSchema.parse(req.body);

    const instructor = await prisma.instructor.findUnique({ where: { id }, select: { id: true } });
    if (!instructor) throw new AppError(404, 'Instructor not found');

    const created = await prisma.instructorFixedAddition.create({
      data: {
        instructorId: id,
        description: data.description,
        amount: data.amount,
        isNet: data.isNet,
        startMonth: monthToDate(data.startMonth),
        endMonth: data.endMonth ? monthToDate(data.endMonth) : null,
        notes: data.notes || null,
        createdById: req.user?.userId ?? null,
      },
    });

    await logAudit({
      action: 'CREATE',
      entity: 'InstructorFixedAddition',
      entityId: created.id,
      newValue: auditFixedAddition(created),
      req,
    });

    res.status(201).json(serializeFixedAddition(created));
  } catch (error) {
    next(error);
  }
});

// Update fixed addition (also used to "end" an addition by setting endMonth)
instructorsRouter.put('/:id/fixed-additions/:additionId', operationsManagerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const additionId = uuidSchema.parse(req.params.additionId);
    const data = updateFixedAdditionSchema.parse(req.body);
    const existing = await findFixedAdditionOr404(id, additionId);

    const startMonth = data.startMonth ?? dateToMonth(existing.startMonth);
    const endMonth = data.endMonth !== undefined
      ? data.endMonth
      : (existing.endMonth ? dateToMonth(existing.endMonth) : null);
    if (endMonth && endMonth < startMonth) {
      throw new AppError(400, 'חודש סיום חייב להיות זהה או מאוחר מחודש ההתחלה');
    }

    const updated = await prisma.instructorFixedAddition.update({
      where: { id: additionId },
      data: {
        ...(data.description !== undefined && { description: data.description }),
        ...(data.amount !== undefined && { amount: data.amount }),
        ...(data.isNet !== undefined && { isNet: data.isNet }),
        ...(data.startMonth !== undefined && { startMonth: monthToDate(data.startMonth) }),
        ...(data.endMonth !== undefined && { endMonth: data.endMonth ? monthToDate(data.endMonth) : null }),
        ...(data.notes !== undefined && { notes: data.notes || null }),
      },
    });

    await logUpdateAudit({
      entity: 'InstructorFixedAddition',
      entityId: additionId,
      oldRecord: auditFixedAddition(existing),
      newRecord: auditFixedAddition(updated),
      req,
    });

    res.json(serializeFixedAddition(updated));
  } catch (error) {
    next(error);
  }
});

// Delete fixed addition (soft delete)
instructorsRouter.delete('/:id/fixed-additions/:additionId', operationsManagerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const additionId = uuidSchema.parse(req.params.additionId);
    const existing = await findFixedAdditionOr404(id, additionId);

    await prisma.instructorFixedAddition.update({
      where: { id: additionId },
      data: { deletedAt: new Date(), deletedBy: req.user?.userId ?? null },
    });

    await logAudit({
      action: 'DELETE',
      entity: 'InstructorFixedAddition',
      entityId: additionId,
      oldValue: auditFixedAddition(existing),
      req,
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Get instructor's meetings
instructorsRouter.get('/:id/meetings', async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const status = req.query.status as string | undefined;

    const where = {
      instructorId: id,
      ...(from && to && {
        scheduledDate: {
          gte: new Date(from),
          lte: new Date(to),
        },
      }),
      ...(status && { status: status as any }),
    };

    const meetings = await prisma.meeting.findMany({
      where,
      include: {
        cycle: {
          include: {
            course: { select: { id: true, name: true } },
            branch: { select: { id: true, name: true } },
          },
        },
        _count: { select: { attendance: true } },
      },
      orderBy: { scheduledDate: 'asc' },
    });

    res.json(meetings);
  } catch (error) {
    next(error);
  }
});

// Get instructor's schedule (today/this week)
instructorsRouter.get('/:id/schedule', async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const date = req.query.date as string | undefined;
    
    const targetDate = date ? new Date(date) : new Date();
    const startOfWeek = new Date(targetDate);
    startOfWeek.setDate(targetDate.getDate() - targetDate.getDay());
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);

    const meetings = await prisma.meeting.findMany({
      where: {
        instructorId: id,
        scheduledDate: {
          gte: startOfWeek,
          lte: endOfWeek,
        },
      },
      include: {
        cycle: {
          include: {
            course: { select: { name: true } },
            branch: { select: { name: true, address: true } },
            registrations: {
              where: { status: { in: ['registered', 'active'] } },
              select: { id: true },
            },
          },
        },
      },
      orderBy: [
        { scheduledDate: 'asc' },
        { startTime: 'asc' },
      ],
    });

    res.json(meetings);
  } catch (error) {
    next(error);
  }
});

// Generate invite for instructor
instructorsRouter.post('/:id/invite', operationsManagerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);

    const instructor = await prisma.instructor.findUnique({
      where: { id },
    });

    if (!instructor) {
      throw new AppError(404, 'Instructor not found');
    }

    if (instructor.userId) {
      throw new AppError(400, 'Instructor already has a user account');
    }

    if (!instructor.email && !instructor.phone) {
      throw new AppError(400, 'Instructor must have email or phone to receive invite');
    }

    // Generate invite token (valid for 7 days)
    const inviteToken = crypto.randomBytes(32).toString('hex');
    const inviteExpiresAt = new Date();
    inviteExpiresAt.setDate(inviteExpiresAt.getDate() + 7);

    await prisma.instructor.update({
      where: { id },
      data: {
        inviteToken,
        inviteExpiresAt,
      },
    });

    // Generate invite URL (don't use "*" which is for CORS)
    const envUrl = process.env.FRONTEND_URL;
    const baseUrl = (envUrl && envUrl !== '*') ? envUrl : 'https://crm.orma-ai.com';
    const inviteUrl = `${baseUrl}/invite/${inviteToken}`;

    res.json({
      success: true,
      inviteUrl,
      expiresAt: inviteExpiresAt,
      instructor: {
        id: instructor.id,
        name: instructor.name,
        email: instructor.email,
        phone: instructor.phone,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Reset password for instructor (admin only)
instructorsRouter.post('/:id/reset-password', operationsManagerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);

    const instructor = await prisma.instructor.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!instructor) {
      throw new AppError(404, 'Instructor not found');
    }

    if (!instructor.userId || !instructor.user) {
      throw new AppError(400, 'Instructor does not have a user account yet. Use invite instead.');
    }

    if (!instructor.email) {
      throw new AppError(400, 'Instructor must have email to reset password');
    }

    // Generate reset token (valid for 24 hours)
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpiresAt = new Date();
    resetExpiresAt.setHours(resetExpiresAt.getHours() + 24);

    // Store reset token on instructor (reusing invite fields)
    await prisma.instructor.update({
      where: { id },
      data: {
        inviteToken: resetToken,
        inviteExpiresAt: resetExpiresAt,
      },
    });

    // Generate reset URL (don't use "*" which is for CORS)
    const envUrl = process.env.FRONTEND_URL;
    const baseUrl = (envUrl && envUrl !== '*') ? envUrl : 'https://crm.orma-ai.com';
    const resetUrl = `${baseUrl}/reset-password/${resetToken}`;

    res.json({
      success: true,
      resetUrl,
      expiresAt: resetExpiresAt,
      instructor: {
        id: instructor.id,
        name: instructor.name,
        email: instructor.email,
      },
    });
  } catch (error) {
    next(error);
  }
});
