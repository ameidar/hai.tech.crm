import { Router } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { createCycleSchema, updateCycleSchema, createRegistrationSchema, paginationSchema, uuidSchema, bulkUpdateCyclesSchema } from '../types/schemas.js';
import { fetchHolidays, dayNameToNumber, calculateCycleEndDate } from '../utils/holidays.js';
import { config } from '../config.js';
import { zoomService } from '../services/zoom.js';
import { logAudit, logUpdateAudit } from '../utils/audit.js';

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
      callbackUrl: `${(process.env.FRONTEND_URL && process.env.FRONTEND_URL !== '*') ? process.env.FRONTEND_URL : 'http://129.159.133.209:3002'}/api/webhook/cycles/${cycleId}/zoom`,
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

    const totalPages = Math.ceil(total / limit);
    res.json({
      data: cycles,
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

// Count cycles
cyclesRouter.get('/count', async (req, res, next) => {
  try {
    const status = req.query.status as string | undefined;
    const branchId = req.query.branchId as string | undefined;

    const where = {
      ...(status && { status: status as any }),
      ...(branchId && { branchId }),
    };

    const total = await prisma.cycle.count({ where });
    res.json({ total });
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
        revenueIncludesVat: data.revenueIncludesVat,
        studentCount: data.studentCount,
        maxStudents: data.maxStudents,
        sendParentReminders: data.sendParentReminders,
        isOnline: data.activityType === 'online',
        activityType: data.activityType,
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

    // Audit log for cycle creation
    await logAudit({
      action: 'CREATE',
      entity: 'Cycle',
      entityId: cycle.id,
      newValue: {
        name: cycle.name,
        courseName: cycle.course?.name,
        branchName: cycle.branch?.name,
        instructorName: cycle.instructor?.name,
        type: cycle.type,
        startDate: cycle.startDate,
        totalMeetings: cycle.totalMeetings,
        meetingRevenue: Number(cycle.meetingRevenue),
      },
      req,
    });

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

    // Get existing cycle for audit comparison
    const existingCycle = await prisma.cycle.findUnique({
      where: { id },
      include: {
        course: { select: { name: true } },
        branch: { select: { name: true } },
        instructor: { select: { name: true } },
      },
    });
    if (!existingCycle) throw new AppError(404, 'Cycle not found');

    const updateData: any = { ...data };
    
    if (data.startDate) updateData.startDate = new Date(data.startDate);
    if (data.endDate) updateData.endDate = new Date(data.endDate);
    if (data.startTime) updateData.startTime = new Date(`1970-01-01T${data.startTime}:00Z`);
    if (data.endTime) updateData.endTime = new Date(`1970-01-01T${data.endTime}:00Z`);

    // If totalMeetings or completedMeetings changed, recalculate remainingMeetings
    if (data.totalMeetings !== undefined || data.completedMeetings !== undefined) {
      const newTotal = data.totalMeetings ?? existingCycle.totalMeetings;
      const newCompleted = data.completedMeetings ?? existingCycle.completedMeetings;
      updateData.remainingMeetings = newTotal - newCompleted;
    }

    // Check if we need to regenerate meetings
    const regenerateMeetings = (req.body as any).regenerateMeetings === true;
    
    // Remove regenerateMeetings from updateData as it's not a Cycle field
    delete updateData.regenerateMeetings;

    const cycle = await prisma.cycle.update({
      where: { id },
      data: updateData,
      include: {
        course: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        instructor: { select: { id: true, name: true } },
      },
    });

    // Audit log for cycle update
    const oldRecord = {
      name: existingCycle.name,
      status: existingCycle.status,
      type: existingCycle.type,
      courseName: existingCycle.course?.name,
      branchName: existingCycle.branch?.name,
      instructorName: existingCycle.instructor?.name,
      startDate: existingCycle.startDate,
      endDate: existingCycle.endDate,
      dayOfWeek: existingCycle.dayOfWeek,
      totalMeetings: existingCycle.totalMeetings,
      meetingRevenue: Number(existingCycle.meetingRevenue),
      pricePerStudent: Number(existingCycle.pricePerStudent),
      studentCount: existingCycle.studentCount,
      activityType: existingCycle.activityType,
    };
    const newRecord = {
      name: cycle.name,
      status: cycle.status,
      type: cycle.type,
      courseName: cycle.course?.name,
      branchName: cycle.branch?.name,
      instructorName: cycle.instructor?.name,
      startDate: cycle.startDate,
      endDate: cycle.endDate,
      dayOfWeek: cycle.dayOfWeek,
      totalMeetings: cycle.totalMeetings,
      meetingRevenue: Number(cycle.meetingRevenue),
      pricePerStudent: Number(cycle.pricePerStudent),
      studentCount: cycle.studentCount,
      activityType: cycle.activityType,
    };
    await logUpdateAudit({
      entity: 'Cycle',
      entityId: id,
      oldRecord,
      newRecord,
      req,
    });

    // If regenerateMeetings flag is set, delete all non-completed meetings and regenerate
    if (regenerateMeetings) {
      // Delete only scheduled/postponed meetings (not completed or cancelled)
      await prisma.meeting.deleteMany({
        where: {
          cycleId: id,
          status: { in: ['scheduled', 'postponed'] },
        },
      });

      // Reset cycle counters
      const completedCount = await prisma.meeting.count({
        where: { cycleId: id, status: 'completed' },
      });
      
      await prisma.cycle.update({
        where: { id },
        data: {
          completedMeetings: completedCount,
          remainingMeetings: cycle.totalMeetings - completedCount,
        },
      });

      // Regenerate meetings from new start date
      await generateMeetingsForCycle(id);
    }

    res.json(cycle);
  } catch (error) {
    next(error);
  }
});

// Delete cycle
cyclesRouter.delete('/:id', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const userId = req.user?.userId;
    const userName = req.user?.email;

    // Get cycle with meetings before deletion for audit
    const cycle = await prisma.cycle.findUnique({
      where: { id },
      include: {
        meetings: {
          select: {
            id: true,
            zoomMeetingId: true,
            scheduledDate: true,
            status: true,
          }
        },
        course: { select: { name: true } },
        instructor: { select: { name: true } },
        branch: { select: { name: true } },
      }
    });

    if (!cycle) {
      throw new AppError(404, 'Cycle not found');
    }

    // Get unique Zoom meeting IDs to delete
    const zoomMeetingIds = [...new Set(
      cycle.meetings
        .filter(m => m.zoomMeetingId)
        .map(m => m.zoomMeetingId!)
    )];

    // Create audit log entry
    await prisma.auditLog.create({
      data: {
        userId,
        userName,
        action: 'DELETE',
        entity: 'Cycle',
        entityId: id,
        oldValue: {
          name: cycle.name,
          courseName: cycle.course?.name,
          instructorName: cycle.instructor?.name,
          branchName: cycle.branch?.name,
          meetingCount: cycle.meetings.length,
          zoomMeetingIds,
          meetings: cycle.meetings.map(m => ({
            date: m.scheduledDate,
            status: m.status,
            zoomMeetingId: m.zoomMeetingId
          }))
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      }
    });

    // Delete related records before the cycle
    await prisma.cancellationRequest.deleteMany({
      where: { registration: { cycleId: id } },
    });
    await prisma.attendance.deleteMany({
      where: { meeting: { cycleId: id } },
    });
    await prisma.registration.deleteMany({
      where: { cycleId: id },
    });
    await prisma.meeting.deleteMany({
      where: { cycleId: id },
    });
    await prisma.cycleExpense.deleteMany({
      where: { cycleId: id },
    });

    // Delete the cycle
    await prisma.cycle.delete({
      where: { id },
    });

    console.log(`[Cycle Delete] Deleted cycle ${cycle.name} (${id}) with ${cycle.meetings.length} meetings`);

    // Delete Zoom meetings in background (fire and forget)
    if (zoomMeetingIds.length > 0) {
      setImmediate(async () => {
        for (const zoomMeetingId of zoomMeetingIds) {
          try {
            await zoomService.deleteMeeting(zoomMeetingId);
            console.log(`[Cycle Delete] Deleted Zoom meeting ${zoomMeetingId}`);
          } catch (error: any) {
            // Log but don't fail - Zoom meeting might already be deleted
            console.error(`[Cycle Delete] Failed to delete Zoom meeting ${zoomMeetingId}:`, error.message);
          }
        }
        console.log(`[Cycle Delete] Finished background cleanup of ${zoomMeetingIds.length} Zoom meetings`);
      });
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Generate meetings for a cycle
cyclesRouter.post('/:id/generate-meetings', managerOrAdmin, async (req, res, next) => {
  try {
    const cycleId = req.params.id;

    // Check if cycle exists
    const cycle = await prisma.cycle.findUnique({
      where: { id: cycleId },
      include: { meetings: true }
    });

    if (!cycle) {
      throw new AppError(404, 'Cycle not found');
    }
    
    // Calculate how many new meetings to generate
    const meetingsToGenerate = cycle.totalMeetings - cycle.meetings.length;

    if (meetingsToGenerate <= 0) {
      return res.json({ 
        message: 'כל הפגישות כבר קיימות',
        generated: 0,
        total: cycle.meetings.length
      });
    }

    // Generate the new meetings
    await generateMeetingsForCycle(cycleId);

    // Get updated cycle
    const updatedCycle = await prisma.cycle.findUnique({
      where: { id: cycleId },
      include: { meetings: true }
    });

    res.json({ 
      message: `נוצרו ${meetingsToGenerate} פגישות חדשות`,
      generated: meetingsToGenerate,
      total: updatedCycle?.meetings.length || 0
    });
  } catch (error) {
    next(error);
  }
});

// Bulk generate meetings for multiple cycles
cyclesRouter.post('/bulk-generate-meetings', managerOrAdmin, async (req, res, next) => {
  try {
    const { ids } = req.body as { ids: string[] };

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      throw new AppError(400, 'Invalid cycle IDs');
    }

    interface GenerateResult {
      cycleId: string;
      name?: string;
      success: boolean;
      generated?: number;
      message?: string;
      error?: string;
    }

    const results: GenerateResult[] = [];
    
    for (const cycleId of ids) {
      try {
        const cycle = await prisma.cycle.findUnique({
          where: { id: cycleId },
          include: { meetings: true }
        });

        if (!cycle) {
          results.push({ cycleId, success: false, error: 'Cycle not found' });
          continue;
        }

        const meetingsToGenerate = cycle.totalMeetings - cycle.meetings.length;

        if (meetingsToGenerate <= 0) {
          results.push({ cycleId, name: cycle.name, success: true, generated: 0, message: 'Already has all meetings' });
          continue;
        }

        await generateMeetingsForCycle(cycleId);
        results.push({ cycleId, name: cycle.name, success: true, generated: meetingsToGenerate });
      } catch (err: any) {
        results.push({ cycleId, success: false, error: err.message });
      }
    }

    const totalGenerated = results.filter(r => r.success).reduce((sum, r) => sum + (r.generated || 0), 0);
    const successCount = results.filter(r => r.success).length;

    res.json({
      message: `נוצרו פגישות ל-${successCount} מחזורים`,
      totalGenerated,
      results
    });
  } catch (error) {
    next(error);
  }
});

// Bulk update cycles
cyclesRouter.post('/bulk-update', managerOrAdmin, async (req, res, next) => {
  try {
    const { ids, data } = bulkUpdateCyclesSchema.parse(req.body);

    // Build update data, filtering out undefined values
    const updateData: Record<string, any> = {};
    
    if (data.status !== undefined) updateData.status = data.status;
    if (data.instructorId !== undefined) updateData.instructorId = data.instructorId;
    if (data.courseId !== undefined) updateData.courseId = data.courseId;
    if (data.branchId !== undefined) updateData.branchId = data.branchId;
    if (data.meetingRevenue !== undefined) updateData.meetingRevenue = data.meetingRevenue;
    if (data.revenueIncludesVat !== undefined) updateData.revenueIncludesVat = data.revenueIncludesVat;
    if (data.pricePerStudent !== undefined) updateData.pricePerStudent = data.pricePerStudent;
    if (data.studentCount !== undefined) updateData.studentCount = data.studentCount;
    if (data.sendParentReminders !== undefined) updateData.sendParentReminders = data.sendParentReminders;
    if (data.activityType !== undefined) {
      updateData.activityType = data.activityType;
      updateData.isOnline = data.activityType === 'online';
    }

    // Update all cycles in a transaction
    const results = await prisma.$transaction(
      ids.map(id => 
        prisma.cycle.update({
          where: { id },
          data: updateData,
          select: { id: true, name: true },
        })
      )
    );

    res.json({
      message: `עודכנו ${results.length} מחזורים בהצלחה`,
      updated: results,
    });
  } catch (error) {
    next(error);
  }
});

// Get cycle's meetings
cyclesRouter.get('/:id/meetings', async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);

    // Get cycle info for totalMeetings
    const cycle = await prisma.cycle.findUnique({
      where: { id },
      select: { totalMeetings: true },
    });

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

    // Get total cycle expenses
    const cycleExpenses = await prisma.cycleExpense.aggregate({
      where: { cycleId: id },
      _sum: { amount: true },
    });
    
    const totalCycleExpenses = Number(cycleExpenses._sum.amount || 0);
    const totalMeetings = cycle?.totalMeetings || 1;
    const cycleExpensePerMeeting = totalCycleExpenses / totalMeetings;
    
    // Add adjusted profit to each meeting
    const meetingsWithAdjustedProfit = meetings.map(meeting => {
      const baseProfit = Number(meeting.profit || 0);
      const adjustedProfit = baseProfit - cycleExpensePerMeeting;
      
      return {
        ...meeting,
        adjustedProfit: Math.round(adjustedProfit * 100) / 100,
        cycleExpenseShare: Math.round(cycleExpensePerMeeting * 100) / 100,
      };
    });

    res.json(meetingsWithAdjustedProfit);
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

// Sync cycle progress from meetings table
cyclesRouter.post('/:id/sync-progress', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);

    // Get cycle
    const cycle = await prisma.cycle.findUnique({
      where: { id },
    });
    if (!cycle) throw new AppError(404, 'Cycle not found');

    // Count completed meetings from meetings table
    const completedMeetings = await prisma.meeting.count({
      where: {
        cycleId: id,
        status: 'completed',
      },
    });

    // Count total meetings from meetings table (for info only)
    const totalMeetingsFromTable = await prisma.meeting.count({
      where: { cycleId: id },
    });

    // totalMeetings is fixed (set by payment), only update completed/remaining
    const remainingMeetings = cycle.totalMeetings - completedMeetings;

    // Update cycle with synced values (don't change totalMeetings)
    const updated = await prisma.cycle.update({
      where: { id },
      data: {
        completedMeetings,
        remainingMeetings,
      },
      include: {
        course: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        instructor: { select: { id: true, name: true } },
      },
    });

    res.json({
      ...updated,
      synced: {
        completedMeetings,
        remainingMeetings,
        totalMeetings: cycle.totalMeetings,
        meetingsInTable: totalMeetingsFromTable,
      },
    });
  } catch (error) {
    next(error);
  }
});
