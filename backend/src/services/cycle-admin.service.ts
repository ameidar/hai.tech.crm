// Cycle create/update + meeting generation — shared by the internal CRM route
// (/api/cycles) and the v1 ops API (/api/v1/cycles). Moved verbatim from routes/cycles.ts
// so validation and side effects (meeting generation, end-date calculation, instructor
// payment recalculation, future-meeting cancellation, audit) are identical in both.

import type { Request } from 'express';
import { prisma } from '../utils/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { createCycleSchema, updateCycleSchema } from '../types/schemas.js';
import { fetchHolidays, dayNameToNumber, calculateCycleEndDate } from '../utils/holidays.js';
import { logAudit, logUpdateAudit } from '../utils/audit.js';
import { meetingRevenueFromRegistrations, netAmount, revenueRegistrations, roundMoney } from '../utils/revenue.js';
import { recalculateInstructorPaymentsForCycle } from './instructor-payment.js';
import { checkAndSendInstitutionalOrderCompletionAlert } from './institutional-order-completion-alert.js';
import { assertMeetingNotInIssuedPeriod } from './billing-lock.js';
import { cancelFutureMeetingsForCycle } from './cancellations.js';

// Helper: compute expected revenue per meeting for any cycle type
export function computeRevenuePerMeeting(cycle: any): number {
  const totalMeetings = Number(cycle.totalMeetings) || 1;
  if (cycle.type === 'institutional_fixed') {
    return Number(cycle.meetingRevenue || 0);
  }
  if (cycle.type === 'institutional_per_child') {
    const count = cycle.registrations?.length ?? cycle._count?.registrations ?? cycle.studentCount ?? 0;
    return roundMoney(Number(cycle.pricePerStudent || 0) * count);
  }
  if (cycle.type === 'private' || cycle.type === 'trial_private' || cycle.type === 'group') {
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
export async function generateMeetingsForCycle(cycleId: string, fromDate?: Date, targetCount?: number) {
  const cycle = await prisma.cycle.findUnique({
    where: { id: cycleId },
    include: {
      meetings: {
        where: { deletedAt: null },
        select: { id: true, scheduledDate: true, status: true },
      },
    },
  });

  if (!cycle) return;

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
  if (meetingsToGenerate <= 0) return;

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
        recallBotEnabled: cycle.recallBotEnabled,
        activityType: cycle.activityType,
      });
    }
    
    // Move to next week
    currentDate.setDate(currentDate.getDate() + 7);
  }

  if (meetings.length > 0) {
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
  }
}

export async function regenerateMeetingsForCycle(cycleId: string) {
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

/**
 * Create a cycle (validated with the internal createCycleSchema) and generate its
 * meetings (except trial_private, whose meetings are added manually).
 */
export async function createCycle(body: unknown, req?: Request) {
    const data = createCycleSchema.parse(body);

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
      recallBotEnabled: data.recallBotEnabled ?? false,
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
      await generateMeetingsForCycle(cycle.id);
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

    return cycle;
}

/**
 * Update a cycle. `body` is the raw request body: presence of `institutionalOrderId`
 * (even null) and the non-field flag `regenerateMeetings: true` are read from it.
 */
export async function updateCycle(id: string, body: unknown, req?: Request) {
    const data = updateCycleSchema.parse(body);

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
    const orderProvided = Object.prototype.hasOwnProperty.call(body ?? {}, 'institutionalOrderId');
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
    const regenerateMeetings = (body as any)?.regenerateMeetings === true;
    
    // Remove regenerateMeetings from updateData as it's not a Cycle field
    delete updateData.regenerateMeetings;

    // If the cycle is being cancelled, only future open meetings should be cancelled.
    // Past/completed/cancelled meetings remain historical records.
    const cancellingNow = data.status === 'cancelled' && existingCycle.status !== 'cancelled';

    const cycle = await prisma.cycle.update({
      where: { id },
      data: updateData,
      include: {
        course: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        instructor: { select: { id: true, name: true } },
      },
    });

    if (data.recallBotEnabled !== undefined) {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      await prisma.meeting.updateMany({
        where: {
          cycleId: id,
          status: 'scheduled',
          deletedAt: null,
          recallBotId: null,
          scheduledDate: { gte: today },
        },
        data: { recallBotEnabled: data.recallBotEnabled },
      });
    }

    if (cancellingNow) {
      await cancelFutureMeetingsForCycle(id, { req, markCycleCancelled: true });
    }

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
      recallBotEnabled: existingCycle.recallBotEnabled,
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
      recallBotEnabled: cycle.recallBotEnabled,
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

    return cycle;
}
