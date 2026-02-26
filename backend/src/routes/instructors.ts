import { Router } from 'express';
import crypto from 'crypto';
import { prisma } from '../utils/prisma.js';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { createInstructorSchema, updateInstructorSchema, uuidSchema } from '../types/schemas.js';
import { parsePaginationParams, paginatedResponse } from '../utils/pagination.js';
import { logAudit, logUpdateAudit } from '../utils/audit.js';

export const instructorsRouter = Router();

instructorsRouter.use(authenticate);

// List instructors
instructorsRouter.get('/', async (req, res, next) => {
  try {
    const { page, limit, skip, take, sort, order } = parsePaginationParams(req.query);
    const search = req.query.search as string | undefined;
    const isActive = req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined;

    const where = {
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { phone: { contains: search } },
          { email: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
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
instructorsRouter.post('/', managerOrAdmin, async (req, res, next) => {
  try {
    const data = createInstructorSchema.parse(req.body);

    const instructor = await prisma.instructor.create({
      data: {
        name: data.name,
        phone: data.phone,
        email: data.email,
        rateFrontal: data.rateFrontal,
        rateOnline: data.rateOnline,
        ratePreparation: data.ratePreparation,
        employmentType: data.employmentType || 'freelancer',
        userId: data.userId,
        isActive: data.isActive,
        notes: data.notes,
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
instructorsRouter.put('/:id', managerOrAdmin, async (req, res, next) => {
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
instructorsRouter.delete('/:id', managerOrAdmin, async (req, res, next) => {
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
instructorsRouter.post('/bulk-update', managerOrAdmin, async (req, res, next) => {
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
instructorsRouter.post('/:id/invite', managerOrAdmin, async (req, res, next) => {
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
instructorsRouter.post('/:id/reset-password', managerOrAdmin, async (req, res, next) => {
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

