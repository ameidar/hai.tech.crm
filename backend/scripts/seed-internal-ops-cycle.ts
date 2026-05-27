/**
 * Idempotent seed for the "ניהול ותפעול" internal-operations cycle.
 *
 * This cycle is a container for meetings that don't belong to a real teaching cycle —
 * team calls, technical operations, instructor coaching, etc. Meetings inside it can
 * be marked with `nature='no_revenue'` so they're excluded from revenue rollups while
 * still tracking instructor_payment as an expense.
 *
 * Default instructor: Ami Meidar (matched by phone, falls back to creating an instructor).
 *
 * Run on dev: `npx tsx scripts/seed-internal-ops-cycle.ts`
 * Run on prod: copy + run after a deploy, or wire into deploy.sh post-step.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const AMI_PHONE = '0528746137';
const CYCLE_NAME = 'ניהול ותפעול';
const COURSE_NAME = 'ניהול ותפעול פנים-ארגוני';
const BRANCH_NAME = 'פנים-ארגוני';

async function main() {
  // 1. Instructor — Ami Meidar (find by phone, create if missing)
  let amiInstructor = await prisma.instructor.findFirst({
    where: { phone: AMI_PHONE },
  });
  if (!amiInstructor) {
    amiInstructor = await prisma.instructor.create({
      data: {
        name: 'עמי מידר',
        phone: AMI_PHONE,
        email: 'ami.meidar@gmail.com',
        employmentType: 'employee',
        isActive: true,
        notes: 'יוצר אוטומטית עבור מחזור "ניהול ותפעול".',
      },
    });
    console.log(`[seed] created instructor: עמי מידר (${amiInstructor.id})`);
  } else {
    console.log(`[seed] found instructor: עמי מידר (${amiInstructor.id})`);
  }

  // 2. Course (find-or-create)
  let course = await prisma.course.findFirst({ where: { name: COURSE_NAME } });
  if (!course) {
    course = await prisma.course.create({
      data: {
        name: COURSE_NAME,
        description: 'קורס וירטואלי לפגישות פנים-ארגוניות (לא ללקוחות).',
        category: 'programming',
        isActive: false,
      },
    });
    console.log(`[seed] created course: ${COURSE_NAME} (${course.id})`);
  } else {
    console.log(`[seed] found course: ${COURSE_NAME} (${course.id})`);
  }

  // 3. Branch (find-or-create)
  let branch = await prisma.branch.findFirst({ where: { name: BRANCH_NAME } });
  if (!branch) {
    branch = await prisma.branch.create({
      data: {
        name: BRANCH_NAME,
        type: 'frontal',
        isActive: false,
      },
    });
    console.log(`[seed] created branch: ${BRANCH_NAME} (${branch.id})`);
  } else {
    console.log(`[seed] found branch: ${BRANCH_NAME} (${branch.id})`);
  }

  // 4. Cycle (find-or-create) — open-ended, zero-revenue container
  let cycle = await prisma.cycle.findFirst({
    where: { name: CYCLE_NAME, instructorId: amiInstructor.id, deletedAt: null },
  });
  if (!cycle) {
    cycle = await prisma.cycle.create({
      data: {
        name: CYCLE_NAME,
        courseId: course.id,
        branchId: branch.id,
        instructorId: amiInstructor.id,
        type: 'institutional_fixed',
        status: 'active',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2099-12-31'),
        dayOfWeek: 'sunday',
        startTime: new Date('1970-01-01T08:00:00Z'),
        endTime: new Date('1970-01-01T09:00:00Z'),
        durationMinutes: 60,
        totalMeetings: 0,
        completedMeetings: 0,
        remainingMeetings: 0,
        meetingRevenue: 0,
        pricePerStudent: 0,
        activityType: 'frontal',
        notes:
          'מחזור פנים-ארגוני לפגישות שאינן שייכות למחזור לקוח (שיחות צוות, תפעול, אימון מדריכים). ' +
          'פגישות בודדות יכולות להיות מסומנות nature=no_revenue כדי להחריג אותן מדוחות הכנסה.',
      },
    });
    console.log(`[seed] created cycle: ${CYCLE_NAME} (${cycle.id})`);
  } else {
    console.log(`[seed] found cycle: ${CYCLE_NAME} (${cycle.id})`);
  }

  console.log(`\n[seed] done. cycle id: ${cycle.id}`);
}

main()
  .catch((e) => {
    console.error('[seed] failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
