import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';

const TZ = 'Asia/Jerusalem';
const LOW_PROFIT_THRESHOLD = Number(process.env.OPERATIONS_CONTROL_LOW_PROFIT_THRESHOLD || 100);

export type OperationsAlertPriority = 'urgent' | 'high' | 'normal';
export type OperationsAlertType =
  | 'past_scheduled_meeting'
  | 'missing_topic'
  | 'missing_attendance'
  | 'overdue_task'
  | 'low_profit';
export type FreshnessStatus = 'fresh' | 'stale' | 'error';
export type OverallStatus = 'ok' | 'watch' | 'urgent' | 'data_error';

export interface OperationsAlert {
  id: string;
  priority: OperationsAlertPriority;
  type: OperationsAlertType;
  title: string;
  entityType: 'meeting' | 'cycle' | 'task';
  entityId: string;
  entityUrl: string;
  clientName: string | null;
  cycleName: string | null;
  instructorName: string | null;
  description: string;
  recommendedAction: string;
  detectedAt: string;
  taskId: string | null;
}

export interface OperationsControlFilters {
  date?: string;
  priority?: OperationsAlertPriority;
  type?: OperationsAlertType;
}

type AlertCandidate = OperationsAlert;

type MeetingWithRelations = Prisma.MeetingGetPayload<{
  include: {
    cycle: {
      include: {
        branch: true;
        course: true;
        registrations: { select: { id: true; status: true } };
      };
    };
    instructor: true;
    attendance: { select: { id: true } };
  };
}>;

type TaskWithRelations = Prisma.TaskGetPayload<{
  include: {
    assignee: { select: { id: true; name: true; role: true } };
    createdBy: { select: { id: true; name: true; role: true } };
  };
}>;

type InstructorLoadRow = {
  instructorId: string;
  instructorName: string;
  todayCount: number;
  weekCount: number;
  missingReports: number;
  warningState: 'ok' | 'watch';
};

function dateStringInIsrael(date = new Date()) {
  return new Intl.DateTimeFormat('sv', { timeZone: TZ }).format(date);
}

function israelMinutesNow(date = new Date()) {
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function dateFromDateString(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function toDateString(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatTime(value: Date | string | null) {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

function minutesFromTime(value: Date | string | null) {
  const time = formatTime(value);
  if (!time) return 0;
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function registrationCount(meeting: MeetingWithRelations) {
  return meeting.cycle.registrations.filter((registration) => registration.status !== 'cancelled').length;
}

function meetingClientName(meeting: MeetingWithRelations) {
  return meeting.cycle.branch?.name || meeting.cycle.course?.name || null;
}

function meetingUrl(id: string) {
  return `/meetings/${id}`;
}

function taskUrl(id: string) {
  return `/tasks?task=${id}`;
}

function buildPastScheduledAlerts(meetings: MeetingWithRelations[], context: {
  today: string;
  nowMinutes: number;
  detectedAt: string;
}): AlertCandidate[] {
  return meetings
    .filter((meeting) => {
      const date = toDateString(meeting.scheduledDate);
      if (date < context.today) return true;
      if (date > context.today) return false;
      return minutesFromTime(meeting.endTime) < context.nowMinutes;
    })
    .map((meeting) => {
      const date = toDateString(meeting.scheduledDate);
      const endedMinutesAgo = date === context.today
        ? Math.max(0, context.nowMinutes - minutesFromTime(meeting.endTime))
        : null;
      const priority: OperationsAlertPriority = endedMinutesAgo !== null && endedMinutesAgo > 120
        ? 'urgent'
        : 'high';
      const description = endedMinutesAgo !== null
        ? `הפגישה הסתיימה לפני ${Math.floor(endedMinutesAgo / 60)} שעות ו-${endedMinutesAgo % 60} דקות ועדיין מסומנת כמתוכננת.`
        : `הפגישה מתאריך ${date} עדיין מסומנת כמתוכננת.`;

      return {
        id: `past-scheduled-meeting:${meeting.id}`,
        priority,
        type: 'past_scheduled_meeting',
        title: 'פגישה שעברה עדיין מסומנת כמתוכננת',
        entityType: 'meeting',
        entityId: meeting.id,
        entityUrl: meetingUrl(meeting.id),
        clientName: meetingClientName(meeting),
        cycleName: meeting.cycle.name,
        instructorName: meeting.instructor?.name || null,
        description,
        recommendedAction: 'לפנות למדריך/תפעול ולעדכן סטטוס ודיווח פגישה.',
        detectedAt: context.detectedAt,
        taskId: null,
      };
    });
}

function buildMissingTopicAlerts(meetings: MeetingWithRelations[], detectedAt: string): AlertCandidate[] {
  return meetings
    .filter((meeting) => meeting.status === 'completed' && !(meeting.topic || '').trim())
    .map((meeting) => ({
      id: `missing-topic:${meeting.id}`,
      priority: 'high',
      type: 'missing_topic',
      title: 'פגישה הושלמה ללא נושא/סיכום',
      entityType: 'meeting',
      entityId: meeting.id,
      entityUrl: meetingUrl(meeting.id),
      clientName: meetingClientName(meeting),
      cycleName: meeting.cycle.name,
      instructorName: meeting.instructor?.name || null,
      description: 'הפגישה סומנה כהתקיימה אבל שדה הנושא/סיכום ריק.',
      recommendedAction: 'לבקש מהמדריך להשלים נושא שיעור וסיכום קצר.',
      detectedAt,
      taskId: null,
    }));
}

function buildMissingAttendanceAlerts(meetings: MeetingWithRelations[], detectedAt: string): AlertCandidate[] {
  return meetings
    .filter((meeting) => (
      meeting.status === 'completed'
      && registrationCount(meeting) > 0
      && meeting.attendance.length === 0
    ))
    .map((meeting) => ({
      id: `missing-attendance:${meeting.id}`,
      priority: 'high',
      type: 'missing_attendance',
      title: 'פגישה הושלמה ללא נוכחות',
      entityType: 'meeting',
      entityId: meeting.id,
      entityUrl: meetingUrl(meeting.id),
      clientName: meetingClientName(meeting),
      cycleName: meeting.cycle.name,
      instructorName: meeting.instructor?.name || null,
      description: `יש ${registrationCount(meeting)} תלמידים רשומים במחזור, אבל אין סימוני נוכחות לפגישה.`,
      recommendedAction: 'לבקש מהמדריך לסמן נוכחות לפני סגירת יום.',
      detectedAt,
      taskId: null,
    }));
}

function buildOverdueTaskAlerts(tasks: TaskWithRelations[], detectedAt: string): AlertCandidate[] {
  return tasks.map((task) => {
    const priority: OperationsAlertPriority = task.priority === 'urgent' || task.priority === 'high'
      ? 'urgent'
      : 'high';
    const due = task.dueDate ? task.dueDate.toLocaleDateString('he-IL', { timeZone: TZ }) : 'לא נקבע';
    return {
      id: `overdue-task:${task.id}`,
      priority,
      type: 'overdue_task',
      title: 'משימה באיחור',
      entityType: 'task',
      entityId: task.id,
      entityUrl: taskUrl(task.id),
      clientName: null,
      cycleName: null,
      instructorName: task.assignee?.name || null,
      description: `משימה פתוחה עם יעד שעבר (${due}).`,
      recommendedAction: 'לפנות לאחראי או להקצות מחדש.',
      detectedAt,
      taskId: task.id,
    };
  });
}

function buildLowProfitAlerts(meetings: MeetingWithRelations[], detectedAt: string): AlertCandidate[] {
  return meetings
    .filter((meeting) => {
      const profit = Number(meeting.profit || 0);
      return meeting.status === 'completed' && profit < LOW_PROFIT_THRESHOLD;
    })
    .map((meeting) => {
      const profit = Number(meeting.profit || 0);
      return {
        id: `low-profit:meeting:${meeting.id}`,
        priority: profit < 0 ? 'urgent' : 'high',
        type: 'low_profit',
        title: profit < 0 ? 'פגישה בהפסד' : 'פגישה ברווחיות נמוכה',
        entityType: 'meeting',
        entityId: meeting.id,
        entityUrl: meetingUrl(meeting.id),
        clientName: meetingClientName(meeting),
        cycleName: meeting.cycle.name,
        instructorName: meeting.instructor?.name || null,
        description: `הרווח המחושב לפגישה הוא ₪${profit.toFixed(0)}.`,
        recommendedAction: 'לבדוק תמחור, תשלום מדריך, הוצאות ומספר תלמידים פעילים.',
        detectedAt,
        taskId: null,
      } as OperationsAlert;
    });
}

export function filterAndSortAlerts(
  alerts: AlertCandidate[],
  filters: Pick<OperationsControlFilters, 'priority' | 'type'>,
) {
  const rank: Record<OperationsAlertPriority, number> = { urgent: 0, high: 1, normal: 2 };
  return alerts
    .filter((alert) => !filters.priority || alert.priority === filters.priority)
    .filter((alert) => !filters.type || alert.type === filters.type)
    .sort((a, b) => rank[a.priority] - rank[b.priority] || a.type.localeCompare(b.type));
}

export function buildOperationsAlerts(data: {
  pastScheduledMeetings: MeetingWithRelations[];
  recentCompletedMeetings: MeetingWithRelations[];
  overdueTasks: TaskWithRelations[];
  detectedAt: string;
  today: string;
  nowMinutes: number;
}) {
  return [
    ...buildPastScheduledAlerts(data.pastScheduledMeetings, {
      today: data.today,
      nowMinutes: data.nowMinutes,
      detectedAt: data.detectedAt,
    }),
    ...buildMissingTopicAlerts(data.recentCompletedMeetings, data.detectedAt),
    ...buildMissingAttendanceAlerts(data.recentCompletedMeetings, data.detectedAt),
    ...buildOverdueTaskAlerts(data.overdueTasks, data.detectedAt),
    ...buildLowProfitAlerts(data.recentCompletedMeetings, data.detectedAt),
  ];
}

function overallStatus(alerts: OperationsAlert[]): OverallStatus {
  if (alerts.some((alert) => alert.priority === 'urgent')) return 'urgent';
  if (alerts.length > 0) return 'watch';
  return 'ok';
}

function mapMeeting(meeting: MeetingWithRelations) {
  const activeRegistrations = registrationCount(meeting);
  return {
    id: meeting.id,
    entityUrl: meetingUrl(meeting.id),
    date: toDateString(meeting.scheduledDate),
    startTime: formatTime(meeting.startTime),
    endTime: formatTime(meeting.endTime),
    status: meeting.status,
    cycleName: meeting.cycle.name,
    clientName: meetingClientName(meeting),
    instructorName: meeting.instructor?.name || null,
    hasTopic: !!(meeting.topic || '').trim(),
    attendanceMarked: activeRegistrations === 0 || meeting.attendance.length > 0,
    attendanceCount: meeting.attendance.length,
    registrationCount: activeRegistrations,
  };
}

function buildInstructorLoad(todayMeetings: MeetingWithRelations[], weekMeetings: MeetingWithRelations[]): InstructorLoadRow[] {
  const rows = new Map<string, InstructorLoadRow>();
  for (const meeting of weekMeetings) {
    if (!meeting.instructor) continue;
    const row = rows.get(meeting.instructor.id) || {
      instructorId: meeting.instructor.id,
      instructorName: meeting.instructor.name,
      todayCount: 0,
      weekCount: 0,
      missingReports: 0,
      warningState: 'ok',
    };
    row.weekCount += 1;
    if (meeting.status === 'completed' && !(meeting.topic || '').trim()) row.missingReports += 1;
    rows.set(meeting.instructor.id, row);
  }
  for (const meeting of todayMeetings) {
    if (!meeting.instructor) continue;
    const row = rows.get(meeting.instructor.id) || {
      instructorId: meeting.instructor.id,
      instructorName: meeting.instructor.name,
      todayCount: 0,
      weekCount: 0,
      missingReports: 0,
      warningState: 'ok',
    };
    row.todayCount += 1;
    rows.set(meeting.instructor.id, row);
  }
  return Array.from(rows.values())
    .map((row) => ({
      ...row,
      warningState: (row.todayCount >= 5 || row.weekCount >= 18 || row.missingReports > 0 ? 'watch' : 'ok') as 'watch' | 'ok',
    }))
    .sort((a, b) => b.todayCount - a.todayCount || b.missingReports - a.missingReports || a.instructorName.localeCompare(b.instructorName));
}

function mapTask(task: TaskWithRelations) {
  return {
    id: task.id,
    entityUrl: taskUrl(task.id),
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate?.toISOString() || null,
    assigneeName: task.assignee?.name || null,
    assigneeRole: task.assignee?.role || null,
  };
}

export async function getOperationsControlToday(filters: OperationsControlFilters = {}) {
  const generatedAt = new Date();
  const generatedAtIso = generatedAt.toISOString();
  const today = filters.date || dateStringInIsrael(generatedAt);
  const todayDate = dateFromDateString(today);
  const yesterdayDate = addDays(todayDate, -1);
  const weekStart = addDays(todayDate, -todayDate.getUTCDay());
  const weekEnd = addDays(weekStart, 7);

  const meetingInclude = {
    cycle: {
      include: {
        branch: true,
        course: true,
        registrations: { select: { id: true, status: true } },
      },
    },
    instructor: true,
    attendance: { select: { id: true } },
  } satisfies Prisma.MeetingInclude;

  const taskInclude = {
    assignee: { select: { id: true, name: true, role: true } },
    createdBy: { select: { id: true, name: true, role: true } },
  } satisfies Prisma.TaskInclude;

  const [todayMeetings, recentCompletedMeetings, pastScheduledMeetings, weekMeetings, overdueTasks, openTasks, openTaskCount] = await Promise.all([
    prisma.meeting.findMany({
      where: { scheduledDate: todayDate, deletedAt: null },
      include: meetingInclude,
      orderBy: [{ startTime: 'asc' }],
    }),
    prisma.meeting.findMany({
      where: {
        scheduledDate: { gte: yesterdayDate, lte: todayDate },
        status: 'completed',
        deletedAt: null,
      },
      include: meetingInclude,
      orderBy: [{ scheduledDate: 'desc' }, { startTime: 'asc' }],
      take: 100,
    }),
    prisma.meeting.findMany({
      where: {
        scheduledDate: { lte: todayDate },
        status: 'scheduled',
        deletedAt: null,
      },
      include: meetingInclude,
      orderBy: [{ scheduledDate: 'desc' }, { endTime: 'desc' }],
      take: 100,
    }),
    prisma.meeting.findMany({
      where: {
        scheduledDate: { gte: weekStart, lt: weekEnd },
        deletedAt: null,
      },
      include: meetingInclude,
      orderBy: [{ scheduledDate: 'asc' }, { startTime: 'asc' }],
    }),
    prisma.task.findMany({
      where: {
        deletedAt: null,
        status: { not: 'completed' },
        dueDate: { lt: generatedAt },
      },
      include: taskInclude,
      orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }],
      take: 50,
    }),
    prisma.task.findMany({
      where: {
        deletedAt: null,
        status: { not: 'completed' },
        OR: [
          { dueDate: { lt: generatedAt } },
          { assignee: { role: 'operations' } },
        ],
      },
      include: taskInclude,
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      take: 50,
    }),
    prisma.task.count({
      where: { deletedAt: null, status: { not: 'completed' } },
    }),
  ]);

  const allAlerts = buildOperationsAlerts({
    pastScheduledMeetings,
    recentCompletedMeetings,
    overdueTasks,
    detectedAt: generatedAtIso,
    today,
    nowMinutes: israelMinutesNow(generatedAt),
  });
  const alerts = filterAndSortAlerts(allAlerts, filters);
  const urgentCount = alerts.filter((alert) => alert.priority === 'urgent').length;
  const highCount = alerts.filter((alert) => alert.priority === 'high').length;
  const normalCount = alerts.filter((alert) => alert.priority === 'normal').length;

  return {
    success: true,
    generatedAt: generatedAtIso,
    timezone: TZ,
    date: today,
    freshness: {
      status: 'fresh' as FreshnessStatus,
      generatedAt: generatedAtIso,
      message: 'המידע עודכן עכשיו',
    },
    summary: {
      overallStatus: overallStatus(alerts),
      urgentCount,
      highCount,
      normalCount,
      openTaskCount,
      todayMeetingCount: todayMeetings.length,
      unresolvedMeetingCount: allAlerts.filter((alert) => (
        alert.type === 'past_scheduled_meeting'
        || alert.type === 'missing_topic'
        || alert.type === 'missing_attendance'
      )).length,
    },
    alerts,
    todayMeetings: todayMeetings.map(mapMeeting),
    instructorLoad: buildInstructorLoad(todayMeetings, weekMeetings),
    clientRisks: alerts.filter((alert) => alert.entityType === 'cycle' || alert.type === 'low_profit'),
    openTasks: openTasks.map(mapTask),
  };
}

export const __operationsControlTestUtils = {
  buildPastScheduledAlerts,
  buildMissingTopicAlerts,
  buildMissingAttendanceAlerts,
  buildOverdueTaskAlerts,
  buildLowProfitAlerts,
  dateFromDateString,
};
