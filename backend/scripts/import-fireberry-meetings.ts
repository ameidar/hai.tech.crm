import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

// Fireberry meetings data for "הרעות כרמיאל- קבוצה 1 כיתות ד"
const fireberryMeetings = [
  { date: "2025-11-11", time: "08:00", status: "cancelled", instructorPayment: 0, revenue: 0 },
  { date: "2025-11-25", time: "08:00", status: "cancelled", instructorPayment: 0, revenue: 0 },
  { date: "2025-12-02", time: "08:00", status: "completed", instructorPayment: 120, revenue: 508.47 },
  { date: "2025-12-09", time: "08:00", status: "completed", instructorPayment: 120, revenue: 508.47 },
  { date: "2025-12-23", time: "08:00", status: "completed", instructorPayment: 120, revenue: 508.47 },
  { date: "2025-12-30", time: "08:00", status: "completed", instructorPayment: 120, revenue: 508.47 },
  { date: "2026-01-13", time: "08:00", status: "completed", instructorPayment: 120, revenue: 508.47 },
  { date: "2026-01-20", time: "08:00", status: "completed", instructorPayment: 120, revenue: 508.47 },
  { date: "2026-02-03", time: "08:00", status: "completed", instructorPayment: 120, revenue: 508.47 },
  { date: "2026-02-10", time: "08:00", status: "scheduled", instructorPayment: 0, revenue: 0 },
  { date: "2026-02-17", time: "08:00", status: "scheduled", instructorPayment: 0, revenue: 0 },
  { date: "2026-03-10", time: "08:00", status: "scheduled", instructorPayment: 0, revenue: 0 },
  { date: "2026-03-17", time: "08:00", status: "scheduled", instructorPayment: 0, revenue: 0 },
  { date: "2026-03-31", time: "08:00", status: "scheduled", instructorPayment: 0, revenue: 0 },
  { date: "2026-04-14", time: "08:00", status: "scheduled", instructorPayment: 0, revenue: 0 },
  { date: "2026-04-21", time: "08:00", status: "scheduled", instructorPayment: 0, revenue: 0 },
  { date: "2026-04-28", time: "08:00", status: "scheduled", instructorPayment: 0, revenue: 0 },
  { date: "2026-05-05", time: "08:00", status: "scheduled", instructorPayment: 0, revenue: 0 },
  { date: "2026-05-12", time: "08:00", status: "scheduled", instructorPayment: 0, revenue: 0 },
  { date: "2026-05-19", time: "08:00", status: "scheduled", instructorPayment: 0, revenue: 0 },
  { date: "2026-06-02", time: "08:00", status: "scheduled", instructorPayment: 0, revenue: 0 },
  { date: "2026-06-09", time: "08:00", status: "scheduled", instructorPayment: 0, revenue: 0 },
  { date: "2026-06-16", time: "08:00", status: "scheduled", instructorPayment: 0, revenue: 0 },
  { date: "2026-06-23", time: "08:00", status: "scheduled", instructorPayment: 0, revenue: 0 },
];

async function main() {
  // 1. Find the cycle
  const cycle = await prisma.cycle.findFirst({
    where: { name: 'הרעות כרמיאל- קבוצה 1 כיתות ד' }
  });
  
  if (!cycle) {
    console.error('Cycle not found!');
    return;
  }
  console.log('Found cycle:', cycle.id, cycle.name);

  // 2. Find instructor "אלי לואיס"
  const instructor = await prisma.instructor.findFirst({
    where: { name: { contains: 'אלי לואיס' } }
  });
  
  if (!instructor) {
    console.error('Instructor not found!');
    return;
  }
  console.log('Found instructor:', instructor.id, instructor.name);

  // 3. Check existing meetings
  const existingCount = await prisma.meeting.count({ where: { cycleId: cycle.id } });
  console.log('Existing meetings for this cycle:', existingCount);

  if (existingCount > 0) {
    console.log('Deleting existing meetings first...');
    await prisma.meeting.deleteMany({ where: { cycleId: cycle.id } });
  }

  // 4. Import meetings
  let imported = 0;
  for (const m of fireberryMeetings) {
    await prisma.meeting.create({
      data: {
        cycleId: cycle.id,
        instructorId: instructor.id,
        scheduledDate: new Date(m.date),
        startTime: new Date(`1970-01-01T${m.time}:00Z`),
        endTime: new Date('1970-01-01T09:30:00Z'),
        status: m.status as any,
        instructorPayment: new Prisma.Decimal(m.instructorPayment),
        revenue: new Prisma.Decimal(m.revenue),
        profit: new Prisma.Decimal(m.revenue - m.instructorPayment),
        activityType: 'frontal',
      }
    });
    imported++;
    console.log(`  ✓ ${m.date} - ${m.status}`);
  }

  console.log(`\n✅ Imported ${imported} meetings for "${cycle.name}"`);
  
  // Update cycle totals
  await prisma.cycle.update({
    where: { id: cycle.id },
    data: {
      totalMeetings: imported,
      completedMeetings: fireberryMeetings.filter(m => m.status === 'completed').length,
    }
  });
  console.log('✅ Updated cycle meeting counts');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
