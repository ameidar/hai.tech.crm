import { Router } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { createCycleSchema, updateCycleSchema, createRegistrationSchema, paginationSchema, uuidSchema } from '../types/schemas.js';
import { fetchHolidays, dayNameToNumber, calculateCycleEndDate } from '../utils/holidays.js';
import { config } from '../config.js';

// Trigger Zoom webhook when online cycle is created
async function triggerZoomWebhook(cycleId: string) {
  if (!config.zoomWebhookUrl) {
    console.log('No ZOOM_WEBHOOK_URL configured, skipping webhook');
    return;
  }

  try {
    const cycle = await prisma.cycle.findUnique({
      where: { id: cycleId },
      include: {
        course: { select: { name: true } },
        instructor: { select: { name: true, email: true } },
        meetings: {
          where: { status: 'scheduled' },
          orderBy: { scheduledDate: 'asc' },
          select: {
            id: true,
            scheduledDate: true,
            startTime: true,
            endTime: true,
          },
        },
      },
    });

    if (!cycle) return;

    const payload = {
      event: 'cycle.created.online',
      cycleId: cycle.id,
      cycleName: cycle.name,
      courseName: cycle.course.name,
      instructorName: cycle.instructor.name,
      instructorEmail: cycle.instructor.email,
      meetings: cycle.meetings.map(m => ({
        id: m.id,
        date: m.scheduledDate.toISOString().split('T')[0],
        startTime: m.startTime instanceof Date 
          ? m.startTime.toISOString().substring(11, 16) 
          : String(m.startTime).substring(0, 5),
        endTime: m.endTime instanceof Date 
          ? m.endTime.toISOString().substring(11, 16) 
          : String(m.endTime).substring(0, 5),
      })),
      callbackUrl: `${process.env.FRONTEND_URL || 'http://localhost:3001'}/api/webhook/cycles/${cycleId}/zoom`,
    };

    console.log('Triggering Zoom webhook:', config.zoomWebhookUrl);
    
    const response = await fetch(config.zoomWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error('Zoom webhook failed:', response.status, await response.text());
    } else {
      console.log('Zoom webhook triggered successfully');
    }
  } catch (error) {
    console.error('Error triggering Zoom webhook:', error);
  }
}

export const cyclesRouter = Router();

cyclesRouter.use(authenticate);

// Helper to generate meetings for a cycle (skips Israeli holidays)
async function generateMeetingsForCycle(cycleId: string) {
  const cycle = await prisma.cycle.findUnique({
    where: { id: cycleId },
  });

  if (!cycle) return;

  const meetings = [];
  const targetDay = dayNameToNumber(cycle.dayOfWeek);
  let currentDate = new Date(cycle.startDate);
  
  // Fetch holidays for relevant years
  const startYear = currentDate.getFullYear();
  const holidaysThisYear = await fetchHolidays(startYear);
  const holidaysNextYear = await fetchHolidays(startYear + 1);
  const allHolidays = new Set([...holidaysThisYear, ...holidaysNextYear]);
  
  // Find first occurrence of the target day
  while (currentDate.getDay() !== targetDay) {
    currentDate.setDate(currentDate.getDate() + 1);
  }

  // Generate meetings, skipping holidays
  let attempts = 0;
  const maxAttempts = cycle.totalMeetings * 3; // Safety limit
  
  while (meetings.length < cycle.totalMeetings && attempts < maxAttempts) {
    attempts++;
    const dateStr = currentDate.toISOString().split('T')[0];
    
    // Check if this date is a holiday
    if (!allHolidays.has(dateStr)) {
      meetings.push({
        cycleId: cycle.id,
        instructorId: cycle.instructorId,
        scheduledDate: new Date(currentDate),
        startTime: cycle.startTime,
        endTime: cycle.endTime,
        status: 'scheduled' as const,
      });
    }
    
    // Move to next week
    currentDate.setDate(currentDate.getDate() + 7);
  }

  if (meetings.length > 0) {
    await prisma.meeting.createMany({ data: meetings });
    
    // Update cycle end date based on last meeting
    const lastMeetingDate = meetings[meetings.length - 1].scheduledDate;
    await prisma.cycle.update({
      where: { id: cycleId },
      data: { 
        remainingMeetings: meetings.length,
        endDate: lastMeetingDate,
      },
    });
  }
}

// List cycles
cyclesRouter.get('/', async (req, res, next) => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const status = req.query.status as string | undefined;
    const type = req.query.type as string | undefined;
    const branchId = req.query.branchId as string | undefined;
    const instructorId = req.query.instructorId as string | undefined;
    const courseId = req.query.courseId as string | undefined;
    const dayOfWeek = req.query.dayOfWeek as string | undefined;
    const search = req.query.search as string | undefined;

    const where = {
      ...(status && { status: status as any }),
      ...(type && { type: type as any }),
      ...(branchId && { branchId }),
      ...(instructorId && { instructorId }),
      ...(courseId && { courseId }),
      ...(dayOfWeek && { dayOfWeek: dayOfWeek as any }),
      ...(search && { name: { contains: search, mode: 'insensitive' as const } }),
    };

    const [cycles, total] = await Promise.all([
      prisma.cycle.findMany({
        where,
        include: {
          course: { select: { id: true, name: true, category: true } },
          branch: { select: { id: true, name: true, type: true } },
          instructor: { select: { id: true, name: true } },
          institutionalOrder: { select: { id: true, orderNumber: true } },
          _count: { select: { registrations: true, meetings: true } },
        },
        orderBy: { startDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.cycle.count({ where }),
    ]);

    res.json({
      data: cycles,
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

// Get cycle by ID
cyclesRouter.get('/:id', async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);

    const cycle = await prisma.cycle.findUnique({
      where: { id },
      include: {
        course: true,
        branch: true,
        instructor: true,
        institutionalOrder: true,
        registrations: {
          include: {
            student: {
              include: {
                customer: { select: { id: true, name: true, phone: true } },
              },
            },
          },
        },
        meetings: {
          orderBy: { scheduledDate: 'asc' },
          include: {
            instructor: { select: { id: true, name: true } },
            _count: { select: { attendance: true } },
          },
        },
      },
    });

    if (!cycle) {
      throw new AppError(404, 'Cycle not found');
    }

    res.json(cycle);
  } catch (error) {
    next(error);
  }
});

// Create cycle
cyclesRouter.post('/', managerOrAdmin, async (req, res, next) => {
  try {
    const data = createCycleSchema.parse(req.body);

    // Verify all foreign keys exist
    const [course, branch, instructor] = await Promise.all([
      prisma.course.findUnique({ where: { id: data.courseId } }),
      prisma.branch.findUnique({ where: { id: data.branchId } }),
      prisma.instructor.findUnique({ where: { id: data.instructorId } }),
    ]);

    if (!course) throw new AppError(404, 'Course not found');
    if (!branch) throw new AppError(404, 'Branch not found');
    if (!instructor) throw new AppError(404, 'Instructor not found');

    if (data.institutionalOrderId) {
      const order = await prisma.institutionalOrder.findUnique({
        where: { id: data.institutionalOrderId },
      });
      if (!order) throw new AppError(404, 'Institutional order not found');
    }

    // Parse time strings to Date objects for Prisma
    const startTime = new Date(`1970-01-01T${data.startTime}:00Z`);
    const endTime = new Date(`1970-01-01T${data.endTime}:00Z`);

    // Calculate end date if not provided (based on meetings and holidays)
    let endDate: Date;
    if (data.endDate) {
      endDate = new Date(data.endDate);
    } else {
      // Calculate end date automatically, skipping holidays
      const targetDay = dayNameToNumber(data.dayOfWeek);
      const result = await calculateCycleEndDate(
        new Date(data.startDate),
        targetDay,
        data.totalMeetings
      );
      endDate = result.endDate;
    }

    const cycle = await prisma.cycle.create({
      data: {
        name: data.name,
        courseId: data.courseId,
        branchId: data.branchId,
        instructorId: data.instructorId,
        institutionalOrderId: data.institutionalOrderId,
        type: data.type,
        startDate: new Date(data.startDate),
        endDate,
        dayOfWeek: data.dayOfWeek,
        startTime,
        endTime,
        durationMinutes: data.durationMinutes,
        totalMeetings: data.totalMeetings,
        pricePerStudent: data.pricePerStudent,
        meetingRevenue: data.meetingRevenue,
        studentCount: data.studentCount,
        maxStudents: data.maxStudents,
        sendParentReminders: data.sendParentReminders,
        isOnline: data.isOnline,
        zoomHostId: data.zoomHostId,
        remainingMeetings: data.totalMeetings,
      },
      include: {
        course: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        instructor: { select: { id: true, name: true } },
      },
    });

    // Generate meetings
    await generateMeetingsForCycle(cycle.id);

    // Trigger Zoom webhook for online cycles
    if (cycle.isOnline) {
      // Run async - don't wait for it
      triggerZoomWebhook(cycle.id).catch(err => {
        console.error('Zoom webhook error:', err);
      });
    }

    res.status(201).json(cycle);
  } catch (error) {
    next(error);
  }
});

// Update cycle
cyclesRouter.put('/:id', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const data = updateCycleSchema.parse(req.body);

    const updateData: any = { ...data };
    
    if (data.startDate) updateData.startDate = new Date(data.startDate);
    if (data.endDate) updateData.endDate = new Date(data.endDate);
    if (data.startTime) updateData.startTime = new Date(`1970-01-01T${data.startTime}:00Z`);
    if (data.endTime) updateData.endTime = new Date(`1970-01-01T${data.endTime}:00Z`);

    // If totalMeetings or completedMeetings changed, recalculate remainingMeetings
    if (data.totalMeetings !== undefined || data.completedMeetings !== undefined) {
      const existingCycle = await prisma.cycle.findUnique({ where: { id } });
      if (existingCycle) {
        const newTotal = data.totalMeetings ?? existingCycle.totalMeetings;
        const newCompleted = data.completedMeetings ?? existingCycle.completedMeetings;
        updateData.remainingMeetings = newTotal - newCompleted;
      }
    }

    const cycle = await prisma.cycle.update({
      where: { id },
      data: updateData,
      include: {
        course: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        instructor: { select: { id: true, name: true } },
      },
    });

    res.json(cycle);
  } catch (error) {
    next(error);
  }
});

// Delete cycle
cyclesRouter.delete('/:id', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);

    await prisma.cycle.delete({
      where: { id },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Get cycle's meetings
cyclesRouter.get('/:id/meetings', async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);

    const meetings = await prisma.meeting.findMany({
      where: { cycleId: id },
      include: {
        instructor: { select: { id: true, name: true } },
        attendance: {
          include: {
            registration: {
              include: {
                student: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
      orderBy: { scheduledDate: 'asc' },
    });

    res.json(meetings);
  } catch (error) {
    next(error);
  }
});

// Get cycle's registrations
cyclesRouter.get('/:id/registrations', async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);

    const registrations = await prisma.registration.findMany({
      where: { cycleId: id },
      include: {
        student: {
          include: {
            customer: { select: { id: true, name: true, phone: true, email: true } },
          },
        },
      },
      orderBy: { registrationDate: 'desc' },
    });

    res.json(registrations);
  } catch (error) {
    next(error);
  }
});

// Add registration to cycle
cyclesRouter.post('/:id/registrations', managerOrAdmin, async (req, res, next) => {
  try {
    const cycleId = uuidSchema.parse(req.params.id);
    const data = createRegistrationSchema.parse({ ...req.body, cycleId });

    // Verify student exists
    const student = await prisma.student.findUnique({
      where: { id: data.studentId },
    });
    if (!student) throw new AppError(404, 'Student not found');

    // Check if already registered
    const existing = await prisma.registration.findUnique({
      where: {
        studentId_cycleId: {
          studentId: data.studentId,
          cycleId,
        },
      },
    });
    if (existing) throw new AppError(409, 'Student already registered for this cycle');

    const registration = await prisma.registration.create({
      data: {
        studentId: data.studentId,
        cycleId,
        registrationDate: data.registrationDate ? new Date(data.registrationDate) : new Date(),
        status: data.status,
        amount: data.amount,
        paymentStatus: data.paymentStatus,
        paymentMethod: data.paymentMethod,
        invoiceLink: data.invoiceLink,
        notes: data.notes,
      },
      include: {
        student: {
          include: {
            customer: { select: { id: true, name: true, phone: true } },
          },
        },
      },
    });

    res.status(201).json(registration);
  } catch (error) {
    next(error);
  }
});
