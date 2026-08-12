import { prisma } from '../utils/prisma.js';
import { sendOperationsWhatsApp } from './operations-notifications.js';

const TZ = 'Asia/Jerusalem';

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
      instructor: { select: { name: true } },
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
    return;
  }

  console.log(`[MeetingReportQuality] alert sent for meeting ${meetingId} from ${source}`);
}
