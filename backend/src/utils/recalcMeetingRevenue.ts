import { prisma } from './prisma.js';
import { meetingRevenueFromRegistrations } from './revenue.js';

/**
 * After a registration change (e.g. cancellation), recalculate revenue + profit
 * for all future scheduled meetings in the cycle.
 */
export async function recalcMeetingRevenue(cycleId: string): Promise<void> {
  const cycle = await prisma.cycle.findUnique({
    where: { id: cycleId },
    select: {
      type: true,
      pricePerStudent: true,
      meetingRevenue: true,
      totalMeetings: true,
      registrations: {
        where: { status: { notIn: ['cancelled', 'pending_cancellation'] } },
        select: { amount: true },
      },
    },
  });

  if (!cycle) return;
  if (cycle.type === 'institutional_fixed') return; // fixed revenue, unchanged

  let newRevenue = 0;

  if (cycle.type === 'institutional_per_child') {
    // pricePerStudent × active students
    const activeCount = cycle.registrations.length;
    newRevenue = Math.round(Number(cycle.pricePerStudent || 0) * activeCount);
  } else if (cycle.type === 'private' || cycle.type === 'trial_private') {
    if (cycle.pricePerStudent && Number(cycle.pricePerStudent) > 0) {
      newRevenue = Math.round(Number(cycle.pricePerStudent) * cycle.registrations.length);
    } else if (cycle.meetingRevenue && Number(cycle.meetingRevenue) > 0) {
      newRevenue = Number(cycle.meetingRevenue);
    } else {
      // sum of active registration amounts / totalMeetings (net of VAT for private)
      newRevenue = meetingRevenueFromRegistrations(
        cycle.registrations,
        Number(cycle.totalMeetings) || 1,
        cycle.type
      );
    }
  }

  if (newRevenue <= 0) return;

  // Update cycle's student_count and meeting_revenue to reflect current state
  const activeCount = cycle.registrations.length;
  await prisma.cycle.update({
    where: { id: cycleId },
    data: {
      studentCount: activeCount,
      meetingRevenue: newRevenue,
    },
  });

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

  console.log(`[recalcMeetingRevenue] cycle ${cycleId}: ${futureMeetings.length} meetings updated → revenue=${newRevenue}`);
}
