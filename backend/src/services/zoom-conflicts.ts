import { prisma } from '../utils/prisma.js';

type DateLike = Date | string | null | undefined;

export type ZoomConflictMeeting = {
  id: string;
  scheduledDate: Date;
  startTime: DateLike;
  endTime: DateLike;
  zoomHostEmail: string | null;
  zoomMeetingId: string | null;
  cycle?: {
    name?: string | null;
    course?: { name?: string | null } | null;
  } | null;
  instructor?: { name?: string | null } | null;
};

export type ZoomHostConflict = {
  zoomHostEmail: string;
  meetings: ZoomConflictMeeting[];
};

function timeToMinutes(value: DateLike): number {
  if (!value) return 0;
  if (typeof value === 'string') {
    const [hours, minutes] = value.substring(0, 5).split(':').map(Number);
    return hours * 60 + minutes;
  }
  return value.getUTCHours() * 60 + value.getUTCMinutes();
}

function formatDbTime(value: DateLike): string {
  if (!value) return '';
  const minutes = timeToMinutes(value);
  const hoursPart = Math.floor(minutes / 60).toString().padStart(2, '0');
  const minutesPart = (minutes % 60).toString().padStart(2, '0');
  return `${hoursPart}:${minutesPart}`;
}

function meetingLabel(meeting: ZoomConflictMeeting): string {
  const cycleName = meeting.cycle?.name || meeting.cycle?.course?.name || 'פגישה ללא שם';
  const instructorName = meeting.instructor?.name ? `, ${meeting.instructor.name}` : '';
  const zoomId = meeting.zoomMeetingId ? `, Zoom ${meeting.zoomMeetingId}` : '';
  return `${formatDbTime(meeting.startTime)}-${formatDbTime(meeting.endTime)} ${cycleName}${instructorName}${zoomId}`;
}

export function findZoomHostConflictGroups(meetings: ZoomConflictMeeting[]): ZoomHostConflict[] {
  const byHost = new Map<string, ZoomConflictMeeting[]>();

  for (const meeting of meetings) {
    if (!meeting.zoomHostEmail) continue;
    const key = meeting.zoomHostEmail.trim().toLowerCase();
    if (!key) continue;
    if (!byHost.has(key)) byHost.set(key, []);
    byHost.get(key)!.push(meeting);
  }

  const conflicts: ZoomHostConflict[] = [];

  for (const [zoomHostEmail, hostMeetings] of byHost) {
    const sorted = [...hostMeetings].sort((a, b) => {
      const startDiff = timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
      return startDiff || timeToMinutes(a.endTime) - timeToMinutes(b.endTime);
    });

    let current: ZoomConflictMeeting[] = [];
    let currentEnd = -1;

    const flush = () => {
      if (current.length > 1) {
        conflicts.push({ zoomHostEmail, meetings: current });
      }
    };

    for (const meeting of sorted) {
      const start = timeToMinutes(meeting.startTime);
      const end = timeToMinutes(meeting.endTime);

      if (current.length === 0 || start < currentEnd) {
        current.push(meeting);
        currentEnd = Math.max(currentEnd, end);
      } else {
        flush();
        current = [meeting];
        currentEnd = end;
      }
    }

    flush();
  }

  return conflicts;
}

export function formatZoomHostConflictAlert(conflict: ZoomHostConflict): string {
  const labels = conflict.meetings.map(meetingLabel).join(' | ');
  return `התנגשות Zoom מחר בחשבון ${conflict.zoomHostEmail}: ${labels}`;
}

export async function findZoomHostConflictsForDate(scheduledDate: Date): Promise<ZoomHostConflict[]> {
  const meetings = await prisma.meeting.findMany({
    where: {
      scheduledDate,
      deletedAt: null,
      status: { notIn: ['cancelled', 'postponed'] },
      zoomHostEmail: { not: null },
    },
    include: {
      cycle: { include: { course: true } },
      instructor: { select: { name: true } },
    },
    orderBy: { startTime: 'asc' },
  });

  return findZoomHostConflictGroups(meetings);
}
