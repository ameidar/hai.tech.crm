import { prisma } from './prisma.js';

/**
 * After a registration change (e.g. cancellation), recalculate revenue + profit
 * for all future scheduled meetings in the cycle.
 * Only applies to cycles with pricePerStudent (private / institutional_per_child).
 */
export async function recalcMeetingRevenue(cycleId: string): Promise<void> {
  const cycle = await prisma.cycle.findUnique({
    where: { id: cycleId },
    select: {
      pricePerStudent: true,
      type: true,
      _count: { select: { registrations: { where: { status: { notIn: ['cancelled', 'pending_cancellation'] } } } } },
    },
  });

  if (!cycle?.pricePerStudent || Number(cycle.pricePerStudent) <= 0) return;
  if (!['private', 'institutional_per_child'].includes(cycle.type)) return;

  const activeCount = cycle._count.registrations;
  const newRevenue = Math.round(Number(cycle.pricePerStudent) * activeCount);

  // Get future scheduled meetings
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const futureMeetings = await prisma.meeting.findMany({
    where: {
      cycleId,
      status: 'scheduled',
      scheduledDate: { gte: today },
    },
    select: { id: true, instructorPayment: true, expenses: true },
  });

  for (const m of futureMeetings) {
    const totalExpenses = Number(m.expenses ?? 0);
    const instructorPayment = Number(m.instructorPayment ?? 0);
    const newProfit = newRevenue - instructorPayment - totalExpenses;
    await prisma.meeting.update({
      where: { id: m.id },
      data: { revenue: newRevenue, profit: newProfit },
    });
  }

  console.log(`[recalcMeetingRevenue] cycle ${cycleId}: ${futureMeetings.length} meetings updated → revenue=${newRevenue} (${activeCount} students)`);
}
