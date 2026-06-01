import { prisma } from '../utils/prisma.js';

type RateValue = { toString(): string } | number | string | null | undefined;

export type InstructorPaymentMode = 'hourly' | 'daily';

export type InstructorPaymentCycle = {
  id: string;
  instructorId: string;
  instructorPaymentMode?: string | null;
  instructorDailyRate?: RateValue;
  activityType?: string | null;
  isOnline?: boolean | null;
  type?: string | null;
  durationMinutes?: number | null;
};

export type InstructorPaymentInstructor = {
  employmentType?: string | null;
  rateFrontal?: RateValue;
  rateOnline?: RateValue;
  ratePrivate?: RateValue;
};

export type InstructorPaymentMeeting = {
  id?: string;
  instructorId: string;
  startTime?: Date | null;
  endTime?: Date | null;
  activityType?: string | null;
};

const toNumber = (value: RateValue): number => {
  if (value == null) return 0;
  return Number(typeof value === 'object' ? value.toString() : value) || 0;
};

const activityTypeFor = (
  meeting: Pick<InstructorPaymentMeeting, 'activityType'>,
  cycle: InstructorPaymentCycle,
): string => (
  meeting.activityType ||
  cycle.activityType ||
  (cycle.isOnline ? 'online' : (cycle.type === 'private' || cycle.type === 'trial_private') ? 'private_lesson' : 'frontal')
);

const durationMinutesFor = (
  meeting: Pick<InstructorPaymentMeeting, 'startTime' | 'endTime'>,
  cycle: InstructorPaymentCycle,
): number => {
  let durationMinutes = Number(cycle.durationMinutes || 60);
  if (meeting.startTime && meeting.endTime) {
    const calculated = (meeting.endTime.getTime() - meeting.startTime.getTime()) / 60000;
    if (calculated > 0 && calculated < 1440) {
      durationMinutes = calculated;
    }
  }
  return durationMinutes;
};

export const usesDailyInstructorPayment = (
  cycle: InstructorPaymentCycle,
  instructorId: string | null | undefined,
): boolean => (
  cycle.instructorPaymentMode === 'daily' &&
  Boolean(cycle.instructorDailyRate) &&
  Boolean(instructorId) &&
  instructorId === cycle.instructorId
);

export const calculateInstructorPayment = (
  cycle: InstructorPaymentCycle,
  instructor: InstructorPaymentInstructor | null | undefined,
  meeting: InstructorPaymentMeeting,
): number => {
  if (!instructor) return 0;

  if (usesDailyInstructorPayment(cycle, meeting.instructorId)) {
    return Math.round(toNumber(cycle.instructorDailyRate));
  }

  const activityType = activityTypeFor(meeting, cycle);
  let hourlyRate = 0;
  switch (activityType) {
    case 'online':
      hourlyRate = toNumber(instructor.rateOnline) || toNumber(instructor.rateFrontal);
      break;
    case 'private_lesson':
      hourlyRate = toNumber(instructor.ratePrivate) || toNumber(instructor.rateFrontal);
      break;
    case 'frontal':
    default:
      hourlyRate = toNumber(instructor.rateFrontal);
      break;
  }

  let payment = Math.round(hourlyRate * (durationMinutesFor(meeting, cycle) / 60));
  if (instructor.employmentType === 'employee') {
    payment = Math.round(payment * 1.3);
  }
  return payment;
};

export const recalculateDailyInstructorPaymentsForDay = async (
  cycleId: string,
  instructorId: string,
  scheduledDate: Date,
) => {
  const cycle = await prisma.cycle.findUnique({
    where: { id: cycleId },
    select: {
      id: true,
      instructorId: true,
      instructorPaymentMode: true,
      instructorDailyRate: true,
    },
  });

  if (!cycle || !usesDailyInstructorPayment(cycle, instructorId)) {
    return { recalculated: 0 };
  }

  const meetings = await prisma.meeting.findMany({
    where: {
      cycleId,
      instructorId,
      scheduledDate,
      status: 'completed',
      deletedAt: null,
    },
    include: {
      expenses: { where: { status: 'approved' } },
    },
    orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
  });

  const dailyRate = Math.round(toNumber(cycle.instructorDailyRate));

  for (let i = 0; i < meetings.length; i++) {
    const meeting = meetings[i];
    const instructorPayment = i === 0 ? dailyRate : 0;
    const expensesTotal = meeting.expenses.reduce((sum, expense) => sum + toNumber(expense.amount), 0);
    const revenue = toNumber(meeting.revenue);
    await prisma.meeting.update({
      where: { id: meeting.id },
      data: {
        instructorPayment,
        profit: revenue - instructorPayment - expensesTotal,
      },
    });
  }

  return { recalculated: meetings.length };
};

export const recalculateDailyInstructorPaymentsForMeeting = async (meeting: {
  cycleId: string;
  instructorId: string;
  scheduledDate: Date;
}) => recalculateDailyInstructorPaymentsForDay(meeting.cycleId, meeting.instructorId, meeting.scheduledDate);

export const recalculateInstructorPaymentsForCycle = async (cycleId: string) => {
  const cycle = await prisma.cycle.findUnique({
    where: { id: cycleId },
    select: {
      id: true,
      instructorId: true,
      instructorPaymentMode: true,
      instructorDailyRate: true,
      activityType: true,
      isOnline: true,
      type: true,
      durationMinutes: true,
    },
  });

  if (!cycle) {
    return { recalculated: 0 };
  }

  const meetings = await prisma.meeting.findMany({
    where: {
      cycleId,
      status: 'completed',
      deletedAt: null,
    },
    include: {
      instructor: true,
      expenses: { where: { status: 'approved' } },
    },
    orderBy: [{ scheduledDate: 'asc' }, { startTime: 'asc' }, { id: 'asc' }],
  });

  const dailyPaymentKeys = new Set<string>();

  for (const meeting of meetings) {
    let instructorPayment = calculateInstructorPayment(cycle, meeting.instructor, meeting);
    if (usesDailyInstructorPayment(cycle, meeting.instructorId)) {
      const dailyKey = `${meeting.cycleId}|${meeting.scheduledDate.toISOString().split('T')[0]}`;
      if (dailyPaymentKeys.has(dailyKey)) {
        instructorPayment = 0;
      } else {
        dailyPaymentKeys.add(dailyKey);
      }
    }

    const expensesTotal = meeting.expenses.reduce((sum, expense) => sum + toNumber(expense.amount), 0);
    const revenue = toNumber(meeting.revenue);
    await prisma.meeting.update({
      where: { id: meeting.id },
      data: {
        instructorPayment,
        profit: revenue - instructorPayment - expensesTotal,
      },
    });
  }

  return { recalculated: meetings.length };
};
