/**
 * Backfill BillingPeriod.morning_client_name for periods that were issued/linked before the
 * column existed. For each issued period that has a Morning document id but no stored client
 * name, read the client (לכבוד) name off the Morning document and persist it — so the
 * monthly-accounts list shows the institution name exactly as it appears in Morning.
 *
 * Usage (run on prod where Morning credentials are configured):
 *   npx tsx scripts/backfill-morning-client-names.ts --dry-run
 *   npx tsx scripts/backfill-morning-client-names.ts
 */
import { PrismaClient } from '@prisma/client';
import { getMorningDocument } from '../src/services/morning/documents.js';

const prisma = new PrismaClient();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const periods = await prisma.billingPeriod.findMany({
    where: { status: 'issued', morningDocId: { not: null }, morningClientName: null },
    select: { id: true, morningDocId: true, morningDocNumber: true, institutionalOrderId: true },
    orderBy: { issuedAt: 'asc' },
  });

  console.log(`Found ${periods.length} issued period(s) missing morning_client_name.`);

  let updated = 0;
  let noName = 0;
  let failed = 0;

  for (const p of periods) {
    try {
      const doc = await getMorningDocument(p.morningDocId!);
      const name = doc.client?.name?.trim() || null;
      if (!name) {
        console.warn(`[skip] period ${p.id} (doc #${p.morningDocNumber}) — Morning doc has no client name`);
        noName++;
        continue;
      }
      if (!dryRun) {
        await prisma.billingPeriod.update({ where: { id: p.id }, data: { morningClientName: name } });
      }
      console.log(`[ok] period ${p.id} (doc #${p.morningDocNumber}) → "${name}"`);
      updated++;
    } catch (err: any) {
      console.error(`[fail] period ${p.id} (doc #${p.morningDocNumber}):`, err?.message || err);
      failed++;
    }
    await sleep(150); // be gentle with Morning's rate limit
  }

  console.log('\n=== Summary ===');
  console.log(`Updated: ${updated}`);
  console.log(`No client name on doc: ${noName}`);
  console.log(`Failed: ${failed}`);
  if (dryRun) console.log('(dry run — no writes performed)');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
