/**
 * Public appointment view/cancel — lets the person who booked an intro
 * meeting see its details and cancel it, via a tokenized link (no auth).
 */
import { Router } from 'express';
import { prisma } from '../utils/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { verifyAppointmentToken } from '../services/appointment-manage.js';
import { deleteCalendarEvent } from '../services/google-calendar.js';
import { sendWhatsAppMessage } from '../services/notifications.js';
import { sendEmail } from '../services/email/sender.js';
import { config } from '../config.js';

export const publicAppointmentRouter = Router();

const ADMIN_PHONE = '0528746137';

// Appointment day (YYYY-MM-DD) in Israel time, for "is it in the past" checks
function appointmentDay(date: Date): string {
  return new Date(date).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
}

function todayInIsrael(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
}

function canCancel(appointment: { appointmentStatus: string; appointmentDate: Date | null }): boolean {
  if (!['pending', 'queued', 'scheduled'].includes(appointment.appointmentStatus)) return false;
  if (appointment.appointmentDate && appointmentDay(appointment.appointmentDate) < todayInIsrael()) {
    return false;
  }
  return true;
}

// GET /api/public/appointment/:id/:token — appointment details for the customer
publicAppointmentRouter.get('/:id/:token', async (req, res, next) => {
  try {
    const { id, token } = req.params;
    if (!verifyAppointmentToken(id, token)) {
      throw new AppError(403, 'קישור לא תקין');
    }

    const appointment = await prisma.leadAppointment.findUnique({
      where: { id },
      select: {
        id: true,
        customerName: true,
        childName: true,
        interest: true,
        appointmentDate: true,
        appointmentTime: true,
        appointmentStatus: true,
        cancelledAt: true,
      },
    });
    if (!appointment) {
      throw new AppError(404, 'פגישה לא נמצאה');
    }

    res.json({
      customerName: appointment.customerName,
      childName: appointment.childName,
      interest: appointment.interest,
      appointmentDate: appointment.appointmentDate,
      appointmentTime: appointment.appointmentTime,
      status: appointment.appointmentStatus,
      cancelledAt: appointment.cancelledAt,
      canCancel: canCancel(appointment),
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/public/appointment/:id/:token/cancel — customer cancels the appointment
publicAppointmentRouter.post('/:id/:token/cancel', async (req, res, next) => {
  try {
    const { id, token } = req.params;
    if (!verifyAppointmentToken(id, token)) {
      throw new AppError(403, 'קישור לא תקין');
    }

    const appointment = await prisma.leadAppointment.findUnique({ where: { id } });
    if (!appointment) {
      throw new AppError(404, 'פגישה לא נמצאה');
    }

    if (appointment.appointmentStatus === 'cancelled') {
      return res.json({ success: true, alreadyCancelled: true });
    }
    if (!canCancel(appointment)) {
      throw new AppError(400, 'לא ניתן לבטל פגישה זו');
    }

    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 1000) : '';

    await prisma.leadAppointment.update({
      where: { id },
      data: {
        appointmentStatus: 'cancelled',
        cancelledAt: new Date(),
        cancelReason: reason || null,
      },
    });

    // Remove the Google Calendar event (fire & forget — cancellation already recorded)
    if (appointment.calendarEventId) {
      deleteCalendarEvent(appointment.calendarEventId).catch((err) =>
        console.error('[PUBLIC APPOINTMENT] Failed to delete calendar event:', err)
      );
    }

    // Notify the team (fire & forget)
    const dateStr = appointment.appointmentDate
      ? new Date(appointment.appointmentDate).toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' })
      : 'לא ידוע';
    const timeStr = appointment.appointmentTime || '';

    const waMessage = [
      '❌ ביטול פגישת היכרות ע"י הלקוח',
      `👤 ${appointment.customerName}`,
      `📞 ${appointment.customerPhone}`,
      `📅 ${dateStr} ${timeStr}`.trim(),
      reason ? `📝 סיבה: ${reason}` : '',
    ].filter(Boolean).join('\n');
    sendWhatsAppMessage(ADMIN_PHONE, waMessage).catch((err) =>
      console.error('[PUBLIC APPOINTMENT] Failed to send WhatsApp notification:', err)
    );

    sendEmail({
      to: ['info@hai.tech'],
      subject: `ביטול פגישת היכרות - ${appointment.customerName}`,
      html: `
        <div dir="rtl" style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px;">
          <h2 style="color: #dc2626;">❌ הלקוח ביטל פגישת היכרות</h2>
          <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold; width: 120px;">שם:</td>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${appointment.customerName}</td>
            </tr>
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">טלפון:</td>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${appointment.customerPhone}</td>
            </tr>
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">מועד הפגישה:</td>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${dateStr} ${timeStr}</td>
            </tr>
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">סיבת הביטול:</td>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${reason || 'לא צוינה'}</td>
            </tr>
          </table>
          <div style="margin-top: 20px;">
            <a href="${config.frontendUrl}/lead-appointments?id=${appointment.id}"
               style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">
              פתח ליד במערכת
            </a>
          </div>
        </div>
      `,
    }).catch((err) => console.error('[PUBLIC APPOINTMENT] Failed to send email notification:', err));

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});
