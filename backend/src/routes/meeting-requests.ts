import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { sendEmail } from '../services/email/sender.js';
import { config } from '../config.js';
import { addReplacementMeetingWithRetry } from '../services/replacement-meeting.js';

export const meetingRequestsRouter = Router();

// All routes require authentication
meetingRequestsRouter.use(authenticate);

const createRequestSchema = z.object({
  meetingId: z.string().uuid(),
  type: z.enum(['cancel', 'postpone', 'replacement']),
  reason: z.string().min(1, 'סיבה היא שדה חובה'),
});

const reviewRequestSchema = z.object({
  reviewNotes: z.string().trim().max(1000).optional(),
  reason: z.string().trim().max(1000).optional(),
});

const logQuerySchema = z.object({
  instructorId: z.string().uuid().optional(),
  type: z.enum(['cancel', 'postpone', 'replacement', 'all']).optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'all']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  meetingFrom: z.string().optional(),
  meetingTo: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(200),
});

const typeHebrew: Record<string, string> = {
  cancel: 'ביטול',
  postpone: 'דחייה',
  replacement: 'החלפה',
};

const RISK_REQUEST_TYPES = ['cancel', 'postpone'];
const RISK_MIN_REQUESTS = 2;
const RISK_MIN_CYCLE_MEETINGS = 16;

// POST /api/meeting-requests — instructor creates a request
meetingRequestsRouter.post('/', async (req, res, next) => {
  try {
    const data = createRequestSchema.parse(req.body);

    // Must be an instructor
    if (req.user!.role !== 'instructor') {
      throw new AppError(403, 'רק מדריכים יכולים להגיש בקשות שינוי');
    }

    const instructor = await prisma.instructor.findUnique({
      where: { userId: req.user!.userId },
      select: { id: true },
    });
    if (!instructor) {
      throw new AppError(403, 'לא נמצא מדריך מקושר למשתמש');
    }
    const instructorId = instructor.id;

    // Verify meeting exists and belongs to this instructor
    const meeting = await prisma.meeting.findUnique({
      where: { id: data.meetingId },
      include: {
        cycle: { include: { branch: true } },
        instructor: true,
      },
    });

    if (!meeting) {
      throw new AppError(404, 'פגישה לא נמצאה');
    }

    if (meeting.instructorId !== instructorId) {
      throw new AppError(403, 'אין הרשאה להגיש בקשה עבור פגישה זו');
    }

    // Check for existing pending request of same type
    const existingRequest = await prisma.meetingChangeRequest.findFirst({
      where: {
        meetingId: data.meetingId,
        type: data.type,
        status: 'pending',
      },
    });

    if (existingRequest) {
      throw new AppError(400, 'כבר קיימת בקשה ממתינה מסוג זה עבור פגישה זו');
    }

    const request = await prisma.meetingChangeRequest.create({
      data: {
        meetingId: data.meetingId,
        instructorId,
        type: data.type,
        reason: data.reason,
      },
      include: {
        meeting: { include: { cycle: { include: { branch: true } } } },
        instructor: true,
      },
    });

    // Send notification email (fire & forget — don't block the response)
    const meetingDate = new Date(meeting.scheduledDate).toLocaleDateString('he-IL');
    const cycleName = meeting.cycle?.name || 'לא ידוע';
    const branchName = meeting.cycle?.branch?.name || '';
    const instructorName = meeting.instructor?.name || 'לא ידוע';

    sendEmail({
      to: ['info@hai.tech', 'hila@hai.tech'],
      subject: `בקשת ${typeHebrew[data.type]} - ${instructorName} - ${cycleName}`,
      html: `
        <div dir="rtl" style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px;">
          <h2 style="color: #dc2626;">🔔 בקשת ${typeHebrew[data.type]} חדשה</h2>
          <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold; width: 120px;">מדריך:</td>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${instructorName}</td>
            </tr>
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">מחזור:</td>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${cycleName}</td>
            </tr>
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">סניף:</td>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${branchName}</td>
            </tr>
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">תאריך פגישה:</td>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${meetingDate}</td>
            </tr>
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">סוג בקשה:</td>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${typeHebrew[data.type]}</td>
            </tr>
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">סיבה:</td>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${data.reason}</td>
            </tr>
          </table>
          <div style="margin-top: 20px;">
            <a href="${config.frontendUrl}/meetings?openMeeting=${data.meetingId}" 
               style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">
              פתח פגישה במערכת
            </a>
          </div>
          <p style="margin-top: 16px; color: #6b7280; font-size: 14px;">
            יש לאשר או לדחות את הבקשה במערכת HaiTech CRM.
          </p>
        </div>
      `,
    }).catch((emailError: unknown) => {
      console.error('Failed to send meeting request notification email:', emailError);
    });

    res.status(201).json(request);
  } catch (error) {
    next(error);
  }
});

// GET /api/meeting-requests/risk-summary — cancellation/postponement risk grouped by instructor + cycle
meetingRequestsRouter.get('/risk-summary', async (req, res, next) => {
  try {
    const instructorId = req.query.instructorId as string | undefined;
    const cycleId = req.query.cycleId as string | undefined;

    const where: any = {
      type: { in: RISK_REQUEST_TYPES },
      meeting: {
        deletedAt: null,
        cycle: {
          deletedAt: null,
          totalMeetings: { gte: RISK_MIN_CYCLE_MEETINGS },
        },
      },
    };

    if (req.user!.role === 'instructor') {
      const instructor = await prisma.instructor.findUnique({
        where: { userId: req.user!.userId },
        select: { id: true },
      });
      if (!instructor) {
        throw new AppError(403, 'לא נמצא מדריך מקושר למשתמש');
      }
      where.instructorId = instructor.id;
    } else if (instructorId) {
      where.instructorId = instructorId;
    }

    if (cycleId) {
      where.meeting.cycleId = cycleId;
    }

    const requests = await prisma.meetingChangeRequest.findMany({
      where,
      include: {
        meeting: {
          select: {
            id: true,
            scheduledDate: true,
            cycleId: true,
            cycle: {
              select: {
                id: true,
                name: true,
                totalMeetings: true,
                branch: { select: { id: true, name: true } },
              },
            },
          },
        },
        instructor: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const grouped = new Map<string, {
      instructorId: string;
      instructorName: string;
      instructorPhone: string | null;
      cycleId: string;
      cycleName: string;
      branchName: string | null;
      totalMeetings: number;
      cancelCount: number;
      postponeCount: number;
      totalRiskRequests: number;
      latestRequestAt: Date;
      latestMeetingDate: Date | null;
      requestIds: string[];
    }>();

    for (const request of requests) {
      const cycle = request.meeting?.cycle;
      if (!cycle) continue;

      const key = `${request.instructorId}:${cycle.id}`;
      const existing = grouped.get(key);
      const latestMeetingDate = request.meeting?.scheduledDate ?? null;

      if (!existing) {
        grouped.set(key, {
          instructorId: request.instructorId,
          instructorName: request.instructor?.name ?? 'לא ידוע',
          instructorPhone: request.instructor?.phone ?? null,
          cycleId: cycle.id,
          cycleName: cycle.name,
          branchName: cycle.branch?.name ?? null,
          totalMeetings: cycle.totalMeetings,
          cancelCount: request.type === 'cancel' ? 1 : 0,
          postponeCount: request.type === 'postpone' ? 1 : 0,
          totalRiskRequests: 1,
          latestRequestAt: request.createdAt,
          latestMeetingDate,
          requestIds: [request.id],
        });
        continue;
      }

      if (request.type === 'cancel') existing.cancelCount += 1;
      if (request.type === 'postpone') existing.postponeCount += 1;
      existing.totalRiskRequests += 1;
      existing.requestIds.push(request.id);
      if (request.createdAt > existing.latestRequestAt) existing.latestRequestAt = request.createdAt;
      if (latestMeetingDate && (!existing.latestMeetingDate || latestMeetingDate > existing.latestMeetingDate)) {
        existing.latestMeetingDate = latestMeetingDate;
      }
    }

    const risks = Array.from(grouped.values())
      .filter((item) => item.totalRiskRequests >= RISK_MIN_REQUESTS)
      .sort((a, b) => {
        if (b.totalRiskRequests !== a.totalRiskRequests) return b.totalRiskRequests - a.totalRiskRequests;
        return b.latestRequestAt.getTime() - a.latestRequestAt.getTime();
      });

    res.json({
      generatedAt: new Date().toISOString(),
      threshold: {
        minRequests: RISK_MIN_REQUESTS,
        minCycleMeetings: RISK_MIN_CYCLE_MEETINGS,
        requestTypes: RISK_REQUEST_TYPES,
      },
      risks,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/meeting-requests — list requests
meetingRequestsRouter.get('/', async (req, res, next) => {
  try {
    const { meetingId, status: filterStatus, instructorId, cycleId, type } = req.query;

    const where: any = {};

    // Instructors see only their own
    if (req.user!.role === 'instructor') {
      const instructor = await prisma.instructor.findUnique({
        where: { userId: req.user!.userId },
        select: { id: true },
      });
      if (!instructor) {
        throw new AppError(403, 'לא נמצא מדריך מקושר למשתמש');
      }
      where.instructorId = instructor.id;
    }

    if (meetingId) {
      where.meetingId = meetingId;
    }

    if (req.user!.role !== 'instructor' && instructorId) {
      where.instructorId = instructorId;
    }

    if (cycleId) {
      where.meeting = { cycleId };
    }

    if (type) {
      where.type = type;
    }

    if (filterStatus) {
      where.status = filterStatus;
    }

    const requests = await prisma.meetingChangeRequest.findMany({
      where,
      include: {
        meeting: {
          include: {
            cycle: { include: { branch: true } },
          },
        },
        instructor: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(requests);
  } catch (error) {
    next(error);
  }
});

// GET /api/meeting-requests/log — cancellation/postponement history for monitoring instructor load
meetingRequestsRouter.get('/log', async (req, res, next) => {
  try {
    if (!['admin', 'manager', 'operations_control', 'operations_manager'].includes(req.user!.role)) {
      throw new AppError(403, 'אין הרשאה לצפות בלוג בקשות מדריכים');
    }

    const query = logQuerySchema.parse(req.query);
    const createdAt: Record<string, Date> = {};
    const scheduledDate: Record<string, Date> = {};

    if (query.from) createdAt.gte = new Date(query.from);
    if (query.to) {
      const to = new Date(query.to);
      to.setHours(23, 59, 59, 999);
      createdAt.lte = to;
    }
    if (query.meetingFrom) scheduledDate.gte = new Date(query.meetingFrom);
    if (query.meetingTo) scheduledDate.lte = new Date(query.meetingTo);

    const where: any = {
      type: query.type && query.type !== 'all' ? query.type : { in: ['cancel', 'postpone'] },
      ...(query.instructorId && { instructorId: query.instructorId }),
      ...(query.status && query.status !== 'all' && { status: query.status }),
      ...(Object.keys(createdAt).length && { createdAt }),
      ...(Object.keys(scheduledDate).length && { meeting: { scheduledDate } }),
    };

    const requests = await prisma.meetingChangeRequest.findMany({
      where,
      include: {
        meeting: {
          include: {
            cycle: {
              include: {
                branch: true,
                course: true,
              },
            },
          },
        },
        instructor: true,
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });

    const byInstructor = new Map<string, {
      instructorId: string;
      instructorName: string;
      total: number;
      cancel: number;
      postpone: number;
      replacement: number;
      pending: number;
      approved: number;
      rejected: number;
      lastRequestAt: Date | null;
    }>();

    const totals = {
      total: 0,
      cancel: 0,
      postpone: 0,
      replacement: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
    };

    for (const request of requests) {
      totals.total += 1;
      if (request.type in totals) totals[request.type as 'cancel' | 'postpone' | 'replacement'] += 1;
      if (request.status in totals) totals[request.status as 'pending' | 'approved' | 'rejected'] += 1;

      const existing = byInstructor.get(request.instructorId) ?? {
        instructorId: request.instructorId,
        instructorName: request.instructor.name,
        total: 0,
        cancel: 0,
        postpone: 0,
        replacement: 0,
        pending: 0,
        approved: 0,
        rejected: 0,
        lastRequestAt: null,
      };

      existing.total += 1;
      if (request.type === 'cancel') existing.cancel += 1;
      if (request.type === 'postpone') existing.postpone += 1;
      if (request.type === 'replacement') existing.replacement += 1;
      if (request.status === 'pending') existing.pending += 1;
      if (request.status === 'approved') existing.approved += 1;
      if (request.status === 'rejected') existing.rejected += 1;
      if (!existing.lastRequestAt || request.createdAt > existing.lastRequestAt) {
        existing.lastRequestAt = request.createdAt;
      }
      byInstructor.set(request.instructorId, existing);
    }

    res.json({
      summary: {
        totals,
        byInstructor: Array.from(byInstructor.values()).sort((a, b) => b.total - a.total),
      },
      requests,
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/meeting-requests/:id/approve
meetingRequestsRouter.put('/:id/approve', async (req, res, next) => {
  try {
    if (req.user!.role === 'instructor') {
      throw new AppError(403, 'אין הרשאה לאשר בקשות');
    }
    const review = reviewRequestSchema.parse(req.body ?? {});

    const request = await prisma.meetingChangeRequest.findUnique({
      where: { id: req.params.id },
      include: { meeting: { include: { cycle: true } } },
    });

    if (!request) {
      throw new AppError(404, 'בקשה לא נמצאה');
    }

    if (request.status !== 'pending') {
      throw new AppError(400, 'הבקשה כבר טופלה');
    }

    // Execute the action based on type
    if (request.type === 'cancel') {
      await prisma.meeting.update({
        where: { id: request.meetingId },
        data: {
          status: 'cancelled',
          statusUpdatedAt: new Date(),
          statusUpdatedById: req.user!.userId,
        },
      });
    } else if (request.type === 'postpone') {
      await prisma.meeting.update({
        where: { id: request.meetingId },
        data: {
          status: 'postponed',
          statusUpdatedAt: new Date(),
          statusUpdatedById: req.user!.userId,
        },
      });
      // Add replacement meeting at end of cycle (with retry + admin notification on failure)
      const replacementId = await addReplacementMeetingWithRetry(
        request.meetingId,
        req.user!.userId,
        request.meeting?.cycle?.name ?? 'לא ידוע'
      );
      if (!replacementId) {
        console.error('[ReplacementMeeting] All retries failed for meeting-request approval:', request.meetingId);
      }
    }
    // 'replacement' type — just mark as approved, admin handles manually

    const updated = await prisma.meetingChangeRequest.update({
      where: { id: req.params.id },
      data: {
        status: 'approved',
        reviewedBy: req.user!.userId,
        reviewedAt: new Date(),
        reviewNotes: review.reviewNotes || review.reason || null,
      },
      include: {
        meeting: { include: { cycle: true } },
        instructor: true,
      },
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// PUT /api/meeting-requests/:id/reject
meetingRequestsRouter.put('/:id/reject', async (req, res, next) => {
  try {
    if (req.user!.role === 'instructor') {
      throw new AppError(403, 'אין הרשאה לדחות בקשות');
    }
    const review = reviewRequestSchema.parse(req.body ?? {});

    const request = await prisma.meetingChangeRequest.findUnique({
      where: { id: req.params.id },
    });

    if (!request) {
      throw new AppError(404, 'בקשה לא נמצאה');
    }

    if (request.status !== 'pending') {
      throw new AppError(400, 'הבקשה כבר טופלה');
    }

    const updated = await prisma.meetingChangeRequest.update({
      where: { id: req.params.id },
      data: {
        status: 'rejected',
        reviewedBy: req.user!.userId,
        reviewedAt: new Date(),
        reviewNotes: review.reviewNotes || review.reason || null,
      },
      include: {
        meeting: { include: { cycle: true } },
        instructor: true,
      },
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});
