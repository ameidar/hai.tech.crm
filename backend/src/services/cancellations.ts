import type { Request } from 'express';
import { prisma } from '../utils/prisma.js';
import { logAudit } from '../utils/audit.js';
import { sendEmail } from './notifications.js';
import { deleteMeeting as deleteZoomMeeting } from './zoom.js';
import { googleMeetService } from './google-meet.js';

const APP_URL = process.env.FRONTEND_URL || 'https://crm.orma-ai.com';
const CANCELLATION_ALERT_EMAILS = process.env.CANCELLATION_ALERT_EMAILS || 'info@hai.tech,inna@hai.tech';
const ILS = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' });

function israelTodayDateOnly(): Date {
  const israelDate = new Intl.DateTimeFormat('sv', { timeZone: 'Asia/Jerusalem' }).format(new Date());
  const [year, month, day] = israelDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function money(value: number): string {
  return ILS.format(Math.max(0, Math.round(value * 100) / 100));
}

function dbMoney(value: unknown): number {
  return Number(value || 0);
}

export function calculateCancellationRefund(params: {
  paidAmount: number;
  totalMeetings: number;
  completedMeetings: number;
}) {
  const paidAmount = Math.max(0, params.paidAmount || 0);
  const totalMeetings = Math.max(0, params.totalMeetings || 0);
  const completedMeetings = Math.max(0, params.completedMeetings || 0);
  const perMeeting = totalMeetings > 0 ? paidAmount / totalMeetings : 0;
  const consumedAmount = Math.min(paidAmount, perMeeting * completedMeetings);
  const refundAmount = Math.max(0, paidAmount - consumedAmount);

  return {
    paidAmount: Math.round(paidAmount * 100) / 100,
    totalMeetings,
    completedMeetings,
    perMeeting: Math.round(perMeeting * 100) / 100,
    consumedAmount: Math.round(consumedAmount * 100) / 100,
    refundAmount: Math.round(refundAmount * 100) / 100,
  };
}

async function releaseMeetingLink(meeting: {
  id: string;
  zoomMeetingId: string | null;
  zoomHostEmail: string | null;
  googleMeetSpaceName: string | null;
  googleCalendarEventId: string | null;
  videoProvider: string | null;
}) {
  if (meeting.videoProvider === 'google_meet') {
    try {
      await googleMeetService.deleteGoogleMeetMeeting({
        hostEmail: meeting.zoomHostEmail,
        googleMeetSpaceName: meeting.googleMeetSpaceName,
        googleCalendarEventIds: [meeting.googleCalendarEventId],
      });
      console.log(`[CANCEL CASCADE] Released Google Meet/Calendar for meeting ${meeting.id}`);
    } catch (error) {
      console.error(`[CANCEL CASCADE] Failed to release Google Meet/Calendar for meeting ${meeting.id}:`, error);
    }
    return;
  }

  if (meeting.zoomMeetingId) {
    try {
      await deleteZoomMeeting(meeting.zoomMeetingId);
      console.log(`[CANCEL CASCADE] Deleted Zoom meeting ${meeting.zoomMeetingId}`);
    } catch (error) {
      console.error(`[CANCEL CASCADE] Failed to delete Zoom ${meeting.zoomMeetingId}:`, error);
    }
  }
}

export async function cancelFutureMeetingsForCycle(
  cycleId: string,
  options: { req?: Request; markCycleCancelled?: boolean } = {}
) {
  const today = israelTodayDateOnly();
  const cycle = options.markCycleCancelled
    ? await prisma.cycle.findUnique({
        where: { id: cycleId },
        select: {
          zoomMeetingId: true,
          zoomHostEmail: true,
          googleMeetSpaceName: true,
          googleCalendarEventId: true,
          videoProvider: true,
        },
      })
    : null;

  const futureMeetings = await prisma.meeting.findMany({
    where: {
      cycleId,
      status: { in: ['scheduled', 'postponed', 'pending_cancellation', 'pending_postponement'] },
      scheduledDate: { gte: today },
      deletedAt: null,
    },
    select: {
      id: true,
      zoomMeetingId: true,
      zoomJoinUrl: true,
      zoomStartUrl: true,
      zoomHostEmail: true,
      zoomHostKey: true,
      zoomPassword: true,
      googleMeetSpaceName: true,
      googleCalendarEventId: true,
      videoProvider: true,
    },
  });

  if (options.markCycleCancelled) {
    if (cycle) {
      await releaseMeetingLink({ id: cycleId, ...cycle });
    }

    await prisma.cycle.update({
      where: { id: cycleId },
      data: {
        status: 'cancelled',
        zoomMeetingId: null,
        zoomJoinUrl: null,
        zoomHostEmail: null,
        zoomHostKey: null,
        zoomPassword: null,
        googleMeetSpaceName: null,
        googleCalendarEventId: null,
      },
    });
  }

  for (const meeting of futureMeetings) {
    await releaseMeetingLink(meeting);
  }

  const cascade = futureMeetings.length
    ? await prisma.meeting.updateMany({
        where: { id: { in: futureMeetings.map((meeting) => meeting.id) } },
        data: {
          status: 'cancelled',
          statusUpdatedAt: new Date(),
          statusUpdatedById: (options.req as any)?.user?.userId ?? null,
          zoomMeetingId: null,
          zoomJoinUrl: null,
          zoomStartUrl: null,
          zoomHostKey: null,
          zoomPassword: null,
          googleMeetSpaceName: null,
          googleCalendarEventId: null,
        },
      })
    : { count: 0 };

  await logAudit({
    action: 'UPDATE',
    entity: 'CycleCancellationCascade',
    entityId: cycleId,
    newValue: {
      markCycleCancelled: Boolean(options.markCycleCancelled),
      cancelledFutureMeetings: cascade.count,
      futureMeetingIds: futureMeetings.map((meeting) => meeting.id),
    },
    req: options.req,
  });

  console.log(`[CANCEL CASCADE] Cancelled ${cascade.count} future meetings for cycle ${cycleId}`);
  return { cancelledMeetings: cascade.count };
}

export async function notifyCancellationSubmitted(registrationId: string, reason?: string | null) {
  const registration = await prisma.registration.findUnique({
    where: { id: registrationId },
    include: {
      student: { include: { customer: true } },
      cycle: {
        include: {
          course: true,
          meetings: { select: { status: true } },
        },
      },
    },
  });

  if (!registration) return;

  const completedMeetings = registration.cycle.meetings.filter((meeting) => meeting.status === 'completed').length;
  const refund = calculateCancellationRefund({
    paidAmount: dbMoney(registration.amount),
    totalMeetings: registration.cycle.totalMeetings || registration.cycle.meetings.length,
    completedMeetings,
  });
  const courseName = registration.cycle.course?.name || registration.cycle.name;
  const crmLink = `${APP_URL}/cycles/${registration.cycleId}`;
  const reasonText = reason?.trim() || registration.cancellationReason || 'לא צוינה';

  const html = `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; direction: rtl; color: #111827;">
  <h2>בקשת ביטול חדשה ממתינה לאישור</h2>
  <p>הלקוחה הגישה טופס ביטול. המחזור והרישום לא בוטלו סופית אוטומטית.</p>
  <table style="border-collapse: collapse; width: 100%; max-width: 720px;">
    <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">לקוח/ה</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${registration.student.customer.name}</td></tr>
    <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">טלפון</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${registration.student.customer.phone || '-'}</td></tr>
    <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">תלמיד/ה</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${registration.student.name}</td></tr>
    <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">קורס/מחזור</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${courseName} / ${registration.cycle.name}</td></tr>
    <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">סיבת ביטול</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${reasonText}</td></tr>
    <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">שיעורים שהתקיימו</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${refund.completedMeetings} מתוך ${refund.totalMeetings}</td></tr>
    <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">סכום ששולם/נרשם</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${money(refund.paidAmount)}</td></tr>
    <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">שווי שיעור לחישוב</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${money(refund.perMeeting)}</td></tr>
    <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">צריכה עד הביטול</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${money(refund.consumedAmount)}</td></tr>
    <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">החזר מומלץ לבדיקה</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${money(refund.refundAmount)}</td></tr>
  </table>
  <p><a href="${crmLink}">פתיחת המחזור ב-CRM</a></p>
  <p style="color: #6b7280;">החישוב הוא לפי יתרת שיעורים שלא התקיימו, ומיועד לבדיקה ואישור סופי של הצוות.</p>
</body>
</html>`;

  const recipients = CANCELLATION_ALERT_EMAILS
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean);

  await Promise.all(recipients.map((to) =>
    sendEmail(to, `בקשת ביטול ממתינה - ${registration.student.name} - ${courseName}`, html)
  ));
}
