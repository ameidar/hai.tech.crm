import { prisma } from '../utils/prisma.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MeetingExpenseDetail {
  type: string;
  amount: number;
  hours: number | null;
  rateType: string | null;
  description: string | null;
}

export interface MeetingDetail {
  id: string;
  date: Date;
  startTime: string; // "HH:MM"
  endTime: string;   // "HH:MM"
  durationHours: number;
  cycleName: string;
  courseName: string;
  activityType: string | null;
  topic: string | null;
  instructorPayment: number;
  expenses: MeetingExpenseDetail[];
  totalExpenses: number;
  total: number;
}

export interface InstructorReportData {
  instructorId: string;
  instructorName: string;
  instructorEmail: string | null;
  meetings: MeetingDetail[];
  totalMeetings: number;
  totalHours: number;
  totalPayment: number;
  totalExpenses: number;
  grandTotal: number;
}

export interface UnresolvedMeeting {
  id: string;
  date: Date;
  startTime: string;
  endTime: string;
  instructorName: string;
  cycleName: string;
  status: string;
}

export interface InstructorMonthlyReport {
  month: string; // "YYYY-MM"
  monthLabel: string; // "פברואר 2026"
  generatedAt: Date;
  instructors: InstructorReportData[];
  summaryTotalPayment: number;
  summaryTotalExpenses: number;
  summaryGrandTotal: number;
  unresolvedMeetings: UnresolvedMeeting[]; // meetings still "scheduled" after the month ended
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

export const getMonthLabel = (month: string): string => {
  const [year, m] = month.split('-').map(Number);
  return `${HEBREW_MONTHS[m - 1]} ${year}`;
};

/** Convert Prisma time value (Date object from epoch) to "HH:MM" string */
const formatTime = (t: unknown): string => {
  if (!t) return '';
  const d = t instanceof Date ? t : new Date(t as string);
  const h = String(d.getUTCHours()).padStart(2, '0');
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
};

/** Duration between two Prisma time fields in decimal hours */
const calcDuration = (start: unknown, end: unknown): number => {
  if (!start || !end) return 0;
  const s = start instanceof Date ? start : new Date(start as string);
  const e = end instanceof Date ? end : new Date(end as string);
  const diffMs = e.getTime() - s.getTime();
  return Math.max(0, diffMs / 3_600_000);
};

const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  frontal: 'פרונטלי',
  online:  'אונליין',
  private: 'פרטי',
};

const EXPENSE_TYPE_LABELS: Record<string, string> = {
  extra_instructor: 'מדריך נוסף',
  travel:           'נסיעות',
  taxi:             'מונית',
  materials:        'חומרים',
  other:            'אחר',
};

export const activityLabel = (t: string | null) =>
  t ? (ACTIVITY_TYPE_LABELS[t] ?? t) : '—';

export const expenseTypeLabel = (t: string) =>
  EXPENSE_TYPE_LABELS[t] ?? t;

// ─── Main service ─────────────────────────────────────────────────────────────

/**
 * Build a full instructor activity report for a given month.
 * @param month "YYYY-MM" — e.g. "2026-02"
 */
export async function buildInstructorMonthlyReport(
  month: string,
): Promise<InstructorMonthlyReport> {
  const [year, m] = month.split('-').map(Number);
  const from = new Date(Date.UTC(year, m - 1, 1));
  const to   = new Date(Date.UTC(year, m,     1)); // exclusive

  // 1. Fetch completed meetings for the month
  const meetings = await prisma.meeting.findMany({
    where: {
      scheduledDate: { gte: from, lt: to },
      status: 'completed',
      deletedAt: null,
    },
    include: {
      instructor: true,
      cycle: { include: { course: true } },
      expenses: {
        where: { status: 'approved' },
      },
    },
    orderBy: [
      { instructor: { name: 'asc' } },
      { scheduledDate: 'asc' },
      { startTime: 'asc' },
    ],
  });

  // 2. Group by instructor
  const byInstructor = new Map<string, typeof meetings>();
  for (const mtg of meetings) {
    const list = byInstructor.get(mtg.instructorId) ?? [];
    list.push(mtg);
    byInstructor.set(mtg.instructorId, list);
  }

  // 3. Build report per instructor
  const instructors: InstructorReportData[] = [];

  for (const [instructorId, mtgs] of byInstructor) {
    const instr = mtgs[0].instructor as { id: string; name: string; email: string | null };
    const meetingDetails: MeetingDetail[] = [];

    for (const mtg of mtgs) {
      const expenses: MeetingExpenseDetail[] = mtg.expenses.map((e: { type: string; amount: unknown; hours: unknown; rateType: string | null; description: string | null }) => ({
        type:        expenseTypeLabel(e.type),
        amount:      Number(e.amount),
        hours:       e.hours ? Number(e.hours) : null,
        rateType:    e.rateType,
        description: e.description,
      }));

      const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
      const instructorPayment = Number(mtg.instructorPayment);

      meetingDetails.push({
        id:                mtg.id,
        date:              mtg.scheduledDate,
        startTime:         formatTime(mtg.startTime as unknown),
        endTime:           formatTime(mtg.endTime as unknown),
        durationHours:     calcDuration(mtg.startTime as unknown, mtg.endTime as unknown),
        cycleName:         (mtg.cycle as { course: { name: string } }).course.name,
        courseName:        (mtg.cycle as { course: { name: string } }).course.name,
        activityType:      activityLabel(mtg.activityType),
        topic:             mtg.topic ?? null,
        instructorPayment,
        expenses,
        totalExpenses,
        total:             instructorPayment + totalExpenses,
      });
    }

    const totalPayment  = meetingDetails.reduce((s, r) => s + r.instructorPayment, 0);
    const totalExpenses = meetingDetails.reduce((s, r) => s + r.totalExpenses, 0);

    instructors.push({
      instructorId,
      instructorName:  instr.name,
      instructorEmail: instr.email ?? null,
      meetings:        meetingDetails,
      totalMeetings:   meetingDetails.length,
      totalHours:      parseFloat(meetingDetails.reduce((s, r) => s + r.durationHours, 0).toFixed(2)),
      totalPayment,
      totalExpenses,
      grandTotal:      totalPayment + totalExpenses,
    });
  }

  // 4. Grand totals
  const summaryTotalPayment  = instructors.reduce((s, i) => s + i.totalPayment, 0);
  const summaryTotalExpenses = instructors.reduce((s, i) => s + i.totalExpenses, 0);

  // 5. Unresolved meetings — scheduled but date has passed (still in the report month)
  const unresolvedRaw = await prisma.meeting.findMany({
    where: {
      scheduledDate: { gte: from, lt: to },
      status: 'scheduled',
      deletedAt: null,
    },
    include: {
      instructor: true,
      cycle: { include: { course: true } },
    },
    orderBy: [{ scheduledDate: 'asc' }, { startTime: 'asc' }],
  });

  const unresolvedMeetings: UnresolvedMeeting[] = unresolvedRaw.map(m => ({
    id:             m.id,
    date:           m.scheduledDate,
    startTime:      formatTime(m.startTime as unknown),
    endTime:        formatTime(m.endTime as unknown),
    instructorName: (m.instructor as { name: string }).name,
    cycleName:      (m.cycle as { course: { name: string } }).course.name,
    status:         m.status,
  }));

  return {
    month,
    monthLabel: getMonthLabel(month),
    generatedAt: new Date(),
    instructors,
    summaryTotalPayment,
    summaryTotalExpenses,
    summaryGrandTotal: summaryTotalPayment + summaryTotalExpenses,
    unresolvedMeetings,
  };
}

/** Returns the "previous month" in "YYYY-MM" format (in Israel time) */
export function getPreviousMonth(): string {
  const now = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }),
  );
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}
