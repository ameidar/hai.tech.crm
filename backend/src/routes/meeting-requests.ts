import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { sendEmail } from '../services/email/sender.js';
import { config } from '../config.js';
import { addReplacementMeeting } from '../services/replacement-meeting.js';

export const meetingRequestsRouter = Router();

// All routes require authentication
meetingRequestsRouter.use(authenticate);

const createRequestSchema = z.object({
  meetingId: z.string().uuid(),
  type: z.enum(['cancel', 'postpone', 'replacement']),
  reason: z.string().min(1, 'סיבה היא שדה חובה'),
});

const typeHebrew: Record<string, string> = {
  cancel: 'ביטול',
  postpone: 'דחייה',
  replacement: 'החלפה',
};

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

// GET /api/meeting-requests — list requests
meetingRequestsRouter.get('/', async (req, res, next) => {
  try {
    const { meetingId, status: filterStatus } = req.query;

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

// PUT /api/meeting-requests/:id/approve
meetingRequestsRouter.put('/:id/approve', async (req, res, next) => {
  try {
    if (req.user!.role === 'instructor') {
      throw new AppError(403, 'אין הרשאה לאשר בקשות');
    }

    const request = await prisma.meetingChangeRequest.findUnique({
      where: { id: req.params.id },
      include: { meeting: true },
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
      // Add replacement meeting at end of cycle (fire & forget — Zoom setup may take time)
      addReplacementMeeting(request.meetingId, req.user!.userId).catch(err => {
        console.error('[ReplacementMeeting] Failed to add replacement meeting:', err);
      });
    }
    // 'replacement' type — just mark as approved, admin handles manually

    const updated = await prisma.meetingChangeRequest.update({
      where: { id: req.params.id },
      data: {
        status: 'approved',
        reviewedBy: req.user!.userId,
        reviewedAt: new Date(),
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
