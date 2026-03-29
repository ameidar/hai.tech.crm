/**
 * Update Instructors from Fireberry CSV
 * 1. Enrich instructor data (phone, email) from Fireberry מדריכים.csv
 * 2. Set is_active = false for instructors with NO active cycles
 *
 * Run: cd backend && npx ts-node src/scripts/update-instructors.ts [--dry-run]
 */

import fs from 'fs';
import * as csv from '@fast-csv/parse';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

const CSV_PATH = '/home/ameidar/.openclaw/media/inbound/fc670afe-cfcc-4681-934c-e55c0b5cfa50.csv';

function normalizePhone(p: string): string {
  if (!p?.trim()) return '';
  return p.trim().replace(/[\s\-\.]/g, '').replace(/^\+972/, '0').replace(/^972/, '0');
}

async function main() {
  console.log(`👤 Update Instructors${DRY_RUN ? ' [DRY RUN]' : ''}`);

  // ── Load DB instructors ──────────────────────────────────────────────────────
  const instructors = await prisma.instructor.findMany({
    select: { id: true, name: true, phone: true, email: true, isActive: true }
  });
  console.log(`📊 Instructors in DB: ${instructors.length}`);

  // ── Get instructors with active cycles ───────────────────────────────────────
  const activeCyclesResult = await prisma.$queryRaw<{ instructor_id: string }[]>`
    SELECT DISTINCT instructor_id FROM cycles WHERE status = 'active'
  `;
  const hasActiveCycle = new Set(activeCyclesResult.map(r => r.instructor_id));
  console.log(`✅ Instructors with active cycles: ${hasActiveCycle.size}`);

  // ── Parse CSV ────────────────────────────────────────────────────────────────
  const rows: any[] = await new Promise((resolve, reject) => {
    const data: any[] = [];
    fs.createReadStream(CSV_PATH)
      .pipe(csv.parse({ headers: true, trim: true }))
      .on('data', row => data.push(row))
      .on('end', () => resolve(data))
      .on('error', reject);
  });

  // Build name → {phone, email} map from CSV
  const csvMap = new Map<string, { phone: string; email: string; fbId: string }>();
  for (const r of rows) {
    const name = r['name']?.trim() || '';
    if (!name) continue;
    csvMap.set(name, {
      phone: normalizePhone(r['pcfsystemfield75'] || ''),
      email: (r['pcfsystemfield77'] || '').trim().toLowerCase(),
      fbId: r['customobject1002id']?.trim() || '',
    });
  }
  console.log(`📋 CSV instructors: ${csvMap.size}`);

  // ── Update each instructor ───────────────────────────────────────────────────
  let setInactive = 0, setActive = 0, enriched = 0, noChange = 0;

  for (const inst of instructors) {
    const shouldBeActive = hasActiveCycle.has(inst.id);
    const csvData = csvMap.get(inst.name.trim());

    const updates: Record<string, any> = {};

    // Update is_active
    if (inst.isActive !== shouldBeActive) {
      updates.isActive = shouldBeActive;
      if (shouldBeActive) setActive++; else setInactive++;
    }

    // Enrich phone if it's a NOTEL placeholder or empty
    if (csvData?.phone && (!inst.phone || inst.phone.startsWith('NOTEL'))) {
      updates.phone = csvData.phone;
    }

    // Enrich email if empty
    if (csvData?.email && !inst.email) {
      updates.email = csvData.email;
    }

    if (Object.keys(updates).length > 0) {
      if (Object.keys(updates).some(k => k !== 'isActive')) enriched++;
      if (!DRY_RUN) {
        await prisma.instructor.update({ where: { id: inst.id }, data: updates });
      }
    } else {
      noChange++;
    }
  }

  console.log(`\n✅ Done!`);
  console.log(`  Set inactive:    ${setInactive}`);
  console.log(`  Set active:      ${setActive}`);
  console.log(`  Phone/email enriched: ${enriched}`);
  console.log(`  No change:       ${noChange}`);

  if (DRY_RUN) console.log('\n⚠️  DRY RUN — nothing written');

  // Summary
  if (!DRY_RUN) {
    const [totalActive, totalInactive] = await Promise.all([
      prisma.instructor.count({ where: { isActive: true } }),
      prisma.instructor.count({ where: { isActive: false } }),
    ]);
    console.log(`\nDB state: ${totalActive} active | ${totalInactive} inactive`);
  }

  await prisma.$disconnect();
}

main().catch(async e => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
