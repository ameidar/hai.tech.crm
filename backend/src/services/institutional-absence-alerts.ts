import { AttendanceStatus, MeetingStatus } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { sendWhatsApp, MessageResult } from './messaging.js';

const TZ = 'Asia/Jerusalem';
const APP_URL = process.env.FRONTEND_URL || 'https://crm.orma-ai.com';

type AbsenceAlertRecipient = {
  name: string;
  phone: string;
};

const DEFAULT_RECIPIENTS: AbsenceAlertRecipient[] = [
  { name: 'קים', phone: '0543354550' },
];

function parseRecipients(raw: string | undefined): AbsenceAlertRecipient[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.split('|').map((part) => part.trim()))
    .filter(([name, phone]) => Boolean(name && phone))
    .map(([name, phone]) => ({ name, phone }));
}

function getRecipients(): AbsenceAlertRecipient[] {
  const configured = parseRecipients(process.env.INSTITUTIONAL_ABSENCE_ALERT_RECIPIENTS);
  return configured.length ? configured : DEFAULT_RECIPIENTS;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: TZ,
  });
}

function formatTime(time: Date | string | null): string {
  if (!time) return '';
  const d = typeof time === 'string' ? new Date(time) : time;
  return `${d.getUTCHours().toString().padStart(2, '0')}:${d.getUTCMinutes().toString().padStart(2, '0')}`;
}

function compactLine(label: string, value?: string | null): string | null {
  const trimmed = (value || '').trim();
  return trimmed ? `${label}: ${trimmed}` : null;
}

type AttendanceForAlert = NonNullable<Awaited<ReturnType<typeof loadAttendanceForAlert>>>;
type MeetingForMissingAttendanceAlert = NonNullable<Awaited<ReturnType<typeof loadMeetingForMissingAttendanceAlert>>>;

async function loadAttendanceForAlert(attendanceId: string) {
  return prisma.attendance.findUnique({
    where: { id: attendanceId },
    include: {
      meeting: {
        include: {
          instructor: { select: { name: true } },
          cycle: {
            include: {
              course: { select: { name: true } },
              branch: { select: { name: true } },
              institutionalOrder: { select: { orderName: true, orderNumber: true } },
            },
          },
        },
      },
      registration: {
        include: {
          student: {
            include: {
              customer: { select: { name: true, phone: true, email: true } },
            },
          },
        },
      },
      student: {
        include: {
          customer: { select: { name: true, phone: true, email: true } },
        },
      },
    },
  });
}

function buildMessage(attendance: AttendanceForAlert): string {
  const meeting = attendance.meeting;
  const cycle = meeting.cycle;
  const student = attendance.registration?.student || attendance.student;
  const customer = student?.customer;
  const meetingUrl = `${APP_URL}/meetings/${meeting.id}`;

  const lines = [
    '⚠️ ילד סומן כלא נוכח בשיעור מוסדי',
    '',
    compactLine('ילד', student?.name || attendance.guestName || 'לא ידוע'),
    compactLine('הורה', customer?.name),
    compactLine('טלפון הורה', customer?.phone),
    compactLine('אימייל הורה', customer?.email),
    '',
    compactLine('מחזור', cycle.name),
    compactLine('קורס', cycle.course?.name),
    compactLine('סניף', cycle.branch?.name),
    compactLine('הזמנה מוסדית', cycle.institutionalOrder?.orderName || cycle.institutionalOrder?.orderNumber),
    compactLine('מדריך', meeting.instructor?.name),
    compactLine('תאריך', formatDate(meeting.scheduledDate)),
    compactLine('שעה', formatTime(meeting.startTime)),
    attendance.notes ? compactLine('הערות נוכחות', attendance.notes) : null,
    '',
    `לבדיקה ב-CRM: ${meetingUrl}`,
  ];

  return lines.filter((line) => line !== null).join('\n');
}

async function loadMeetingForMissingAttendanceAlert(meetingId: string) {
  return prisma.meeting.findUnique({
    where: { id: meetingId },
    include: {
      instructor: { select: { name: true } },
      attendance: { select: { registrationId: true } },
      cycle: {
        include: {
          course: { select: { name: true } },
          branch: { select: { name: true } },
          institutionalOrder: { select: { orderName: true, orderNumber: true } },
          registrations: {
            where: { status: { in: ['registered', 'active', 'completed'] } },
            include: {
              student: {
                include: {
                  customer: { select: { name: true, phone: true, email: true } },
                },
              },
            },
            orderBy: { student: { name: 'asc' } },
          },
        },
      },
    },
  });
}

function getMissingAttendanceRegistrations(meeting: MeetingForMissingAttendanceAlert) {
  const markedRegistrationIds = new Set(
    meeting.attendance
      .map((attendance) => attendance.registrationId)
      .filter((registrationId): registrationId is string => Boolean(registrationId)),
  );

  return meeting.cycle.registrations.filter((registration) => !markedRegistrationIds.has(registration.id));
}

function buildMissingAttendanceMessage(meeting: MeetingForMissingAttendanceAlert): string {
  const cycle = meeting.cycle;
  const missing = getMissingAttendanceRegistrations(meeting);
  const meetingUrl = `${APP_URL}/meetings/${meeting.id}`;
  const listed = missing.slice(0, 20).map((registration) => {
    const customer = registration.student.customer;
    const parent = customer?.name ? ` | הורה: ${customer.name}` : '';
    const phone = customer?.phone ? ` | ${customer.phone}` : '';
    return `• ${registration.student.name}${parent}${phone}`;
  });

  const more = missing.length > listed.length
    ? [`ועוד ${missing.length - listed.length} ילדים שלא מוצגים בהודעה.`]
    : [];

  const lines = [
    '⚠️ פגישה מוסדית סומנה כהתקיימה אבל הנוכחות לא מלאה',
    '',
    compactLine('מחזור', cycle.name),
    compactLine('קורס', cycle.course?.name),
    compactLine('סניף', cycle.branch?.name),
    compactLine('הזמנה מוסדית', cycle.institutionalOrder?.orderName || cycle.institutionalOrder?.orderNumber),
    compactLine('מדריך', meeting.instructor?.name),
    compactLine('תאריך', formatDate(meeting.scheduledDate)),
    compactLine('שעה', formatTime(meeting.startTime)),
    compactLine('חסרים סימוני נוכחות', String(missing.length)),
    '',
    ...listed,
    ...more,
    '',
    `נא לבדוק מול המדריך/ה למה הנוכחות לא מולאה.`,
    `לבדיקה ב-CRM: ${meetingUrl}`,
  ];

  return lines.filter((line) => line !== null).join('\n');
}

async function sendAlert(message: string): Promise<MessageResult[]> {
  const recipients = getRecipients();
  return Promise.all(recipients.map((recipient) => sendWhatsApp({ phone: recipient.phone, message })));
}

export async function handleInstitutionalAbsenceAlert(attendanceId: string): Promise<void> {
  const attendance = await loadAttendanceForAlert(attendanceId);
  if (!attendance) return;

  if (attendance.status !== AttendanceStatus.absent) {
    if (attendance.institutionalAbsenceAlertSentAt) {
      await prisma.attendance.update({
        where: { id: attendance.id },
        data: { institutionalAbsenceAlertSentAt: null },
      });
    }
    return;
  }

  if (attendance.institutionalAbsenceAlertSentAt) return;
  if (!attendance.meeting.cycle.institutionalOrderId) return;
  if (attendance.meeting.deletedAt) return;
  if (attendance.meeting.status !== 'completed') return;

  const message = buildMessage(attendance);
  const results = await sendAlert(message);
  const successCount = results.filter((result) => result.success).length;

  if (successCount === 0) {
    console.error(`[InstitutionalAbsenceAlert] failed for attendance ${attendance.id}: ${results.map((result) => result.error).join('; ')}`);
    return;
  }

  await prisma.attendance.update({
    where: { id: attendance.id },
    data: { institutionalAbsenceAlertSentAt: new Date() },
  });
  console.log(`[InstitutionalAbsenceAlert] sent for attendance ${attendance.id}`);
}

export async function handleInstitutionalMissingAttendanceAlert(meetingId: string): Promise<void> {
  const meeting = await loadMeetingForMissingAttendanceAlert(meetingId);
  if (!meeting) return;
  if (meeting.institutionalAttendanceMissingAlertSentAt) return;
  if (meeting.status !== MeetingStatus.completed) return;
  if (meeting.deletedAt) return;
  if (!meeting.cycle.institutionalOrderId || meeting.cycle.deletedAt) return;

  const missing = getMissingAttendanceRegistrations(meeting);
  if (missing.length === 0) {
    await prisma.meeting.update({
      where: { id: meeting.id },
      data: { institutionalAttendanceMissingAlertSentAt: new Date() },
    });
    return;
  }

  const message = buildMissingAttendanceMessage(meeting);
  const results = await sendAlert(message);
  const successCount = results.filter((result) => result.success).length;

  if (successCount === 0) {
    console.error(`[InstitutionalAbsenceAlert] missing attendance send failed for meeting ${meeting.id}: ${results.map((result) => result.error).join('; ')}`);
    return;
  }

  await prisma.meeting.update({
    where: { id: meeting.id },
    data: { institutionalAttendanceMissingAlertSentAt: new Date() },
  });
  console.log(`[InstitutionalAbsenceAlert] missing attendance alert sent for meeting ${meeting.id}`);
}

export async function sendPendingInstitutionalAbsenceAlerts(limit = 50): Promise<number> {
  const pending = await prisma.attendance.findMany({
    where: {
      status: AttendanceStatus.absent,
      institutionalAbsenceAlertSentAt: null,
      meeting: {
        status: 'completed',
        deletedAt: null,
        cycle: {
          institutionalOrderId: { not: null },
          deletedAt: null,
        },
      },
    },
    select: { id: true },
    orderBy: { recordedAt: 'asc' },
    take: limit,
  });

  let processed = 0;
  for (const attendance of pending) {
    await handleInstitutionalAbsenceAlert(attendance.id);
    processed += 1;
  }
  return processed;
}

export async function sendPendingInstitutionalMissingAttendanceAlerts(limit = 50): Promise<number> {
  const pending = await prisma.meeting.findMany({
    where: {
      status: MeetingStatus.completed,
      institutionalAttendanceMissingAlertSentAt: null,
      deletedAt: null,
      cycle: {
        institutionalOrderId: { not: null },
        deletedAt: null,
      },
    },
    select: { id: true },
    orderBy: [{ scheduledDate: 'asc' }, { startTime: 'asc' }],
    take: limit,
  });

  let processed = 0;
  for (const meeting of pending) {
    await handleInstitutionalMissingAttendanceAlert(meeting.id);
    processed += 1;
  }
  return processed;
}

export async function sendPendingInstitutionalAttendanceAlerts(limit = 50): Promise<number> {
  const [absenceCount, missingAttendanceCount] = await Promise.all([
    sendPendingInstitutionalAbsenceAlerts(limit),
    sendPendingInstitutionalMissingAttendanceAlerts(limit),
  ]);
  return absenceCount + missingAttendanceCount;
}
