import { Router } from 'express';
import ExcelJS from 'exceljs';
import { prisma } from '../utils/prisma.js';
import { authenticate, cycleRosterOrAdmin, operationsManagerOrAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { createRegistrationSchema, paginationSchema, uuidSchema, bulkUpdateCyclesSchema } from '../types/schemas.js';
import { zoomService, getHostKeyByEmail } from '../services/zoom.js';
import { googleMeetService } from '../services/google-meet.js';
import { logAudit } from '../utils/audit.js';
import { recalcMeetingRevenue } from '../utils/recalcMeetingRevenue.js';
import { checkAndSendInstitutionalOrderCompletionAlert } from '../services/institutional-order-completion-alert.js';
import { resolveRegistrationAmountForCycle } from '../utils/registration-amount.js';
import { cancelFutureMeetingsForCycle } from '../services/cancellations.js';
import {
  computeRevenuePerMeeting,
  generateMeetingsForCycle,
  createCycle,
  updateCycle,
} from '../services/cycle-admin.service.js';

// Make.com webhook removed — Zoom recordings handled directly via /api/zoom-webhook

export const cyclesRouter = Router();

cyclesRouter.use(authenticate);

const DAY_OF_WEEK_HEBREW: Record<string, string> = {
  sunday: 'ראשון',
  monday: 'שני',
  tuesday: 'שלישי',
  wednesday: 'רביעי',
  thursday: 'חמישי',
  friday: 'שישי',
  saturday: 'שבת',
};

const CYCLE_TYPE_HEBREW: Record<string, string> = {
  private: 'פרטי',
  trial_private: 'ניסיון פרטי',
  group: 'קבוצתי',
  institutional_per_child: 'מוסדי לפי ילד',
  institutional_fixed: 'מוסדי קבוע',
};

const CYCLE_STATUS_HEBREW: Record<string, string> = {
  active: 'פעיל',
  completed: 'הושלם',
  cancelled: 'בוטל',
  frozen: 'מוקפא',
  retainer: 'ריטיינר',
};

function parseCycleStartDateFilter(startDateFrom?: string, startDateTo?: string) {
  const startDateFilter: { gte?: Date; lte?: Date } = {};
  if (startDateFrom && /^\d{4}-\d{2}-\d{2}$/.test(startDateFrom)) {
    startDateFilter.gte = new Date(`${startDateFrom}T00:00:00.000Z`);
  }
  if (startDateTo && /^\d{4}-\d{2}-\d{2}$/.test(startDateTo)) {
    startDateFilter.lte = new Date(`${startDateTo}T00:00:00.000Z`);
  }
  return startDateFilter;
}

async function getEffectiveInstructorId(req: any, requestedInstructorId?: string) {
  if (req.user?.role !== 'instructor') return requestedInstructorId;

  const instructor = await prisma.instructor.findUnique({
    where: { userId: req.user.userId },
    select: { id: true },
  });
  return instructor?.id ?? requestedInstructorId;
}

function buildCycleWhere(params: {
  status?: string;
  type?: string;
  branchId?: string;
  instructorId?: string;
  courseId?: string;
  dayOfWeek?: string;
  search?: string;
  startDateFrom?: string;
  startDateTo?: string;
}) {
  const startDateFilter = parseCycleStartDateFilter(params.startDateFrom, params.startDateTo);
  return {
    deletedAt: null,
    ...(params.status && { status: params.status as any }),
    ...(params.type && { type: params.type as any }),
    ...(params.branchId && { branchId: params.branchId }),
    ...(params.instructorId && { instructorId: params.instructorId }),
    ...(params.courseId && { courseId: params.courseId }),
    ...(params.dayOfWeek && { dayOfWeek: params.dayOfWeek as any }),
    ...(params.search && {
      OR: [
        { name: { contains: params.search, mode: 'insensitive' as const } },
        { location: { contains: params.search, mode: 'insensitive' as const } },
      ],
    }),
    ...((startDateFilter.gte || startDateFilter.lte) && { startDate: startDateFilter }),
  };
}

function formatDateForExcel(date?: Date | string | null) {
  if (!date) return '';
  return new Date(date).toLocaleDateString('he-IL', { timeZone: 'UTC' });
}

function formatTimeForExcel(time?: Date | string | null) {
  if (!time) return '';
  if (time instanceof Date) {
    const hours = time.getUTCHours().toString().padStart(2, '0');
    const minutes = time.getUTCMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  }
  if (time.includes('T')) {
    const date = new Date(time);
    const hours = date.getUTCHours().toString().padStart(2, '0');
    const minutes = date.getUTCMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  }
  return time.substring(0, 5);
}

function sanitizeExportFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '_').slice(0, 120);
}

function sortExportCycles(cycles: any[], sortField: string, sortDirection: 'asc' | 'desc') {
  const dayOrder: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };

  const valueFor = (cycle: any) => {
    switch (sortField) {
      case 'name':
        return cycle.name || '';
      case 'course':
        return cycle.course?.name || '';
      case 'branch':
        return cycle.branch?.name || '';
      case 'instructor':
        return cycle.instructor?.name || '';
      case 'startDate':
        return new Date(cycle.startDate).getTime();
      case 'dayOfWeek':
        return `${dayOrder[cycle.dayOfWeek] ?? 0}-${formatTimeForExcel(cycle.startTime)}`;
      case 'type':
        return cycle.type || '';
      case 'pricePerStudent':
        return Number(cycle.pricePerStudent || cycle.defaultRegistrationAmount || 0);
      case 'meetingRevenue':
        return Number(cycle.revenuePerMeeting ?? cycle.meetingRevenue ?? 0);
      case 'registeredChildren':
        return cycle._count?.registrations ?? cycle.registrations?.length ?? cycle.studentCount ?? 0;
      case 'progress':
        return cycle.totalMeetings > 0 ? cycle.completedMeetings / cycle.totalMeetings : 0;
      case 'status':
        return cycle.status || '';
      case 'zoom':
        return cycle.zoomJoinUrl ? 1 : 0;
      default:
        return new Date(cycle.startDate).getTime();
    }
  };

  return [...cycles].sort((a, b) => {
    const aValue = valueFor(a);
    const bValue = valueFor(b);
    let comparison = 0;
    if (typeof aValue === 'string' || typeof bValue === 'string') {
      comparison = String(aValue).localeCompare(String(bValue), 'he');
    } else {
      comparison = Number(aValue) - Number(bValue);
    }
    return sortDirection === 'asc' ? comparison : -comparison;
  });
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
          _count: { select: { registrations: true, meetings: { where: { deletedAt: null } } } },
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

// Export cycles view to Excel
cyclesRouter.get('/export', async (req, res, next) => {
  try {
    const status = req.query.status as string | undefined;
    const type = req.query.type as string | undefined;
    const branchId = req.query.branchId as string | undefined;
    const instructorId = await getEffectiveInstructorId(req, req.query.instructorId as string | undefined);
    const courseId = req.query.courseId as string | undefined;
    const dayOfWeek = req.query.dayOfWeek as string | undefined;
    const search = req.query.search as string | undefined;
    const startDateFrom = req.query.startDateFrom as string | undefined;
    const startDateTo = req.query.startDateTo as string | undefined;
    const sortField = (req.query.sort as string | undefined) || 'name';
    const sortDirection = req.query.dir === 'desc' ? 'desc' : 'asc';

    const where = buildCycleWhere({
      status,
      type,
      branchId,
      instructorId,
      courseId,
      dayOfWeek,
      search,
      startDateFrom,
      startDateTo,
    });

    const cycles = await prisma.cycle.findMany({
      where,
      include: {
        course: { select: { id: true, name: true, category: true } },
        branch: { select: { id: true, name: true, type: true } },
        instructor: { select: { id: true, name: true } },
        institutionalOrder: { select: { id: true, orderNumber: true, orderName: true } },
        _count: { select: { registrations: { where: { deletedAt: null } }, meetings: { where: { deletedAt: null } } } },
        registrations: {
          where: { deletedAt: null, status: { notIn: ['cancelled', 'pending_cancellation'] } },
          select: { amount: true },
        },
      },
      orderBy: { startDate: 'desc' },
    });

    const exportRows = sortExportCycles(
      cycles.map(cycle => ({ ...cycle, revenuePerMeeting: computeRevenuePerMeeting(cycle) })),
      sortField,
      sortDirection
    );

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'HaiTech CRM';
    workbook.created = new Date();
    const worksheet = workbook.addWorksheet('מחזורים', {
      views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
      pageSetup: { orientation: 'landscape', fitToPage: true },
    });

    worksheet.columns = [
      { header: 'שם המחזור', key: 'name', width: 34 },
      { header: 'קורס', key: 'course', width: 28 },
      { header: 'סניף', key: 'branch', width: 24 },
      { header: 'מדריך', key: 'instructor', width: 20 },
      { header: 'תאריך התחלה', key: 'startDate', width: 14 },
      { header: 'תאריך סיום', key: 'endDate', width: 14 },
      { header: 'יום', key: 'day', width: 10 },
      { header: 'שעה', key: 'time', width: 15 },
      { header: 'סוג', key: 'type', width: 18 },
      { header: 'פעילות', key: 'activityType', width: 14 },
      { header: 'מחיר לתלמיד', key: 'pricePerStudent', width: 15 },
      { header: 'מחיר לפגישה', key: 'meetingRevenue', width: 15 },
      { header: 'ילדים רשומים', key: 'registeredChildren', width: 14 },
      { header: 'מפגשים', key: 'meetings', width: 12 },
      { header: 'התקדמות', key: 'progress', width: 13 },
      { header: 'סטטוס', key: 'status', width: 12 },
      { header: 'הזמנה מוסדית', key: 'institutionalOrder', width: 28 },
      { header: 'זום/גוגל מיט', key: 'videoLink', width: 14 },
      { header: 'מיקום', key: 'location', width: 18 },
    ];

    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    worksheet.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };

    for (const cycle of exportRows) {
      const registeredChildren = cycle._count?.registrations ?? cycle.registrations?.length ?? cycle.studentCount ?? 0;
      const completedMeetings = Number(cycle.completedMeetings) || 0;
      const totalMeetings = Number(cycle.totalMeetings) || 0;
      worksheet.addRow({
        name: cycle.name,
        course: cycle.course?.name || '',
        branch: cycle.branch?.name || '',
        instructor: cycle.instructor?.name || '',
        startDate: formatDateForExcel(cycle.startDate),
        endDate: formatDateForExcel(cycle.endDate),
        day: DAY_OF_WEEK_HEBREW[cycle.dayOfWeek] || cycle.dayOfWeek,
        time: `${formatTimeForExcel(cycle.startTime)}-${formatTimeForExcel(cycle.endTime)}`,
        type: CYCLE_TYPE_HEBREW[cycle.type] || cycle.type,
        activityType: cycle.activityType === 'online' ? 'אונליין' : cycle.activityType === 'private_lesson' ? 'פרטי' : 'פרונטלי',
        pricePerStudent: cycle.pricePerStudent || cycle.defaultRegistrationAmount ? Number(cycle.pricePerStudent || cycle.defaultRegistrationAmount) : null,
        meetingRevenue: cycle.revenuePerMeeting || cycle.meetingRevenue ? Number(cycle.revenuePerMeeting ?? cycle.meetingRevenue) : null,
        registeredChildren,
        meetings: `${completedMeetings}/${totalMeetings}`,
        progress: totalMeetings > 0 ? completedMeetings / totalMeetings : 0,
        status: CYCLE_STATUS_HEBREW[cycle.status] || cycle.status,
        institutionalOrder: cycle.institutionalOrder?.orderName || cycle.institutionalOrder?.orderNumber || '',
        videoLink: cycle.zoomJoinUrl || cycle.googleCalendarEventId || cycle.googleMeetSpaceName ? 'יש קישור' : '',
        location: cycle.location || '',
      });
    }

    worksheet.eachRow((row, rowNumber) => {
      row.alignment = { vertical: 'middle', horizontal: rowNumber === 1 ? 'center' : 'right', wrapText: true };
    });
    worksheet.getColumn('pricePerStudent').numFmt = '#,##0';
    worksheet.getColumn('meetingRevenue').numFmt = '#,##0';
    worksheet.getColumn('registeredChildren').numFmt = '#,##0';
    worksheet.getColumn('progress').numFmt = '0%';
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: worksheet.columnCount },
    };

    const buffer = await workbook.xlsx.writeBuffer();
    const dateStamp = new Date().toISOString().slice(0, 10);
    const filename = sanitizeExportFileName(`מחזורים_${dateStamp}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(Buffer.from(buffer));
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
    const cycle = await createCycle(req.body, req);
    res.status(201).json(cycle);
  } catch (error) {
    next(error);
  }
});

// Update cycle
cyclesRouter.put('/:id', operationsManagerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const cycle = await updateCycle(id, req.body, req);
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
    await generateMeetingsForCycle(cycleId, undefined, meetingsToGenerate);

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

        await generateMeetingsForCycle(cycleId, undefined, meetingsToGenerate);
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
    if (data.recallBotEnabled !== undefined) updateData.recallBotEnabled = data.recallBotEnabled;
    if (data.activityType !== undefined) {
      updateData.activityType = data.activityType;
      updateData.isOnline = data.activityType === 'online';
    }

    // If we're bulk-cancelling, only future open meetings should be cancelled.
    // Past/completed/cancelled meetings remain historical records.
    // Skip cycles already cancelled to avoid noisy zero-row updates and duplicate audit lines.
    const cancellingNow = data.status === 'cancelled';
    const cyclesNeedingCascade = cancellingNow
      ? (await prisma.cycle.findMany({
          where: { id: { in: ids }, status: { not: 'cancelled' } },
          select: { id: true },
        })).map(c => c.id)
      : [];

    const results = await Promise.all(
      ids.map(id =>
        prisma.cycle.update({
          where: { id },
          data: updateData,
          select: { id: true, name: true, institutionalOrderId: true },
        })
      )
    );
    for (const cycleId of cyclesNeedingCascade) {
      await cancelFutureMeetingsForCycle(cycleId, { req, markCycleCancelled: true });
    }

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
