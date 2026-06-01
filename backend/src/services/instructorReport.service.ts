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
  locationName: string | null;
  activityType: string | null;
  activityTypeRaw: string | null; // raw enum value: frontal/online/private
  topic: string | null;
  hourlyRate: number | null; // instructor's rate for this activity type
  instructorPayment: number;
  expenses: MeetingExpenseDetail[];
  totalExpenses: number;
  total: number;
  revenue: number;   // meeting revenue (from students)
  profit: number;    // revenue - instructorPayment - totalExpenses
}

export interface ActivityTypeSummary {
  activityType: string;    // translated label: פרונטלי / אונליין / פרטי
  activityTypeRaw: string; // raw: frontal / online / private
  hours: number;
  hourlyRate: number | null;
  subtotal: number; // sum of instructorPayment for meetings of this type
}

export interface InstructorReportData {
  instructorId: string;
  instructorName: string;
  instructorEmail: string | null;
  employmentType: 'employee' | 'freelancer' | string | null;
  meetings: MeetingDetail[];
  byActivityType: ActivityTypeSummary[]; // breakdown by type
  totalMeetings: number;
  totalHours: number;
  totalPayment: number;
  totalExpenses: number;
  grandTotal: number;
}

export interface FixedManagementSalary {
  name: string;
  role: string;
  amount: number;
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
  fixedManagementSalaries: FixedManagementSalary[];
  summaryTotalFixedSalaries: number;
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
  frontal:       'פרונטלי',
  online:        'אונליין',
  private:       'פרטי',        // DB value
  private_lesson:'פרטי',        // Prisma TS enum key
  preparation:   'הכנה',
};

// Map raw activityType → instructor rate field name
const ACTIVITY_RATE_FIELD: Record<string, keyof typeof RATE_FIELDS> = {
  frontal:       'rateFrontal',
  online:        'rateOnline',
  private:       'ratePrivate',       // DB value
  private_lesson:'ratePrivate',       // Prisma TS enum key
  preparation:   'ratePreparation',
};

// Dummy type for rate fields (used for type-safe lookup)
const RATE_FIELDS = {
  rateFrontal: 0,
  rateOnline: 0,
  ratePrivate: 0,
  ratePreparation: 0,
};

type InstructorWithRates = {
  id: string;
  name: string;
  email: string | null;
  employmentType: 'employee' | 'freelancer' | string | null;
  rateFrontal: { toString(): string } | null;
  rateOnline: { toString(): string } | null;
  ratePrivate: { toString(): string } | null;
  ratePreparation: { toString(): string } | null;
};

const getHourlyRate = (instr: InstructorWithRates, actType: string | null): number | null => {
  if (!actType) return null;
  const field = ACTIVITY_RATE_FIELD[actType];
  if (!field) return null;
  const val = (instr as unknown as Record<string, { toString(): string } | null>)[field];
  return val ? Number(val.toString()) : null;
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

const FIXED_MANAGEMENT_SALARIES: FixedManagementSalary[] = [
  { name: 'אור יוסף אשטמקר', role: 'הנהלה / מדריך קבוע', amount: 10_000 },
  { name: 'הילה', role: 'הנהלה', amount: 11_100 },
];

const FIXED_MANAGEMENT_INSTRUCTOR_MATCHERS = [
  'אור יוסף',
  'אור המדריך',
];

const isFixedManagementInstructor = (name: string) =>
  FIXED_MANAGEMENT_INSTRUCTOR_MATCHERS.some((matcher) => name.includes(matcher));

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
      cycle: { include: { course: true, branch: true } },
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

  // Normalize: treat 'private_lesson' (Prisma TS enum) same as 'private' (DB value)
  const normalizeActKey = (k: string | null) => k === 'private_lesson' ? 'private' : (k ?? 'unknown');

  for (const [instructorId, mtgs] of byInstructor) {
    const instr = mtgs[0].instructor as InstructorWithRates;
    if (isFixedManagementInstructor(instr.name)) {
      continue;
    }
    const isEmployee = instr.employmentType === 'employee';

    // Pass 1 — aggregate hours and per-meeting unrounded share by activityType.
    // Payment column reports BASE pay (hours × hourlyRate), without the 1.3 employer-cost
    // multiplier that the stored instructorPayment carries for employees. We sum *unrounded*
    // values across all activity types and floor once at the end (matches accounting convention).
    type ActAgg = { hours: number; rate: number | null; label: string; rawType: string | null; unroundedSubtotal: number };
    const actAgg = new Map<string, ActAgg>();
    const perMeetingUnrounded = new Map<string, number>(); // meetingId -> unrounded base share

    for (const mtg of mtgs) {
      const rawType = (mtg.activityType ?? (mtg.cycle as { activityType?: string | null }).activityType ?? null) as string | null;
      const key = normalizeActKey(rawType);
      const hourlyRate = getHourlyRate(instr, rawType);
      const durationHours = calcDuration(mtg.startTime as unknown, mtg.endTime as unknown);
      const stored = Number(mtg.instructorPayment);

      // Per-meeting unrounded base: hours × rate when rate known; otherwise fallback (stored ÷ 1.3 for employees, stored as-is for freelancers).
      const unroundedShare = (hourlyRate != null && durationHours > 0)
        ? hourlyRate * durationHours
        : (isEmployee ? stored / 1.3 : stored);
      perMeetingUnrounded.set(mtg.id, unroundedShare);

      const existing = actAgg.get(key) ?? { hours: 0, rate: hourlyRate, label: activityLabel(rawType), rawType, unroundedSubtotal: 0 };
      existing.hours += durationHours;
      existing.unroundedSubtotal += unroundedShare;
      actAgg.set(key, existing);
    }

    // Total base = floor(sum of all unrounded shares) — single rounding at the end.
    const totalUnrounded = Array.from(actAgg.values()).reduce((s, v) => s + v.unroundedSubtotal, 0);
    const totalPayment = Math.floor(totalUnrounded);

    // Pass 2 — distribute the (now-rounded) total back to individual meetings fairly.
    // Previously the last meeting absorbed the whole monthly rounding remainder, which made
    // a normal 45-minute row jump from ₪63 to ₪94. Use largest-remainder allocation instead:
    // every row gets floor(unrounded), then +₪1 is assigned to the rows with the largest
    // fractional parts until the instructor's monthly total is reached.
    const sortedRemainders = mtgs
      .map((mtg, index) => {
        const unrounded = perMeetingUnrounded.get(mtg.id) ?? 0;
        return { id: mtg.id, index, remainder: unrounded - Math.floor(unrounded) };
      })
      .sort((a, b) => (b.remainder - a.remainder) || (a.index - b.index));

    const baseFloorsTotal = mtgs.reduce((sum, mtg) => sum + Math.floor(perMeetingUnrounded.get(mtg.id) ?? 0), 0);
    const wholeShekelRemainder = Math.max(0, Math.min(mtgs.length, totalPayment - baseFloorsTotal));
    const remainderRecipients = new Set(sortedRemainders.slice(0, wholeShekelRemainder).map((r) => r.id));

    const meetingDetails: MeetingDetail[] = [];
    for (let i = 0; i < mtgs.length; i++) {
      const mtg = mtgs[i];
      const expenses: MeetingExpenseDetail[] = mtg.expenses.map((e: { type: string; amount: unknown; hours: unknown; rateType: string | null; description: string | null }) => ({
        type:        expenseTypeLabel(e.type),
        amount:      Number(e.amount),
        hours:       e.hours ? Number(e.hours) : null,
        rateType:    e.rateType,
        description: e.description,
      }));
      const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);

      const rawType = (mtg.activityType ?? (mtg.cycle as { activityType?: string | null }).activityType ?? null) as string | null;
      const unrounded = perMeetingUnrounded.get(mtg.id) ?? 0;
      const basePayment = Math.floor(unrounded) + (remainderRecipients.has(mtg.id) ? 1 : 0);

      const revenue = Number(mtg.revenue ?? 0);
      meetingDetails.push({
        id:                mtg.id,
        date:              mtg.scheduledDate,
        startTime:         formatTime(mtg.startTime as unknown),
        endTime:           formatTime(mtg.endTime as unknown),
        durationHours:     calcDuration(mtg.startTime as unknown, mtg.endTime as unknown),
        cycleName:         (mtg.cycle as { name: string; course: { name: string } }).name,
        courseName:        (mtg.cycle as { name: string; course: { name: string } }).course.name,
        locationName:      (mtg.cycle as { branch?: { city?: string | null } | null }).branch?.city ?? null,
        activityType:      activityLabel(rawType),
        activityTypeRaw:   rawType,
        topic:             mtg.topic ?? null,
        hourlyRate:        getHourlyRate(instr, rawType),
        instructorPayment: basePayment,
        expenses,
        totalExpenses,
        total:             basePayment + totalExpenses,
        revenue,
        profit:            revenue - basePayment - totalExpenses,
      });
    }

    const totalExpenses = meetingDetails.reduce((s, r) => s + r.totalExpenses, 0);

    const byActivityType: ActivityTypeSummary[] = Array.from(actAgg.entries())
      .map(([raw, val]) => ({
        activityType:    ACTIVITY_TYPE_LABELS[raw] ?? val.label,
        activityTypeRaw: raw,
        hours:           parseFloat(val.hours.toFixed(2)),
        hourlyRate:      val.rate,
        subtotal:        Math.floor(val.unroundedSubtotal),
      }))
      .sort((a, b) => b.subtotal - a.subtotal);

    instructors.push({
      instructorId,
      instructorName:  instr.name,
      instructorEmail: instr.email ?? null,
      employmentType:  instr.employmentType ?? null,
      meetings:        meetingDetails,
      byActivityType,
      totalMeetings:   meetingDetails.length,
      totalHours:      parseFloat(meetingDetails.reduce((s, r) => s + r.durationHours, 0).toFixed(2)),
      totalPayment,
      totalExpenses,
      grandTotal:      totalPayment + totalExpenses,
    });
  }

  // 4. Grand totals
  const fixedManagementSalaries = FIXED_MANAGEMENT_SALARIES;
  const summaryTotalFixedSalaries = fixedManagementSalaries.reduce((s, i) => s + i.amount, 0);
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
    cycleName:      (m.cycle as { name: string; course: { name: string } }).name,
    status:         m.status,
  }));

  return {
    month,
    monthLabel: getMonthLabel(month),
    generatedAt: new Date(),
    instructors,
    fixedManagementSalaries,
    summaryTotalFixedSalaries,
    summaryTotalPayment,
    summaryTotalExpenses,
    summaryGrandTotal: summaryTotalPayment + summaryTotalExpenses + summaryTotalFixedSalaries,
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
