import { prisma } from '../utils/prisma.js';
import { sendWhatsApp } from './messaging.js';
import { getOperationsWhatsAppRecipients } from './operations-notifications.js';

const TZ = 'Asia/Jerusalem';
const ACTIVE_REGISTRATION_STATUS = 'active';
const PAID_STATUS = 'paid';
const VIDEO_ACTIVITY_TYPES = new Set(['online', 'private_lesson']);
const VIDEO_CYCLE_TYPES = new Set(['private', 'trial_private', 'group']);

type DateLike = Date | string | null | undefined;

export type MeetingCheckRegistration = {
  status: string;
  paymentStatus: string | null;
};

export type MeetingCheckMeeting = {
  id: string;
  scheduledDate: Date;
  startTime: DateLike;
  endTime: DateLike;
  status: string;
  zoomMeetingId: string | null;
  zoomJoinUrl?: string | null;
  zoomHostEmail: string | null;
  instructorId: string | null;
  activityType?: string | null;
  instructor?: { name: string | null } | null;
  cycle: {
    name: string;
    type?: string | null;
    isOnline?: boolean | null;
    activityType?: string | null;
    deletedAt?: Date | null;
    course?: { name: string | null } | null;
    registrations: MeetingCheckRegistration[];
  };
};

export type MeetingCheckReport = {
  dateLabel: string;
  issueCount: number;
  message: string;
};

function israelDateString(offsetDays = 0): string {
  const base = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('sv', { timeZone: TZ }).format(base);
}

function dateForDb(dateLabel: string): Date {
  return new Date(`${dateLabel}T00:00:00.000Z`);
}

function timeToMinutes(value: DateLike): number {
  if (!value) return 0;
  if (typeof value === 'string') {
    const [hours, minutes] = value.substring(0, 5).split(':').map(Number);
    return hours * 60 + minutes;
  }
  return value.getUTCHours() * 60 + value.getUTCMinutes();
}

function formatTime(value: DateLike): string {
  const minutes = timeToMinutes(value);
  const hoursPart = Math.floor(minutes / 60).toString().padStart(2, '0');
  const minutesPart = (minutes % 60).toString().padStart(2, '0');
  return `${hoursPart}:${minutesPart}`;
}

function overlaps(a: MeetingCheckMeeting, b: MeetingCheckMeeting): boolean {
  return timeToMinutes(a.startTime) < timeToMinutes(b.endTime)
    && timeToMinutes(b.startTime) < timeToMinutes(a.endTime);
}

function isMeetingActiveForConflict(meeting: MeetingCheckMeeting): boolean {
  return meeting.status === 'scheduled';
}

function meetingName(meeting: MeetingCheckMeeting): string {
  return meeting.cycle.name || meeting.cycle.course?.name || 'פגישה ללא שם';
}

function meetingLine(meeting: MeetingCheckMeeting, extra = ''): string {
  const suffix = extra ? ` | ${extra}` : '';
  return `${meetingName(meeting)} | ${formatTime(meeting.startTime)}-${formatTime(meeting.endTime)}${suffix}`;
}

function expectsVideoLink(meeting: MeetingCheckMeeting): boolean {
  return Boolean(
    meeting.cycle.isOnline
      || VIDEO_ACTIVITY_TYPES.has(meeting.activityType || '')
      || VIDEO_ACTIVITY_TYPES.has(meeting.cycle.activityType || '')
      || VIDEO_CYCLE_TYPES.has(meeting.cycle.type || '')
  );
}

function addSection(lines: string[], title: string, items: string[], issueCounter: { count: number }): void {
  if (items.length === 0) return;
  issueCounter.count += items.length;
  lines.push(`${title}`);
  lines.push(...items);
  lines.push('');
}

function findPairConflicts<T extends string | null>(
  meetings: MeetingCheckMeeting[],
  keyFn: (meeting: MeetingCheckMeeting) => T,
  labelFn: (meeting: MeetingCheckMeeting) => string
): string[] {
  const byKey = new Map<string, MeetingCheckMeeting[]>();
  for (const meeting of meetings.filter(isMeetingActiveForConflict)) {
    const key = keyFn(meeting);
    if (!key) continue;
    const normalized = key.trim().toLowerCase();
    if (!normalized) continue;
    if (!byKey.has(normalized)) byKey.set(normalized, []);
    byKey.get(normalized)!.push(meeting);
  }

  const conflicts: string[] = [];
  const seen = new Set<string>();

  for (const group of byKey.values()) {
    const sorted = [...group].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        if (!overlaps(sorted[i], sorted[j])) continue;
        const pairKey = [sorted[i].id, sorted[j].id].sort().join(':');
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);
        conflicts.push(`${labelFn(sorted[i])} ↔ ${labelFn(sorted[j])}`);
      }
    }
  }

  return conflicts;
}

export function buildMeetingCheckReport(dateLabel: string, meetingsInput: MeetingCheckMeeting[]): MeetingCheckReport {
  const meetings = meetingsInput
    .filter((meeting) => !meeting.cycle.deletedAt)
    .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

  const lines = [`🚨 *דוח בדיקת פגישות ל-${dateLabel}*`, ''];
  const issueCounter = { count: 0 };

  addSection(
    lines,
    '🔴 *חפיפת מדריך:*',
    findPairConflicts(
      meetings,
      (meeting) => meeting.instructorId,
      (meeting) => meetingLine(meeting, meeting.instructor?.name || 'מדריך לא ידוע')
    ),
    issueCounter
  );

  addSection(
    lines,
    '🟡 *אין רישומים פעילים:*',
    meetings
      .filter((meeting) => meeting.status === 'scheduled')
      .filter((meeting) => !meeting.cycle.registrations.some((registration) => registration.status === ACTIVE_REGISTRATION_STATUS))
      .map((meeting) => meetingLine(meeting)),
    issueCounter
  );

  const unpaid = meetings
    .filter((meeting) => meeting.status === 'scheduled')
    .filter((meeting) => meeting.cycle.registrations.some((registration) =>
      registration.status === ACTIVE_REGISTRATION_STATUS && registration.paymentStatus !== PAID_STATUS
    ));
  const unpaidLines = unpaid.slice(0, 15).map((meeting) => meetingLine(meeting));
  if (unpaid.length > 15) unpaidLines.push(`...ועוד ${unpaid.length - 15}`);
  addSection(lines, `🟠 *לא שולם (סה"כ ${unpaid.length}):*`, unpaidLines, issueCounter);

  addSection(
    lines,
    '🔴 *פגישת וידאו חסרה:*',
    meetings
      .filter((meeting) => meeting.status === 'scheduled')
      .filter(expectsVideoLink)
      .filter((meeting) => !meeting.zoomJoinUrl)
      .map((meeting) => meetingLine(meeting)),
    issueCounter
  );

  addSection(
    lines,
    '🔴 *התנגשות חשבון Zoom:*',
    findPairConflicts(
      meetings,
      (meeting) => meeting.zoomHostEmail,
      (meeting) => meetingLine(meeting, meeting.zoomHostEmail || 'חשבון לא ידוע')
    ),
    issueCounter
  );

  addSection(
    lines,
    '🔴 *חפיפת זום:*',
    findPairConflicts(
      meetings,
      (meeting) => meeting.zoomMeetingId,
      (meeting) => meetingLine(meeting, meeting.zoomMeetingId ? `Zoom ${meeting.zoomMeetingId}` : 'Zoom לא ידוע')
    ),
    issueCounter
  );

  addSection(
    lines,
    '⚠️ *סטטוס חריג:*',
    meetings
      .filter((meeting) => meeting.status !== 'scheduled')
      .map((meeting) => `${meetingName(meeting)} | ${formatTime(meeting.startTime)} | סטטוס: ${meeting.status}`),
    issueCounter
  );

  addSection(
    lines,
    '❌ *אין מדריך:*',
    meetings
      .filter((meeting) => !meeting.instructor)
      .map((meeting) => meetingLine(meeting)),
    issueCounter
  );

  if (issueCounter.count === 0) {
    return {
      dateLabel,
      issueCount: 0,
      message: `✅ *דוח בדיקת פגישות ל-${dateLabel}*\nהכל בסדר`,
    };
  }

  return {
    dateLabel,
    issueCount: issueCounter.count,
    message: lines.join('\n'),
  };
}

export async function buildTomorrowMeetingCheckReport(): Promise<MeetingCheckReport> {
  const dateLabel = israelDateString(1);
  const scheduledDate = dateForDb(dateLabel);

  const meetings = await prisma.meeting.findMany({
    where: {
      scheduledDate,
      deletedAt: null,
    },
    include: {
      instructor: { select: { name: true } },
      cycle: {
        include: {
          course: { select: { name: true } },
          registrations: {
            where: { deletedAt: null },
            select: { status: true, paymentStatus: true },
          },
        },
      },
    },
    orderBy: { startTime: 'asc' },
  });

  return buildMeetingCheckReport(dateLabel, meetings as MeetingCheckMeeting[]);
}

export async function sendTomorrowMeetingCheckReport(): Promise<MeetingCheckReport> {
  const report = await buildTomorrowMeetingCheckReport();
  const configuredPhone = process.env.MEETINGS_CHECK_REPORT_PHONE;
  const recipients = configuredPhone
    ? getOperationsWhatsAppRecipients([{ name: configuredPhone, phone: configuredPhone }])
    : getOperationsWhatsAppRecipients();
  const results = await Promise.all(
    recipients.map((recipient) => sendWhatsApp({ phone: recipient.phone, message: report.message })),
  );

  if (results.every((result) => !result.success)) {
    throw new Error(`Meeting check report WhatsApp failed: ${results.map((result) => result.error || 'unknown error').join('; ')}`);
  }

  console.log(`[MeetingCheck] Report sent to ${recipients.map((recipient) => recipient.phone).join(', ')}: issues=${report.issueCount}`);
  return report;
}
