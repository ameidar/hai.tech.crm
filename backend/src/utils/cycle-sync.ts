import { prisma } from './prisma.js';

/**
 * Sync cycle progress (completedMeetings + remainingMeetings) from actual DB meetings.
 * Always counts from source-of-truth, so no drift over time.
 * Called automatically whenever a meeting is marked as completed/un-completed.
 */
export async function syncCycleProgress(cycleId: string): Promise<{
  completedMeetings: number;
  remainingMeetings: number;
}> {
  const cycle = await prisma.cycle.findUnique({
    where: { id: cycleId },
    select: { totalMeetings: true },
  });
  if (!cycle) throw new Error(`Cycle ${cycleId} not found`);

  const completedMeetings = await prisma.meeting.count({
    where: { cycleId, status: 'completed' },
  });

  const remainingMeetings = cycle.totalMeetings - completedMeetings;

  await prisma.cycle.update({
    where: { id: cycleId },
    data: { completedMeetings, remainingMeetings },
  });

  return { completedMeetings, remainingMeetings };
}

/**
 * Resync a cycle's endDate to the date of its last real meeting.
 * Recomputes from source-of-truth (the latest non-cancelled, non-postponed meeting),
 * so adding a meeting — manually or via a postponement replacement — extends the
 * cycle's end date instead of leaving the stale value set at cycle creation.
 * Cancelled/postponed meetings are excluded since they don't represent a real session.
 * No-op when the cycle has no qualifying meetings (keeps the existing endDate).
 */
export async function syncCycleEndDate(cycleId: string): Promise<Date | null> {
  const lastMeeting = await prisma.meeting.findFirst({
    where: {
      cycleId,
      deletedAt: null,
      status: { notIn: ['cancelled', 'postponed'] },
    },
    orderBy: { scheduledDate: 'desc' },
    select: { scheduledDate: true },
  });
  if (!lastMeeting) return null;

  await prisma.cycle.update({
    where: { id: cycleId },
    data: { endDate: lastMeeting.scheduledDate },
  });
  return lastMeeting.scheduledDate;
}
