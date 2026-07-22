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
  | 'low_profit'
  | 'student_absence_risk'
  | 'instructor_change_risk'
  | 'cycle_churn_risk';
export type FreshnessStatus = 'fresh' | 'stale' | 'error';
export type OverallStatus = 'ok' | 'watch' | 'urgent' | 'data_error';

export interface OperationsAlert {
  id: string;
  priority: OperationsAlertPriority;
  type: OperationsAlertType;
  title: string;
  entityType: 'meeting' | 'cycle' | 'task' | 'instructor';
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

type AbsenceRiskRecord = Prisma.AttendanceGetPayload<{
  include: {
    meeting: true;
    registration: {
      include: {
        student: { include: { customer: true } };
        cycle: { include: { branch: true; course: true; instructor: true } };
      };
    };
  };
}>;

type MeetingChangeRequestWithRelations = Prisma.MeetingChangeRequestGetPayload<{
  include: {
    instructor: true;
    meeting: {
      include: {
        cycle: { include: { branch: true; course: true } };
      };
    };
  };
}>;

type CycleWithRegistrationRisk = Prisma.CycleGetPayload<{
  include: {
    branch: true;
    course: true;
    instructor: true;
    registrations: {
      include: {
        student: { include: { customer: true } };
      };
    };
  };
}>;

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

function cycleUrl(id: string) {
  return `/cycles/${id}`;
}

function instructorUrl(name: string) {
  return `/instructors?search=${encodeURIComponent(name)}`;
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

function buildStudentAbsenceRiskAlerts(absences: AbsenceRiskRecord[], detectedAt: string): AlertCandidate[] {
  const groups = new Map<string, AbsenceRiskRecord[]>();

  for (const absence of absences) {
    if (!absence.registration) continue;
    const key = `${absence.registration.id}:${absence.registration.cycleId}`;
    const group = groups.get(key) || [];
    group.push(absence);
    groups.set(key, group);
  }

  return Array.from(groups.values())
    .filter((group) => group.length >= 2)
    .map((group) => {
      const sorted = [...group].sort((a, b) => b.meeting.scheduledDate.getTime() - a.meeting.scheduledDate.getTime());
      const latest = sorted[0];
      const registration = latest.registration!;
      const cycle = registration.cycle;
      const studentName = registration.student.name;
      const parentName = registration.student.customer?.name || null;
      const absentDates = sorted
        .map((absence) => toDateString(absence.meeting.scheduledDate))
        .slice(0, 4)
        .join(', ');

      return {
        id: `student-absence-risk:${registration.id}:${cycle.id}`,
        priority: group.length >= 3 ? 'urgent' : 'high',
        type: 'student_absence_risk',
        title: 'סיכון נטישה: היעדרויות חוזרות של תלמיד',
        entityType: 'cycle',
        entityId: cycle.id,
        entityUrl: cycleUrl(cycle.id),
        clientName: parentName || cycle.branch?.name || cycle.course?.name || null,
        cycleName: cycle.name,
        instructorName: cycle.instructor?.name || null,
        description: `${studentName} סומן/ה נעדר/ת ${group.length} פעמים ב-45 הימים האחרונים (${absentDates}).`,
        recommendedAction: 'ליצור קשר עם ההורה/לקוח, להבין סיבה, ולסגור טיפול לפני ביטול הרשמה.',
        detectedAt,
        taskId: null,
      } as OperationsAlert;
    });
}

function buildInstructorChangeRiskAlerts(requests: MeetingChangeRequestWithRelations[], detectedAt: string): AlertCandidate[] {
  const groups = new Map<string, MeetingChangeRequestWithRelations[]>();

  for (const request of requests) {
    const group = groups.get(request.instructorId) || [];
    group.push(request);
    groups.set(request.instructorId, group);
  }

  return Array.from(groups.values())
    .filter((group) => group.length >= 2)
    .map((group) => {
      const sorted = [...group].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const latest = sorted[0];
      const cancelCount = group.filter((request) => request.type === 'cancel').length;
      const postponeCount = group.filter((request) => request.type === 'postpone').length;
      const pendingCount = group.filter((request) => request.status === 'pending').length;
      const sampleCycles = Array.from(new Set(group.map((request) => request.meeting.cycle.name))).slice(0, 3).join(', ');

      return {
        id: `instructor-change-risk:${latest.instructorId}`,
        priority: group.length >= 3 || pendingCount >= 2 ? 'urgent' : 'high',
        type: 'instructor_change_risk',
        title: 'סיכון שירות: בקשות ביטול/דחייה חוזרות ממדריך',
        entityType: 'instructor',
        entityId: latest.instructorId,
        entityUrl: instructorUrl(latest.instructor.name),
        clientName: null,
        cycleName: sampleCycles || latest.meeting.cycle.name,
        instructorName: latest.instructor.name,
        description: `${latest.instructor.name} ביקש/ה ${group.length} שינויי שיעור ב-45 הימים האחרונים: ${cancelCount} ביטולים, ${postponeCount} דחיות. ${pendingCount} עדיין ממתינים לטיפול.`,
        recommendedAction: 'לבדוק עומס/שחיקה מול המדריך ולבחון השפעה על הלקוח או צורך במדריך חלופי.',
        detectedAt,
        taskId: null,
      } as OperationsAlert;
    });
}

function buildCycleChurnRiskAlerts(cycles: CycleWithRegistrationRisk[], context: {
  detectedAt: string;
  sinceDate: Date;
}): AlertCandidate[] {
  return cycles.flatMap((cycle) => {
    const registrations = cycle.registrations.filter((registration) => registration.deletedAt === null);
    if (registrations.length === 0) return [];

    const activeRegistrations = registrations.filter((registration) => registration.status !== 'cancelled');
    const recentCancellations = registrations.filter((registration) => (
      registration.status === 'cancelled'
      && registration.cancellationDate !== null
      && registration.cancellationDate >= context.sinceDate
    ));
    const cancellationRate = recentCancellations.length / registrations.length;
    const expectedStudents = cycle.studentCount || registrations.length;
    const activeGap = Math.max(0, expectedStudents - activeRegistrations.length);

    if (
      recentCancellations.length < 2
      && !(recentCancellations.length >= 1 && cancellationRate >= 0.2)
      && !(cycle.studentCount !== null && activeGap >= 2)
    ) return [];

    const cancelledStudents = recentCancellations
      .map((registration) => registration.student.name)
      .slice(0, 4)
      .join(', ');
    const priority: OperationsAlertPriority = recentCancellations.length >= 3 || cancellationRate >= 0.3 || activeGap >= 4
      ? 'urgent'
      : 'high';

    return [{
      id: `cycle-churn-risk:${cycle.id}`,
      priority,
      type: 'cycle_churn_risk',
      title: 'סיכון נטישה/רווחיות במחזור',
      entityType: 'cycle',
      entityId: cycle.id,
      entityUrl: cycleUrl(cycle.id),
      clientName: cycle.branch?.name || cycle.course?.name || null,
      cycleName: cycle.name,
      instructorName: cycle.instructor?.name || null,
      description: `${recentCancellations.length} ביטולי הרשמה ב-60 הימים האחרונים${cancelledStudents ? ` (${cancelledStudents})` : ''}. פעילים: ${activeRegistrations.length}/${expectedStudents}.`,
      recommendedAction: 'לבדוק מול הלקוח/הורים ומול המדריך האם יש בעיית שביעות רצון, תוכן, או יציבות שיעורים.',
      detectedAt: context.detectedAt,
      taskId: null,
    } as OperationsAlert];
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
  recentAbsences: AbsenceRiskRecord[];
  recentChangeRequests: MeetingChangeRequestWithRelations[];
  activeCycles: CycleWithRegistrationRisk[];
  churnSinceDate: Date;
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
    ...buildStudentAbsenceRiskAlerts(data.recentAbsences, data.detectedAt),
    ...buildInstructorChangeRiskAlerts(data.recentChangeRequests, data.detectedAt),
    ...buildCycleChurnRiskAlerts(data.activeCycles, {
      detectedAt: data.detectedAt,
      sinceDate: data.churnSinceDate,
    }),
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
  const riskWindowStart = addDays(todayDate, -45);
  const churnWindowStart = addDays(todayDate, -60);
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

  const [todayMeetings, recentCompletedMeetings, pastScheduledMeetings, weekMeetings, overdueTasks, openTasks, openTaskCount, recentAbsences, recentChangeRequests, activeCycles] = await Promise.all([
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
          { assignee: { role: 'operations_control' } },
          { assignee: { role: 'operations_manager' } },
        ],
      },
      include: taskInclude,
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      take: 50,
    }),
    prisma.task.count({
      where: { deletedAt: null, status: { not: 'completed' } },
    }),
    prisma.attendance.findMany({
      where: {
        status: 'absent',
        recordedAt: { gte: riskWindowStart },
        registrationId: { not: null },
        meeting: { deletedAt: null },
      },
      include: {
        meeting: true,
        registration: {
          include: {
            student: { include: { customer: true } },
            cycle: { include: { branch: true, course: true, instructor: true } },
          },
        },
      },
      orderBy: [{ recordedAt: 'desc' }],
      take: 300,
    }),
    prisma.meetingChangeRequest.findMany({
      where: {
        createdAt: { gte: riskWindowStart },
        type: { in: ['cancel', 'postpone'] },
        status: { in: ['pending', 'approved'] },
      },
      include: {
        instructor: true,
        meeting: { include: { cycle: { include: { branch: true, course: true } } } },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 300,
    }),
    prisma.cycle.findMany({
      where: {
        status: 'active',
        deletedAt: null,
      },
      include: {
        branch: true,
        course: true,
        instructor: true,
        registrations: {
          include: {
            student: { include: { customer: true } },
          },
        },
      },
      take: 300,
    }),
  ]);

  const allAlerts = buildOperationsAlerts({
    pastScheduledMeetings,
    recentCompletedMeetings,
    overdueTasks,
    recentAbsences,
    recentChangeRequests,
    activeCycles,
    churnSinceDate: churnWindowStart,
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
    clientRisks: alerts.filter((alert) => (
      alert.entityType === 'cycle'
      || alert.type === 'low_profit'
      || alert.type === 'student_absence_risk'
      || alert.type === 'cycle_churn_risk'
    )),
    openTasks: openTasks.map(mapTask),
  };
}

export const __operationsControlTestUtils = {
  buildPastScheduledAlerts,
  buildMissingTopicAlerts,
  buildMissingAttendanceAlerts,
  buildOverdueTaskAlerts,
  buildLowProfitAlerts,
  buildStudentAbsenceRiskAlerts,
  buildInstructorChangeRiskAlerts,
  buildCycleChurnRiskAlerts,
  dateFromDateString,
};
