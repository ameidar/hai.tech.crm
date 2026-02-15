import { Router } from 'express';
import { prisma } from '../utils/prisma.js';
import { sendEmail, sendWhatsAppMessage } from '../services/notifications.js';
import { deleteMeeting as deleteZoomMeeting } from '../services/zoom.js';

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

    // Cascade: check if cycle should be cancelled (import inline to avoid circular)
    const cycleId = cancellationRequest.registration.cycleId;
    const activeCount = await prisma.registration.count({
      where: { cycleId, status: { in: ['registered', 'active'] } },
    });
    if (activeCount === 0) {
      await prisma.cycle.update({ where: { id: cycleId }, data: { status: 'cancelled' } });
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const futureMeetings = await prisma.meeting.findMany({
        where: { cycleId, status: 'scheduled', scheduledDate: { gte: today } },
      });
      for (const m of futureMeetings) {
        await prisma.meeting.update({
          where: { id: m.id },
          data: { status: 'cancelled', zoomMeetingId: null, zoomJoinUrl: null, zoomStartUrl: null },
        });
        if (m.zoomMeetingId) {
          deleteZoomMeeting(m.zoomMeetingId).catch(err =>
            console.error(`[CANCEL CASCADE] Failed to delete Zoom ${m.zoomMeetingId}:`, err)
          );
        }
      }
    }

    const reg = cancellationRequest.registration;
    const courseName = reg.cycle.course?.name || reg.cycle.name;
    const crmLink = `http://129.159.133.209:3002/cycles/${reg.cycleId}`;

    // Send email to admin
    const adminEmailHtml = `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"></head>
<body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; direction: rtl;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #dc2626;">🔴 בקשת ביטול חדשה</h2>
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <tr><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">שם תלמיד/ה:</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${reg.student.name}</td></tr>
      <tr><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">שם הורה:</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${cancellationRequest.customerName}</td></tr>
      <tr><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">קורס:</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${courseName}</td></tr>
      <tr><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">סיבת ביטול:</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${reason || 'לא צוינה'}</td></tr>
      <tr><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">חתימה:</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${signature || 'לא צוינה'}</td></tr>
    </table>
    <p><a href="${crmLink}" style="color: #2563eb;">צפייה בהרשמה ב-CRM</a></p>
    <p><strong>קישור לחשבונית:</strong> ${reg.invoiceLink ? `<a href="${reg.invoiceLink}">${reg.invoiceLink}</a>` : 'לא צורף'}</p>
  </div>
</body>
</html>`;

    await sendEmail('info@hai.tech', `בקשת ביטול - ${reg.student.name} - ${courseName}`, adminEmailHtml);

    // Send WhatsApp to instructor
    const instructor = reg.cycle.instructor;
    if (instructor?.phone) {
      const cycleName = reg.cycle.name || courseName;
      await sendWhatsAppMessage(
        instructor.phone,
        `שים לב: בקשת ביטול התקבלה עבור ${reg.student.name} במחזור ${cycleName}`
      );
    }

    res.json({ success: true, message: 'בקשת הביטול נשלחה בהצלחה' });
  } catch (error) {
    next(error);
  }
});
