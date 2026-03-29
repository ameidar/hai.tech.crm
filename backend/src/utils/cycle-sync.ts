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
