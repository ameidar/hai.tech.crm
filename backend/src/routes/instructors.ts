import { Router } from 'express';
import crypto from 'crypto';
import { prisma } from '../utils/prisma.js';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { createInstructorSchema, updateInstructorSchema, paginationSchema, uuidSchema } from '../types/schemas.js';

export const instructorsRouter = Router();

instructorsRouter.use(authenticate);

// List instructors
instructorsRouter.get('/', async (req, res, next) => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
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
              cycles: { where: { status: 'active' } },
              meetings: { where: { status: 'scheduled' } },
            } 
          },
        },
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.instructor.count({ where }),
    ]);

    res.json({
      data: instructors,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
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
        userId: data.userId,
        isActive: data.isActive,
        notes: data.notes,
      },
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

    const instructor = await prisma.instructor.update({
      where: { id },
      data,
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

    const activeCycles = await prisma.cycle.count({
      where: { instructorId: id, status: 'active' },
    });

    if (activeCycles > 0) {
      throw new AppError(400, 'Cannot delete instructor with active cycles');
    }

    await prisma.instructor.delete({
      where: { id },
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

    // Generate invite URL
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
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

