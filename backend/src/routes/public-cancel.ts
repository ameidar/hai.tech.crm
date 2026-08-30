import { Router } from 'express';
import { prisma } from '../utils/prisma.js';
import { sendWhatsAppMessage } from '../services/notifications.js';
import { recalcMeetingRevenue } from '../utils/recalcMeetingRevenue.js';
import { logAudit } from '../utils/audit.js';
import { notifyCancellationSubmitted } from '../services/cancellations.js';

export const publicCancelRouter = Router();

// GET /api/public/cancel/:token — get registration details for cancellation form
publicCancelRouter.get('/:token', async (req, res, next) => {
  try {
    const { token } = req.params;

    const cancellationRequest = await prisma.cancellationRequest.findUnique({
      where: { token },
      include: {
        registration: {
          include: {
            student: { select: { id: true, name: true } },
            cycle: {
              include: {
                course: { select: { id: true, name: true } },
                meetings: {
                  select: { id: true, status: true },
                },
              },
            },
          },
        },
      },
    });

    if (!cancellationRequest) {
      return res.status(404).json({ error: 'טופס ביטול לא נמצא' });
    }

    if (cancellationRequest.status === 'submitted') {
      return res.status(400).json({ error: 'טופס ביטול כבר הוגש', alreadySubmitted: true });
    }

    const meetings = cancellationRequest.registration.cycle.meetings || [];
    const completedMeetings = meetings.filter((m) => m.status === 'completed').length;
    const totalMeetings = meetings.length;

    res.json({
      studentName: cancellationRequest.studentName,
      customerName: cancellationRequest.customerName,
      courseName: cancellationRequest.registration.cycle.course?.name || cancellationRequest.registration.cycle.name,
      completedMeetings,
      totalMeetings,
      status: cancellationRequest.status,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/public/cancel/:token — submit cancellation form
publicCancelRouter.post('/:token', async (req, res, next) => {
  try {
    const { token } = req.params;
    const { reason, signature } = req.body;

    const cancellationRequest = await prisma.cancellationRequest.findUnique({
      where: { token },
      include: {
        registration: {
          include: {
            student: { select: { id: true, name: true } },
            cycle: {
              include: {
                course: { select: { id: true, name: true } },
                instructor: { select: { id: true, name: true, phone: true } },
              },
            },
          },
        },
      },
    });

    if (!cancellationRequest) {
      return res.status(404).json({ error: 'טופס ביטול לא נמצא' });
    }

    if (cancellationRequest.status === 'submitted') {
      return res.status(400).json({ error: 'טופס ביטול כבר הוגש' });
    }

    // Update cancellation request
    await prisma.cancellationRequest.update({
      where: { token },
      data: {
        reason,
        signature,
        status: 'submitted',
        submittedAt: new Date(),
      },
    });

    // Update registration status
    await prisma.registration.update({
      where: { id: cancellationRequest.registrationId },
      data: {
        status: 'pending_cancellation',
        cancellationDate: new Date(),
        cancellationReason: reason,
      },
    });

    // Final cancellation is a staff decision. A public form only marks the
    // registration as pending and notifies operations.
    const cycleId = cancellationRequest.registration.cycleId;

    const reg = cancellationRequest.registration;
    const courseName = reg.cycle.course?.name || reg.cycle.name;
    // Recalculate future meeting revenues based on new student count
    recalcMeetingRevenue(cycleId).catch((err: unknown) =>
      console.error('[PublicCancel] Failed to recalc meeting revenue:', err)
    );

    // Send notifications — non-blocking (don't fail the request if these fail)
    notifyCancellationSubmitted(cancellationRequest.registrationId, reason)
      .catch((err: unknown) => console.error('[PublicCancel] Failed to send cancellation notification:', err));

    logAudit({
      action: 'UPDATE',
      entity: 'CancellationRequest',
      entityId: cancellationRequest.id,
      newValue: {
        status: 'submitted',
        registrationId: cancellationRequest.registrationId,
        cycleId,
        reason,
        customerName: cancellationRequest.customerName,
        studentName: cancellationRequest.studentName,
      },
      req,
    }).catch((err: unknown) => console.error('[PublicCancel] Failed to log audit:', err));

    const instructor = reg.cycle.instructor;
    if (instructor?.phone) {
      const cycleName = reg.cycle.name || courseName;
      sendWhatsAppMessage(
        instructor.phone,
        `שים לב: בקשת ביטול התקבלה עבור ${reg.student.name} במחזור ${cycleName}`
      ).catch((err: unknown) => console.error('[PublicCancel] Failed to send instructor WhatsApp:', err));
    }

    res.json({ success: true, message: 'בקשת הביטול נשלחה בהצלחה' });
  } catch (error) {
    next(error);
  }
});
