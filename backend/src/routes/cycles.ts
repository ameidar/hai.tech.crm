import { Router } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, cycleRosterOrAdmin, operationsManagerOrAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { createCycleSchema, updateCycleSchema, createRegistrationSchema, paginationSchema, uuidSchema, bulkUpdateCyclesSchema } from '../types/schemas.js';
import { fetchHolidays, dayNameToNumber, calculateCycleEndDate } from '../utils/holidays.js';
import { zoomService, getHostKeyByEmail } from '../services/zoom.js';
import { googleMeetService } from '../services/google-meet.js';
import { logAudit, logUpdateAudit } from '../utils/audit.js';
import { recalcMeetingRevenue } from '../utils/recalcMeetingRevenue.js';
import { meetingRevenueFromRegistrations, netAmount, revenueRegistrations, roundMoney } from '../utils/revenue.js';
import { recalculateInstructorPaymentsForCycle } from '../services/instructor-payment.js';
import { checkAndSendInstitutionalOrderCompletionAlert } from '../services/institutional-order-completion-alert.js';
import { assertMeetingNotInIssuedPeriod } from '../services/billing-lock.js';
import { resolveRegistrationAmountForCycle } from '../utils/registration-amount.js';
import { findDuplicateMeetingWarnings, type MeetingDuplicateWarning } from '../services/meeting-duplicate-warning.js';

// Make.com webhook removed — Zoom recordings handled directly via /api/zoom-webhook

export const cyclesRouter = Router();

cyclesRouter.use(authenticate);

// Helper: compute expected revenue per meeting for any cycle type
function computeRevenuePerMeeting(cycle: any): number {
  const totalMeetings = Number(cycle.totalMeetings) || 1;
  if (cycle.type === 'institutional_fixed') {
    return Number(cycle.meetingRevenue || 0);
  }
  if (cycle.type === 'institutional_per_child') {
    const count = cycle.studentCount || (cycle.registrations?.length ?? cycle._count?.registrations ?? 0);
    return roundMoney(Number(cycle.pricePerStudent || 0) * count);
  }
  if (cycle.type === 'private' || cycle.type === 'trial_private') {
    // Priority: explicit meetingRevenue > registration amounts / meetings.
    // pricePerStudent is reserved for institutional_per_child.
    if (cycle.meetingRevenue && Number(cycle.meetingRevenue) > 0) return Number(cycle.meetingRevenue);
    // Sum revenue-bearing registration amounts (available in detail endpoint)
    if (Array.isArray(cycle.registrations) && cycle.registrations.length > 0) {
      return meetingRevenueFromRegistrations(revenueRegistrations(cycle.registrations), totalMeetings, cycle.type);
    }
    // Fallback: aggregated sum if available (list endpoint — already filtered to active)
    if (cycle._sum?.registrations?.amount) {
      return totalMeetings > 0
        ? roundMoney(netAmount(Number(cycle._sum.registrations.amount), cycle.type) / totalMeetings)
        : 0;
    }
  }
  return 0;
}

const AUTO_REGENERATED_MEETING_STATUSES = [
  'scheduled',
  'postponed',
  'pending_cancellation',
  'pending_postponement',
] as const;

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

// Helper to generate meetings for a cycle (skips Israeli holidays)
async function generateMeetingsForCycle(cycleId: string, fromDate?: Date, targetCount?: number) {
  const cycle = await prisma.cycle.findUnique({
    where: { id: cycleId },
    include: {
      meetings: {
        where: { deletedAt: null },
        select: { id: true, scheduledDate: true, status: true },
      },
    },
  });

  if (!cycle) return { created: 0, duplicateMeetingWarnings: [] as MeetingDuplicateWarning[] };

  const meetings = [];
  const targetDay = dayNameToNumber(cycle.dayOfWeek);
  let currentDate: Date;
  if (fromDate) {
    currentDate = new Date(fromDate);
  } else if (cycle.meetings.length > 0) {
    const lastMeeting = cycle.meetings.reduce((latest, meeting) =>
      meeting.scheduledDate.getTime() > latest.scheduledDate.getTime() ? meeting : latest
    );
    currentDate = addDays(lastMeeting.scheduledDate, 7);
  } else {
    currentDate = new Date(cycle.startDate);
  }
  
  // How many meetings to generate. Existing callers that do not pass targetCount
  // should fill only the missing meetings, not create another full cycle.
  const meetingsToGenerate = targetCount ?? Math.max(0, cycle.totalMeetings - cycle.meetings.length);
  if (meetingsToGenerate <= 0) return { created: 0, duplicateMeetingWarnings: [] as MeetingDuplicateWarning[] };

  // Fetch holidays for relevant years
  const startYear = currentDate.getFullYear();
  const holidaysThisYear = await fetchHolidays(startYear);
  const holidaysNextYear = await fetchHolidays(startYear + 1);
  const allHolidays = new Set([...holidaysThisYear, ...holidaysNextYear]);
  
  // Find first occurrence of the target day on or after fromDate
  while (currentDate.getDay() !== targetDay) {
    currentDate.setDate(currentDate.getDate() + 1);
  }

  // Generate meetings, skipping holidays
  let attempts = 0;
  const maxAttempts = meetingsToGenerate * 3; // Safety limit
  
  while (meetings.length < meetingsToGenerate && attempts < maxAttempts) {
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
        activityType: cycle.activityType,
      });
    }
    
    // Move to next week
    currentDate.setDate(currentDate.getDate() + 7);
  }

  if (meetings.length > 0) {
    const duplicateMeetingWarnings = await findDuplicateMeetingWarnings(meetings);
    if (duplicateMeetingWarnings.length > 0) {
      console.warn('[MeetingDuplicateWarning]', {
        cycleId,
        warnings: duplicateMeetingWarnings.map(w => w.message),
      });
    }

    await prisma.meeting.createMany({ data: meetings });
    
    // Update cycle progress and end date based on the generated schedule.
    const lastMeetingDate = meetings[meetings.length - 1].scheduledDate;
    const completedCount = cycle.meetings.filter(m => m.status === 'completed').length;
    await prisma.cycle.update({
      where: { id: cycleId },
      data: { 
        remainingMeetings: Math.max(0, cycle.totalMeetings - completedCount),
        endDate: lastMeetingDate,
      },
    });

    return { created: meetings.length, duplicateMeetingWarnings };
  }

  return { created: 0, duplicateMeetingWarnings: [] as MeetingDuplicateWarning[] };
}

async function regenerateMeetingsForCycle(cycleId: string) {
  const cycle = await prisma.cycle.findUnique({
    where: { id: cycleId },
    include: {
      meetings: {
        where: { deletedAt: null },
        select: { id: true, scheduledDate: true, status: true },
      },
    },
  });

  if (!cycle) throw new AppError(404, 'Cycle not found');

  if (cycle.type === 'trial_private') {
    const completedCount = cycle.meetings.filter(m => m.status === 'completed').length;
    await prisma.cycle.update({
      where: { id: cycleId },
      data: {
        completedMeetings: completedCount,
        remainingMeetings: cycle.status === 'completed' ? 0 : Math.max(0, cycle.totalMeetings - completedCount),
      },
    });
    return { deleted: 0, generated: 0, completedCount };
  }

  const meetingsToDelete = cycle.meetings.filter(m =>
    AUTO_REGENERATED_MEETING_STATUSES.includes(m.status as any)
  );

  for (const meeting of meetingsToDelete) {
    await assertMeetingNotInIssuedPeriod(meeting.id);
  }

  await prisma.$transaction(async (tx) => {
    const ids = meetingsToDelete.map(m => m.id);
    if (ids.length > 0) {
      await tx.meetingChangeRequest.deleteMany({
        where: { meetingId: { in: ids } },
      });
      await tx.meeting.updateMany({
        where: { rescheduledToId: { in: ids } },
        data: { rescheduledToId: null },
      });
      await tx.meeting.deleteMany({
        where: { id: { in: ids } },
      });
    }
  });

  const completedMeetings = await prisma.meeting.findMany({
    where: { cycleId, status: 'completed', deletedAt: null },
    select: { scheduledDate: true },
    orderBy: { scheduledDate: 'desc' },
  });

  const completedCount = completedMeetings.length;
  const remainingCount = cycle.status === 'completed'
    ? 0
    : Math.max(0, cycle.totalMeetings - completedCount);

  await prisma.cycle.update({
    where: { id: cycleId },
    data: {
      completedMeetings: completedCount,
      remainingMeetings: remainingCount,
    },
  });

  if (remainingCount <= 0) {
    return { deleted: meetingsToDelete.length, generated: 0, completedCount };
  }

  const generateFrom = completedMeetings[0]
    ? addDays(completedMeetings[0].scheduledDate, 7)
    : cycle.startDate;

  await generateMeetingsForCycle(cycleId, generateFrom, remainingCount);

  return { deleted: meetingsToDelete.length, generated: remainingCount, completedCount };
}

// List cycles
cyclesRouter.get('/', async (req, res, next) => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const status = req.query.status as string | undefined;
    const type = req.query.type as string | undefined;
    const branchId = req.query.branchId as string | undefined;
    let instructorId = req.query.instructorId as string | undefined;
    const courseId = req.query.courseId as string | undefined;
    const dayOfWeek = req.query.dayOfWeek as string | undefined;
    const search = req.query.search as string | undefined;
    const startDateFrom = req.query.startDateFrom as string | undefined;
    const startDateTo = req.query.startDateTo as string | undefined;

    // Filter by cycle start date range (inclusive). Dates are YYYY-MM-DD.
    const startDateFilter: { gte?: Date; lte?: Date } = {};
    if (startDateFrom && /^\d{4}-\d{2}-\d{2}$/.test(startDateFrom)) {
      startDateFilter.gte = new Date(`${startDateFrom}T00:00:00.000Z`);
    }
    if (startDateTo && /^\d{4}-\d{2}-\d{2}$/.test(startDateTo)) {
      startDateFilter.lte = new Date(`${startDateTo}T00:00:00.000Z`);
    }

    // If user is an instructor, restrict to their own cycles only
    if (req.user?.role === 'instructor') {
      const instructor = await prisma.instructor.findUnique({
        where: { userId: req.user.userId },
        select: { id: true },
      });
      if (instructor) instructorId = instructor.id;
    }

    const where = {
      ...(status && { status: status as any }),
      ...(type && { type: type as any }),
      ...(branchId && { branchId }),
      ...(instructorId && { instructorId }),
      ...(courseId && { courseId }),
      ...(dayOfWeek && { dayOfWeek: dayOfWeek as any }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { location: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
      ...((startDateFilter.gte || startDateFilter.lte) && { startDate: startDateFilter }),
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
          registrations: { where: { status: { notIn: ['cancelled', 'pending_cancellation'] } }, select: { amount: true } },
        },
        orderBy: { startDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.cycle.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);
    res.json({
      data: cycles.map(c => ({ ...c, revenuePerMeeting: computeRevenuePerMeeting(c) })),
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
            registration: {
              include: {
                student: {
                  include: {
                    customer: { select: { id: true, name: true, phone: true } },
                  },
                },
              },
            },
            _count: { select: { attendance: true } },
            changeRequests: {
              where: { status: 'pending' },
              select: { id: true, type: true, reason: true, status: true, createdAt: true },
            },
          },
        },
      },
    });

    if (!cycle) {
      throw new AppError(404, 'Cycle not found');
    }

    res.json({ ...cycle, revenuePerMeeting: computeRevenuePerMeeting(cycle) });
  } catch (error) {
    next(error);
  }
});

// Create cycle
cyclesRouter.post('/', operationsManagerOrAdmin, async (req, res, next) => {
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

    const createData: any = {
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
      defaultRegistrationAmount: data.defaultRegistrationAmount,
      meetingRevenue: data.meetingRevenue,
      revenueIncludesVat: data.revenueIncludesVat,
      instructorPaymentMode: data.instructorPaymentMode ?? 'hourly',
      instructorDailyRate: data.instructorPaymentMode === 'daily' ? data.instructorDailyRate : null,
      studentCount: data.studentCount,
      maxStudents: data.maxStudents,
      minimumStudentsThreshold: data.minimumStudentsThreshold,
      sendParentReminders: data.sendParentReminders,
      isOnline: data.activityType === 'online',
      activityType: data.activityType,
      location: data.location,
      zoomHostId: data.zoomHostId,
      remainingMeetings: data.totalMeetings,
    };

    const cycle: any = await prisma.cycle.create({
      data: createData,
      include: {
        course: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        instructor: { select: { id: true, name: true } },
      },
    });

    // Generate meetings (skip for trial_private — meetings are added manually)
    if (data.type !== 'trial_private') {
      const generationResult = await generateMeetingsForCycle(cycle.id);
      (cycle as any).duplicateMeetingWarnings = generationResult.duplicateMeetingWarnings;
    }

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

    res.status(201).json(cycle);
  } catch (error) {
    next(error);
  }
});

// Update cycle
cyclesRouter.put('/:id', operationsManagerOrAdmin, async (req, res, next) => {
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

    // Institutional cycles must stay linked to an institutional order. Guard against
    // switching a cycle to an institutional type, or clearing the order, without one —
    // otherwise its meetings become unbillable orphans.
    const effectiveType = data.type ?? existingCycle.type;
    const orderProvided = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'institutionalOrderId');
    const effectiveOrderId = orderProvided ? data.institutionalOrderId : existingCycle.institutionalOrderId;
    const isInstitutional = effectiveType === 'institutional_per_child' || effectiveType === 'institutional_fixed';
    if (isInstitutional && !effectiveOrderId?.trim()) {
      throw new AppError(400, 'חובה לשייך הזמנה מוסדית למחזור מסוג מוסדי');
    }

    const updateData: any = { ...data };
    
    if (data.startDate) updateData.startDate = new Date(data.startDate);
    if (data.endDate) updateData.endDate = new Date(data.endDate);
    if (data.startTime) updateData.startTime = new Date(`1970-01-01T${data.startTime}:00Z`);
    if (data.endTime) updateData.endTime = new Date(`1970-01-01T${data.endTime}:00Z`);
    if (data.instructorPaymentMode === 'hourly') {
      updateData.instructorDailyRate = null;
    }

    // If totalMeetings or completedMeetings changed, recalculate remainingMeetings
    if (data.totalMeetings !== undefined || data.completedMeetings !== undefined || data.status === 'completed') {
      const newTotal = data.totalMeetings ?? existingCycle.totalMeetings;
      const newCompleted = data.completedMeetings ?? existingCycle.completedMeetings;
      const newStatus = data.status ?? existingCycle.status;
      updateData.remainingMeetings = newStatus === 'completed'
        ? 0
        : Math.max(0, newTotal - newCompleted);
    }

    // Check if we need to regenerate meetings
    const regenerateMeetings = (req.body as any).regenerateMeetings === true;
    
    // Remove regenerateMeetings from updateData as it's not a Cycle field
    delete updateData.regenerateMeetings;

    // If the cycle is being cancelled (transitioning into 'cancelled'), cascade to all
    // of its meetings. Invariant: cancelled cycle => every meeting is cancelled too.
    const cancellingNow = data.status === 'cancelled' && existingCycle.status !== 'cancelled';

    const cycle = await prisma.$transaction(async (tx) => {
      const updated = await tx.cycle.update({
        where: { id },
        data: updateData,
        include: {
          course: { select: { id: true, name: true } },
          branch: { select: { id: true, name: true } },
          instructor: { select: { id: true, name: true } },
        },
      });
      if (cancellingNow) {
        const cascade = await tx.meeting.updateMany({
          where: { cycleId: id, status: { not: 'cancelled' }, deletedAt: null },
          data: { status: 'cancelled', statusUpdatedAt: new Date(), statusUpdatedById: req.user?.userId ?? null },
        });
        if (cascade.count > 0) {
          console.log(`[cycles.update] cascaded cancel to ${cascade.count} meetings of cycle ${id}`);
        }
      }
      return updated;
    });

    await recalculateInstructorPaymentsForCycle(id);

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
      defaultRegistrationAmount: Number(existingCycle.defaultRegistrationAmount),
      studentCount: existingCycle.studentCount,
      minimumStudentsThreshold: existingCycle.minimumStudentsThreshold,
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
      defaultRegistrationAmount: Number(cycle.defaultRegistrationAmount),
      studentCount: cycle.studentCount,
      minimumStudentsThreshold: cycle.minimumStudentsThreshold,
      activityType: cycle.activityType,
    };
    await logUpdateAudit({
      entity: 'Cycle',
      entityId: id,
      oldRecord,
      newRecord,
      req,
    });

    // Attach revenuePerMeeting to the response (may be partial for private if no regs loaded)
    (cycle as any).revenuePerMeeting = computeRevenuePerMeeting(cycle);

    if (data.status === 'completed') {
      await checkAndSendInstitutionalOrderCompletionAlert(cycle.institutionalOrderId, 'cycle-update');
    }

    // If regenerateMeetings flag is set, delete generated future/pending meetings
    // and recreate the remaining schedule from the updated cycle definition.
    if (regenerateMeetings) {
      await regenerateMeetingsForCycle(id);
    }

    res.json(cycle);
  } catch (error) {
    next(error);
  }
});

// Delete cycle
cyclesRouter.delete('/:id', operationsManagerOrAdmin, async (req, res, next) => {
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
            videoProvider: true,
            zoomHostEmail: true,
            googleMeetSpaceName: true,
            googleCalendarEventId: true,
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
        .filter(m => m.zoomMeetingId && (m.videoProvider ?? 'zoom') === 'zoom')
        .map(m => m.zoomMeetingId!)
    )];
    const googleMeetCleanups = cycle.meetings
      .filter(m => (m.videoProvider ?? 'zoom') === 'google_meet' && (m.googleCalendarEventId || m.googleMeetSpaceName))
      .map(m => ({
        hostEmail: m.zoomHostEmail,
        googleMeetSpaceName: m.googleMeetSpaceName,
        googleCalendarEventIds: [m.googleCalendarEventId],
      }));

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
          googleMeetEvents: googleMeetCleanups.length,
          meetings: cycle.meetings.map(m => ({
            date: m.scheduledDate,
            status: m.status,
            zoomMeetingId: m.zoomMeetingId,
            videoProvider: m.videoProvider,
            googleCalendarEventId: m.googleCalendarEventId,
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
    await prisma.meetingChangeRequest.deleteMany({
      where: { meeting: { cycleId: id } },
    });
    // Null out rescheduledToId self-references before deleting meetings
    await prisma.meeting.updateMany({
      where: { cycleId: id },
      data: { rescheduledToId: null },
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

    if (googleMeetCleanups.length > 0) {
      setImmediate(async () => {
        for (const cleanup of googleMeetCleanups) {
          try {
            const result = await googleMeetService.deleteGoogleMeetMeeting(cleanup);
            console.log(
              `[Cycle Delete] Deleted ${result.deletedCalendarEvents} Google Meet calendar events` +
              `${result.endedActiveConference ? ' and ended active conference' : ''}`
            );
          } catch (error: any) {
            console.error('[Cycle Delete] Failed to clean up Google Meet meeting:', error.message);
          }
        }
        console.log(`[Cycle Delete] Finished background cleanup of ${googleMeetCleanups.length} Google Meet meetings`);
      });
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Generate meetings for a cycle
cyclesRouter.post('/:id/generate-meetings', operationsManagerOrAdmin, async (req, res, next) => {
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

    // Generate only the missing meetings
    const generationResult = await generateMeetingsForCycle(cycleId, undefined, meetingsToGenerate);

    // Get updated cycle
    const updatedCycle = await prisma.cycle.findUnique({
      where: { id: cycleId },
      include: { meetings: true }
    });

    res.json({ 
      message: `נוצרו ${meetingsToGenerate} פגישות חדשות`,
      generated: meetingsToGenerate,
      total: updatedCycle?.meetings.length || 0,
      duplicateMeetingWarnings: generationResult.duplicateMeetingWarnings,
    });
  } catch (error) {
    next(error);
  }
});

// Bulk generate meetings for multiple cycles
cyclesRouter.post('/bulk-generate-meetings', operationsManagerOrAdmin, async (req, res, next) => {
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
      duplicateMeetingWarnings?: MeetingDuplicateWarning[];
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

        const generationResult = await generateMeetingsForCycle(cycleId, undefined, meetingsToGenerate);
        results.push({
          cycleId,
          name: cycle.name,
          success: true,
          generated: meetingsToGenerate,
          duplicateMeetingWarnings: generationResult.duplicateMeetingWarnings,
        });
      } catch (err: any) {
        results.push({ cycleId, success: false, error: err.message });
      }
    }

    const totalGenerated = results.filter(r => r.success).reduce((sum, r) => sum + (r.generated || 0), 0);
    const successCount = results.filter(r => r.success).length;

    res.json({
      message: `נוצרו פגישות ל-${successCount} מחזורים`,
      totalGenerated,
      duplicateMeetingWarnings: results.flatMap(result => result.duplicateMeetingWarnings || []),
      results
    });
  } catch (error) {
    next(error);
  }
});

// Bulk update cycles
cyclesRouter.post('/bulk-update', operationsManagerOrAdmin, async (req, res, next) => {
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
    if (data.defaultRegistrationAmount !== undefined) updateData.defaultRegistrationAmount = data.defaultRegistrationAmount;
    if (data.studentCount !== undefined) updateData.studentCount = data.studentCount;
    if (data.minimumStudentsThreshold !== undefined) updateData.minimumStudentsThreshold = data.minimumStudentsThreshold;
    if (data.sendParentReminders !== undefined) updateData.sendParentReminders = data.sendParentReminders;
    if (data.activityType !== undefined) {
      updateData.activityType = data.activityType;
      updateData.isOnline = data.activityType === 'online';
    }

    // If we're bulk-cancelling, identify cycles whose meetings need to be cascaded too.
    // Invariant: cancelled cycle => every meeting is cancelled too.
    // Skip cycles already cancelled to avoid noisy zero-row updates and duplicate audit lines.
    const cancellingNow = data.status === 'cancelled';
    const cyclesNeedingCascade = cancellingNow
      ? (await prisma.cycle.findMany({
          where: { id: { in: ids }, status: { not: 'cancelled' } },
          select: { id: true },
        })).map(c => c.id)
      : [];

    // Update all cycles + (optionally) their open meetings in one transaction.
    const results = await prisma.$transaction(async (tx) => {
      const cycles = await Promise.all(
        ids.map(id =>
          tx.cycle.update({
            where: { id },
            data: updateData,
            select: { id: true, name: true, institutionalOrderId: true },
          })
        )
      );
      if (cyclesNeedingCascade.length > 0) {
        const cascade = await tx.meeting.updateMany({
          where: { cycleId: { in: cyclesNeedingCascade }, status: { not: 'cancelled' }, deletedAt: null },
          data: { status: 'cancelled', statusUpdatedAt: new Date(), statusUpdatedById: req.user?.userId ?? null },
        });
        console.log(`[cycles.bulk-update] cascaded cancel to ${cascade.count} meetings across ${cyclesNeedingCascade.length} cycles`);
      }
      return cycles;
    });

    if (data.status === 'completed') {
      const orderIds = [...new Set(
        results
          .map((cycle) => cycle.institutionalOrderId)
          .filter((orderId): orderId is string => Boolean(orderId)),
      )];
      await Promise.all(
        orderIds.map((orderId) => checkAndSendInstitutionalOrderCompletionAlert(orderId, 'cycle-bulk-update')),
      );
    }

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
      where: { cycleId: id, deletedAt: null },
      include: {
        instructor: { select: { id: true, name: true } },
        attendance: {
          include: {
            registration: {
              include: {
                student: {
                  include: {
                    customer: { select: { id: true, name: true, phone: true } },
                  },
                },
              },
            },
          },
        },
        registration: {
          include: {
            student: {
              include: {
                customer: { select: { id: true, name: true, phone: true } },
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
    
    // Add adjusted profit + fallback host key to each meeting
    const meetingsWithAdjustedProfit = meetings.map(meeting => {
      const baseProfit = Number(meeting.profit || 0);
      const adjustedProfit = baseProfit - cycleExpensePerMeeting;
      
      // Fill missing zoomHostKey from local map if we know the host email
      const zoomHostKey = meeting.zoomHostKey ||
        (meeting.zoomHostEmail ? getHostKeyByEmail(meeting.zoomHostEmail) : null);
      
      return {
        ...meeting,
        zoomHostKey,
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

// ─── GET /api/cycles/:id/students ───────────────────────────────────────────
// Clean flat list of students enrolled in a cycle.
// Query params:
//   status=registered|cancelled|all  (default: registered)
cyclesRouter.get('/:id/students', async (req, res, next) => {
  try {
    const id          = uuidSchema.parse(req.params.id);
    const statusParam = (req.query.status as string | undefined) ?? 'registered';

    const where: Record<string, unknown> = { cycleId: id };
    if (statusParam !== 'all') {
      where.status = statusParam;
    }

    const registrations = await prisma.registration.findMany({
      where,
      include: {
        student: {
          include: {
            customer: { select: { id: true, name: true, phone: true, email: true, city: true } },
          },
        },
      },
      orderBy: { registrationDate: 'asc' },
    });

    const students = registrations.map(r => ({
      registrationId:   r.id,
      registrationStatus: r.status,
      registrationDate: r.registrationDate,
      paymentStatus:    r.paymentStatus,
      studentId:        r.student?.id ?? null,
      studentName:      r.student?.name ?? null,
      studentBirthDate: r.student?.birthDate ?? null,
      studentGrade:     r.student?.grade ?? null,
      customerId:       r.student?.customer?.id ?? null,
      parentName:       r.student?.customer?.name ?? null,
      parentPhone:      r.student?.customer?.phone ?? null,
      parentEmail:      r.student?.customer?.email ?? null,
      parentCity:       r.student?.customer?.city ?? null,
    }));

    res.json({ cycleId: id, total: students.length, students });
  } catch (error) {
    next(error);
  }
});

// Add registration to cycle
cyclesRouter.post('/:id/registrations', cycleRosterOrAdmin, async (req, res, next) => {
  try {
    const cycleId = uuidSchema.parse(req.params.id);
    const data = createRegistrationSchema.parse({ ...req.body, cycleId });

    // Verify student exists
    const student = await prisma.student.findUnique({
      where: { id: data.studentId },
    });
    if (!student) throw new AppError(404, 'Student not found');

    const registrationAmount = await resolveRegistrationAmountForCycle(cycleId, data.amount);

    // Check if already registered
    const existing = await prisma.registration.findUnique({
      where: { studentId_cycleId: { studentId: data.studentId, cycleId } },
    });

    // If cancelled registration exists — reactivate it instead of creating new
    if (existing) {
      if (existing.status !== 'cancelled') {
        throw new AppError(409, 'Student already registered for this cycle');
      }
      const reactivated = await prisma.registration.update({
        where: { id: existing.id },
        data: {
          status: data.status ?? 'registered',
          registrationDate: data.registrationDate ? new Date(data.registrationDate) : new Date(),
          amount: registrationAmount,
          paymentStatus: data.paymentStatus,
          paymentMethod: data.paymentMethod,
          cancellationDate: null,
          cancellationReason: null,
          refundAmount: null,
          refundDate: null,
        },
        include: {
          student: { include: { customer: { select: { id: true, name: true, phone: true } } } },
          cycle: { select: { id: true, name: true } },
        },
      });
      return res.status(200).json(reactivated);
    }

    const registration = await prisma.registration.create({
      data: {
        studentId: data.studentId,
        cycleId,
        registrationDate: data.registrationDate ? new Date(data.registrationDate) : new Date(),
        status: data.status,
        amount: registrationAmount,
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

    // Recalculate future meeting revenues based on new student count
    recalcMeetingRevenue(cycleId).catch(err =>
      console.error('[RECALC REVENUE] Error after registration create:', err)
    );

    res.status(201).json(registration);
  } catch (error) {
    next(error);
  }
});

// Sync ALL active cycles progress from meetings table (bulk)
cyclesRouter.post('/sync-all', operationsManagerOrAdmin, async (_req, res, next) => {
  try {
    const cycles = await prisma.cycle.findMany({
      where: { status: 'active', deletedAt: null },
      select: { id: true, totalMeetings: true },
    });

    let updated = 0;
    for (const cycle of cycles) {
      const completedMeetings = await prisma.meeting.count({
        where: { cycleId: cycle.id, status: 'completed' },
      });
      const remainingMeetings = Math.max(0, cycle.totalMeetings - completedMeetings);
      await prisma.cycle.update({
        where: { id: cycle.id },
        data: { completedMeetings, remainingMeetings },
      });
      updated++;
    }

    res.json({ success: true, synced: updated });
  } catch (error) {
    next(error);
  }
});

// Sync cycle progress from meetings table
cyclesRouter.post('/:id/sync-progress', operationsManagerOrAdmin, async (req, res, next) => {
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
    const remainingMeetings = cycle.status === 'completed'
      ? 0
      : Math.max(0, cycle.totalMeetings - completedMeetings);

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

// ─── Freeze / Resume ──────────────────────────────────────────────────────────

/**
 * POST /api/cycles/:id/freeze
 * Freeze a cycle — set status=frozen, postpone future scheduled meetings.
 * Body: { reason?: string, resumeDate?: string (ISO date) }
 */
cyclesRouter.post('/:id/freeze', operationsManagerOrAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason, resumeDate } = req.body;

    const cycle = await prisma.cycle.findUnique({ where: { id } });
    if (!cycle) throw new AppError(404, 'מחזור לא נמצא');
    if (cycle.status === 'frozen') throw new AppError(400, 'המחזור כבר מוקפא');
    if (cycle.status === 'cancelled') throw new AppError(400, 'לא ניתן להקפיא מחזור מבוטל');

    // Postpone all future scheduled meetings
    const postponed = await prisma.meeting.updateMany({
      where: {
        cycleId: id,
        status: 'scheduled',
        scheduledDate: { gte: new Date() },
      },
      data: { status: 'postponed' },
    });

    // Freeze the cycle
    const updated = await prisma.cycle.update({
      where: { id },
      data: {
        status: 'frozen',
        frozenAt: new Date(),
        frozenReason: reason?.trim() || null,
        resumeDate: resumeDate ? new Date(resumeDate) : null,
      },
      include: {
        course: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        instructor: { select: { id: true, name: true } },
      },
    });

    await logAudit({ req, action: 'UPDATE', entity: 'cycle', entityId: id, newValue: { action: 'freeze', reason, resumeDate, postponedMeetings: postponed.count } });

    res.json({ ...updated, postponedMeetings: postponed.count });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/cycles/:id/resume
 * Resume a frozen cycle — set status=active, reschedule postponed meetings from newStartDate.
 * Body: { newStartDate: string (ISO date) }
 */
cyclesRouter.post('/:id/resume', operationsManagerOrAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { newStartDate } = req.body;

    const cycle = await prisma.cycle.findUnique({
      where: { id },
      include: { meetings: { where: { status: 'postponed' }, orderBy: { scheduledDate: 'asc' } } },
    });
    if (!cycle) throw new AppError(404, 'מחזור לא נמצא');
    if (cycle.status !== 'frozen') throw new AppError(400, 'המחזור לא מוקפא');

    let rescheduledCount = 0;

    if (newStartDate && cycle.meetings.length > 0) {
      // Reschedule postponed meetings starting from newStartDate, keeping original day-of-week interval
      const start = new Date(newStartDate);
      for (let i = 0; i < cycle.meetings.length; i++) {
        const newDate = new Date(start);
        newDate.setDate(start.getDate() + i * 7); // weekly intervals
        await prisma.meeting.update({
          where: { id: cycle.meetings[i].id },
          data: { status: 'scheduled', scheduledDate: newDate },
        });
        rescheduledCount++;
      }
    }

    // Activate the cycle
    const updated = await prisma.cycle.update({
      where: { id },
      data: {
        status: 'active',
        frozenAt: null,
        frozenReason: null,
        resumeDate: null,
      },
      include: {
        course: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        instructor: { select: { id: true, name: true } },
      },
    });

    await logAudit({ req, action: 'UPDATE', entity: 'cycle', entityId: id, newValue: { action: 'resume', newStartDate, rescheduledMeetings: rescheduledCount } });

    res.json({ ...updated, rescheduledMeetings: rescheduledCount });
  } catch (error) {
    next(error);
  }
});
