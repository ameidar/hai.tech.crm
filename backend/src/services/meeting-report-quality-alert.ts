import { prisma } from '../utils/prisma.js';
import { sendOperationsWhatsApp } from './operations-notifications.js';
import { generateMeetingMagicLink } from './instructor-reminder.service.js';
import { sendWhatsAppCloudTemplate } from './whatsapp-cloud-templates.js';

const TZ = 'Asia/Jerusalem';
const APP_URL = process.env.FRONTEND_URL || 'https://crm.orma-ai.com';
// Dedicated UTILITY template: {{1}} first name, {{2}} cycle, {{3}} date+time, {{4}} missing parts, {{5}} link.
const INSTRUCTOR_NUDGE_TEMPLATE = process.env.INSTRUCTOR_REPORT_NUDGE_WA_TEMPLATE_NAME || 'instructor_report_missing';

function formatDbDate(date: Date): string {
  return date.toLocaleDateString('he-IL', { timeZone: TZ });
}

function formatDbTime(date: Date | null): string {
  if (!date) return '';
  return `${date.getUTCHours().toString().padStart(2, '0')}:${date.getUTCMinutes().toString().padStart(2, '0')}`;
}

function hasText(value: string | null | undefined): boolean {
  return Boolean((value || '').trim());
}

export async function checkAndSendMeetingReportQualityAlert(
  meetingId: string,
  source = 'unknown',
): Promise<void> {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: {
      instructor: { select: { id: true, name: true, phone: true } },
      attendance: { select: { id: true } },
      cycle: {
        include: {
          course: { select: { name: true } },
          branch: { select: { name: true } },
          registrations: {
            where: {
              deletedAt: null,
              status: { in: ['registered', 'active', 'completed'] },
            },
            select: { id: true },
          },
        },
      },
    },
  });

  if (!meeting || meeting.status !== 'completed') return;

  const registrationCount = meeting.cycle.registrations.length;
  const isGroupMeeting = registrationCount > 1;
  const issues: string[] = [];

  if (!hasText(meeting.topic)) {
    issues.push('המדריך סימן שהפגישה התקיימה אבל לא כתב מה היה בשיעור');
  }

  if (isGroupMeeting && meeting.attendance.length === 0) {
    issues.push('המדריך סימן שהפגישה התקיימה אבל לא מילא נוכחות לקבוצה');
  }

  if (issues.length === 0) return;

  const missingTopic = !hasText(meeting.topic);
  const missingAttendance = isGroupMeeting && meeting.attendance.length === 0;

  const message = `⚠️ דיווח פגישה חסר

📅 תאריך: ${formatDbDate(meeting.scheduledDate)}
🕐 שעה: ${formatDbTime(meeting.startTime)}
📚 מחזור: ${meeting.cycle.name}
🎓 קורס: ${meeting.cycle.course?.name || ''}
🏢 סניף: ${meeting.cycle.branch?.name || 'אונליין'}
👨‍🏫 מדריך: ${meeting.instructor?.name || 'לא ידוע'}

${issues.map((issue) => `• ${issue}`).join('\n')}

מקור בדיקה: ${source}`;

  const results = await sendOperationsWhatsApp(message);
  const failed = results.filter((result) => !result.success);
  if (failed.length === results.length) {
    console.error(`[MeetingReportQuality] send failed for meeting ${meetingId}: ${failed.map((result) => result.error).join('; ')}`);
  } else {
    console.log(`[MeetingReportQuality] alert sent for meeting ${meetingId} from ${source}`);
  }

  await sendInstructorReportNudge(meeting, { missingTopic, missingAttendance }).catch((err) => {
    console.error(`[MeetingReportQuality] instructor nudge failed for meeting ${meetingId}:`, err);
  });
}

function nudgeMarker(meetingId: string): string {
  return `[report-nudge:${meetingId}]`;
}

export function buildInstructorReportNudgeParams(
  meeting: { scheduledDate: Date; startTime: Date | null; instructor?: { name?: string | null } | null; cycle: { name: string } },
  missing: { missingTopic: boolean; missingAttendance: boolean },
  link: string,
): string[] {
  const parts: string[] = [];
  if (missing.missingTopic) parts.push('מה היה בשיעור');
  if (missing.missingAttendance) parts.push('נוכחות');
  const firstName = (meeting.instructor?.name || '').trim().split(/\s+/)[0] || 'מדריך/ה';
  const time = formatDbTime(meeting.startTime);
  return [
    firstName,
    meeting.cycle.name,
    `${formatDbDate(meeting.scheduledDate)}${time ? ` ${time}` : ''}`,
    parts.join(' ו'),
    link,
  ];
}

export function buildInstructorReportNudgeText(
  meeting: { scheduledDate: Date; startTime: Date | null; instructor?: { name?: string | null } | null; cycle: { name: string } },
  missing: { missingTopic: boolean; missingAttendance: boolean },
  link: string,
): string {
  const parts: string[] = [];
  if (missing.missingTopic) parts.push('מה היה בשיעור');
  if (missing.missingAttendance) parts.push('נוכחות');
  const firstName = (meeting.instructor?.name || '').trim().split(/\s+/)[0] || '';
  const greeting = firstName ? `היי ${firstName}` : 'היי';
  const time = formatDbTime(meeting.startTime);
  return `${greeting}, סימנת שהשיעור "${meeting.cycle.name}" ב-${formatDbDate(meeting.scheduledDate)}${time ? ` ${time}` : ''} התקיים, אבל חסר בדיווח: ${parts.join(' ו')}. ` +
    'חשוב לנו שתמלא/י את זה אחרי כל שיעור – כך נוכל לעקוב אחרי ההתקדמות של הקבוצה, לעדכן את ההורים ולהמשיך מהנקודה הנכונה בשיעור הבא. ' +
    `אפשר להשלים כאן: ${link} תודה! 🙏`;
}

// One reminder per meeting: alerts can fire on every save, the instructor should get a single nudge.
async function sendInstructorReportNudge(
  meeting: any,
  missing: { missingTopic: boolean; missingAttendance: boolean },
): Promise<void> {
  if (process.env.INSTRUCTOR_REPORT_NUDGE === 'off') return;
  if (!missing.missingTopic && !missing.missingAttendance) return;
  const instructor = meeting.instructor;
  if (!instructor?.id || !instructor.phone) return;

  const marker = nudgeMarker(meeting.id);
  const already = await prisma.waMessage.findFirst({
    where: { direction: 'outbound', content: { contains: marker } },
    select: { id: true },
  });
  if (already) return;

  const link = generateMeetingMagicLink(instructor.id, meeting.id, APP_URL);
  const text = buildInstructorReportNudgeText(meeting, missing, link);
  const result = await sendWhatsAppCloudTemplate({
    phone: instructor.phone,
    contactName: instructor.name,
    templateName: INSTRUCTOR_NUDGE_TEMPLATE,
    bodyParameters: buildInstructorReportNudgeParams(meeting, missing, link),
    preview: `${marker} ${text}`,
  });
  if (!result.success) {
    console.error(`[MeetingReportQuality] instructor nudge send failed for meeting ${meeting.id}: ${result.error}`);
    return;
  }
  console.log(`[MeetingReportQuality] instructor nudge sent for meeting ${meeting.id}`);
}
