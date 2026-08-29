import { prisma } from '../utils/prisma.js';

export type MeetingDuplicateCandidate = {
  instructorId: string;
  scheduledDate: Date;
  startTime: Date;
  endTime: Date;
  excludeMeetingId?: string;
};

export type MeetingDuplicateWarning = {
  meetingId: string;
  cycleId: string;
  cycleName: string;
  instructorId: string;
  instructorName: string;
  scheduledDate: string;
  startTime: string;
  endTime: string;
  status: string;
  message: string;
};

function dateOnly(date: Date): Date {
  return new Date(date.toISOString().split('T')[0]);
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function formatTime(value: Date): string {
  return `${value.getUTCHours().toString().padStart(2, '0')}:${value.getUTCMinutes().toString().padStart(2, '0')}`;
}

export async function findDuplicateMeetingWarnings(
  candidates: MeetingDuplicateCandidate[],
): Promise<MeetingDuplicateWarning[]> {
  const warningByMeetingId = new Map<string, MeetingDuplicateWarning>();

  for (const candidate of candidates) {
    const duplicateMeetings = await prisma.meeting.findMany({
      where: {
        ...(candidate.excludeMeetingId ? { id: { not: candidate.excludeMeetingId } } : {}),
        instructorId: candidate.instructorId,
        scheduledDate: dateOnly(candidate.scheduledDate),
        startTime: candidate.startTime,
        endTime: candidate.endTime,
        deletedAt: null,
        status: { notIn: ['cancelled', 'postponed'] },
      },
      include: {
        cycle: { select: { id: true, name: true } },
        instructor: { select: { id: true, name: true } },
      },
    });

    for (const meeting of duplicateMeetings) {
      if (warningByMeetingId.has(meeting.id)) continue;

      const scheduledDate = formatDate(meeting.scheduledDate);
      const startTime = formatTime(meeting.startTime);
      const endTime = formatTime(meeting.endTime);
      const instructorName = meeting.instructor?.name || 'מדריך לא ידוע';
      const cycleName = meeting.cycle?.name || 'מחזור לא ידוע';

      warningByMeetingId.set(meeting.id, {
        meetingId: meeting.id,
        cycleId: meeting.cycleId,
        cycleName,
        instructorId: meeting.instructorId,
        instructorName,
        scheduledDate,
        startTime,
        endTime,
        status: meeting.status,
        message: `התראת כפילות למדריך ${instructorName}: קיימת כבר פגישה ב-${scheduledDate} ${startTime}-${endTime} במחזור "${cycleName}".`,
      });
    }
  }

  return [...warningByMeetingId.values()];
}
