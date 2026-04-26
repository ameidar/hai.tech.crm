import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  let userUpdates = 0;
  let userSkippedConflict = 0;
  let instructorUpdates = 0;
  let customerUpdates = 0;
  let customerSkippedConflict = 0;

  // Users
  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  for (const u of users) {
    if (!u.email) continue;
    const normalized = u.email.trim().toLowerCase();
    if (normalized === u.email) continue;

    const conflict = await prisma.user.findFirst({
      where: { email: normalized, id: { not: u.id } },
      select: { id: true },
    });

    if (conflict) {
      console.warn(`[user] CONFLICT skipping ${u.email} (id=${u.id}) — ${normalized} already exists on user ${conflict.id}`);
      userSkippedConflict++;
      continue;
    }

    if (!dryRun) {
      await prisma.user.update({ where: { id: u.id }, data: { email: normalized } });
    }
    console.log(`[user] ${u.email} → ${normalized}`);
    userUpdates++;
  }

  // Instructors (no unique constraint — safe to bulk update)
  const instructors = await prisma.instructor.findMany({ select: { id: true, email: true } });
  for (const i of instructors) {
    if (!i.email) continue;
    const normalized = i.email.trim().toLowerCase();
    if (normalized === i.email) continue;
    if (!dryRun) {
      await prisma.instructor.update({ where: { id: i.id }, data: { email: normalized } });
    }
    console.log(`[instructor] ${i.email} → ${normalized}`);
    instructorUpdates++;
  }

  // Customers (email has unique constraint — skip on conflict)
  const customers = await prisma.customer.findMany({ select: { id: true, email: true } });
  for (const c of customers) {
    if (!c.email) continue;
    const normalized = c.email.trim().toLowerCase();
    if (normalized === c.email) continue;

    const conflict = await prisma.customer.findFirst({
      where: { email: normalized, id: { not: c.id } },
      select: { id: true },
    });

    if (conflict) {
      console.warn(`[customer] CONFLICT skipping ${c.email} (id=${c.id}) — ${normalized} already exists on customer ${conflict.id}`);
      customerSkippedConflict++;
      continue;
    }

    if (!dryRun) {
      await prisma.customer.update({ where: { id: c.id }, data: { email: normalized } });
    }
    console.log(`[customer] ${c.email} → ${normalized}`);
    customerUpdates++;
  }

  console.log('\n=== Summary ===');
  console.log(`Users updated: ${userUpdates} (skipped due to conflict: ${userSkippedConflict})`);
  console.log(`Instructors updated: ${instructorUpdates}`);
  console.log(`Customers updated: ${customerUpdates} (skipped due to conflict: ${customerSkippedConflict})`);
  if (dryRun) console.log('(dry run — no writes performed)');
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
