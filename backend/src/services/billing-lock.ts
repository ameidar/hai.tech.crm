import { prisma } from '../utils/prisma.js';
import { AppError } from '../middleware/errorHandler.js';

function monthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/**
 * Find the issued billing period (if any) whose range covers the meeting's scheduled month.
 * A period covers month M when `monthStart <= M <= monthEnd` (both stored as first-of-month).
 */
export async function findIssuedPeriodForCycleMonth(
  cycleId: string,
  scheduledDate: Date
): Promise<{ id: string; morningDocNumber: number | null; monthStart: Date; monthEnd: Date } | null> {
  const cycle = await prisma.cycle.findUnique({
    where: { id: cycleId },
    select: { institutionalOrderId: true },
  });
  if (!cycle?.institutionalOrderId) return null;

  const meetingMonth = monthStart(scheduledDate);
  return prisma.billingPeriod.findFirst({
    where: {
      institutionalOrderId: cycle.institutionalOrderId,
      monthStart: { lte: meetingMonth },
      monthEnd: { gte: meetingMonth },
      status: 'issued',
    },
    select: { id: true, morningDocNumber: true, monthStart: true, monthEnd: true },
  });
}

export async function assertCyclePeriodNotLocked(cycleId: string, scheduledDate: Date) {
  const period = await findIssuedPeriodForCycleMonth(cycleId, scheduledDate);
  if (!period) return;
  const docPart = period.morningDocNumber ? ` (חשבונית #${period.morningDocNumber})` : '';
  throw new AppError(
    423,
    `התקופה הזו נחתמה — הופקה חשבונית${docPart}. ביטול הנעילה אפשרי רק על-ידי אדמין מדף החיוב.`
  );
}

export async function assertMeetingNotInIssuedPeriod(meetingId: string) {
  const link = await prisma.billingPeriodMeeting.findFirst({
    where: {
      meetingId,
      billingPeriod: { status: 'issued' },
    },
    select: {
      billingPeriod: { select: { morningDocNumber: true } },
    },
  });
  if (!link) return;
  const docPart = link.billingPeriod.morningDocNumber
    ? ` (חשבונית #${link.billingPeriod.morningDocNumber})`
    : '';
  throw new AppError(
    423,
    `הפגישה הזו כלולה בחשבונית שכבר הופקה${docPart}. אי אפשר למחוק אותה עד שתבוטל הנעילה (אדמין בלבד).`
  );
}
