/**
 * Backfill the new PayingBody (גוף משלם) entity from the legacy free-text
 * institutional_orders.paying_body field.
 *
 * For every order that has a non-empty paying_body text but is not yet linked to a
 * PayingBody, we:
 *   1. Group orders by their normalized paying-body name (trim + collapse whitespace).
 *   2. Reuse an existing PayingBody with that exact name if one already exists
 *      (makes the script safe to re-run), otherwise create one — carrying the best
 *      available taxId / contactName / email / phone / address from the group's orders.
 *   3. Link each order to that PayingBody via paying_body_id.
 *
 * Required fields (name, taxId, contactName, email) are NOT enforced here — legacy data
 * is incomplete by nature. A row is flagged is_complete only when all four are present;
 * the rest are left is_complete=false for manual completion in the UI.
 *
 * The old free-text fields are left untouched (transition period).
 *
 * Usage:
 *   npx tsx scripts/backfill-paying-bodies.ts --dry-run
 *   npx tsx scripts/backfill-paying-bodies.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const norm = (s: string | null | undefined) => (s ? s.replace(/\s+/g, ' ').trim() : '');
const firstNonEmpty = (values: (string | null | undefined)[]) => {
  for (const v of values) {
    const t = norm(v);
    if (t) return t;
  }
  return null;
};

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const orders = await prisma.institutionalOrder.findMany({
    where: { payingBodyId: null, payingBody: { not: null } },
    select: {
      id: true,
      payingBody: true,
      taxId: true,
      contactName: true,
      contactEmail: true,
      contactPhone: true,
      address: true,
      city: true,
      zip: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  // Group by normalized paying-body name (skip blank text).
  const groups = new Map<string, typeof orders>();
  for (const o of orders) {
    const name = norm(o.payingBody);
    if (!name) continue;
    const arr = groups.get(name) ?? [];
    arr.push(o);
    groups.set(name, arr);
  }

  console.log(`Found ${orders.length} unlinked order(s) → ${groups.size} distinct paying body name(s).`);

  let createdBodies = 0;
  let reusedBodies = 0;
  let linkedOrders = 0;

  for (const [name, groupOrders] of groups) {
    // Idempotency: reuse an existing paying body with this exact name.
    let body = await prisma.payingBody.findFirst({ where: { name } });

    if (!body) {
      const taxId = firstNonEmpty(groupOrders.map((o) => o.taxId));
      const contactName = firstNonEmpty(groupOrders.map((o) => o.contactName));
      const email = firstNonEmpty(groupOrders.map((o) => o.contactEmail));
      const phone = firstNonEmpty(groupOrders.map((o) => o.contactPhone));
      const address = firstNonEmpty(groupOrders.map((o) => o.address));
      const city = firstNonEmpty(groupOrders.map((o) => o.city));
      const zip = firstNonEmpty(groupOrders.map((o) => o.zip));
      const isComplete = !!(name && taxId && contactName && email);

      if (dryRun) {
        console.log(`[create] "${name}" (taxId=${taxId ?? '—'}, email=${email ?? '—'}, complete=${isComplete}) → ${groupOrders.length} order(s)`);
        createdBodies++;
        linkedOrders += groupOrders.length;
        continue;
      }

      body = await prisma.payingBody.create({
        data: { name, taxId, contactName, email, phone, address, city, zip, isComplete },
      });
      createdBodies++;
    } else {
      reusedBodies++;
    }

    if (!dryRun) {
      const res = await prisma.institutionalOrder.updateMany({
        where: { id: { in: groupOrders.map((o) => o.id) }, payingBodyId: null },
        data: { payingBodyId: body.id },
      });
      linkedOrders += res.count;
      console.log(`[link] "${name}" → ${res.count} order(s) (${body.isComplete ? 'complete' : 'INCOMPLETE'})`);
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Paying bodies created: ${createdBodies}`);
  console.log(`Paying bodies reused:  ${reusedBodies}`);
  console.log(`Orders linked:         ${linkedOrders}`);
  if (dryRun) console.log('(dry run — no writes performed)');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
