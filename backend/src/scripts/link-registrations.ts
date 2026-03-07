/**
 * Link Students to Historical Cycles via Fireberry Registration Data
 *
 * Uses לקוחות-מאוחד-עם-מזהה-מחזור.csv to link students to their cycles.
 * Matches:
 *   - Customer: by normalized phone OR email
 *   - Student: by name under the matched customer
 *   - Cycle: by fireberry_id (GUID from the enriched CSV)
 *
 * Run: cd backend && npx ts-node src/scripts/link-registrations.ts [--dry-run]
 */

import fs from 'fs';
import * as csv from '@fast-csv/parse';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

const CSV_PATH = '/home/ameidar/.openclaw/workspace/לקוחות-מאוחד-עם-מזהה-מחזור.csv';

// Normalize Israeli phone number → 05XXXXXXXX or 0X-XXXXXXX
function normalizePhone(p: string): string {
  if (!p?.trim()) return '';
  let n = p.trim().replace(/[\s\-\.]/g, '');
  // +972 → 0
  n = n.replace(/^\+972/, '0').replace(/^972/, '0');
  return n;
}

// Status mapping from Fireberry to CRM
function mapStatus(s: string): string {
  const map: Record<string, string> = {
    'סיים': 'completed',
    'פעיל': 'registered',
    'נרשם': 'registered',
    'ממתין': 'registered',
    'בוטל': 'cancelled',
    'אפסייל': 'registered', // upsell = still registered
    '': 'registered',
  };
  return map[s?.trim()] || 'registered';
}

async function main() {
  console.log(`🔗 Link Registrations from Fireberry${DRY_RUN ? ' [DRY RUN]' : ''}`);

  // ── Load DB data ─────────────────────────────────────────────────────────────
  console.log('📥 Loading DB data...');
  const [customers, students, cycles, existingRegs] = await Promise.all([
    prisma.customer.findMany({ select: { id: true, phone: true, email: true } }),
    prisma.student.findMany({ select: { id: true, name: true, customerId: true } }),
    prisma.cycle.findMany({ where: { fireberryId: { not: null } }, select: { id: true, fireberryId: true } }),
    prisma.registration.findMany({ select: { studentId: true, cycleId: true } }),
  ]);

  console.log(`  Customers: ${customers.length} | Students: ${students.length} | Cycles w/ fireberry_id: ${cycles.length} | Existing registrations: ${existingRegs.length}`);

  // ── Build lookup maps ────────────────────────────────────────────────────────
  // customer by normalized phone
  const custByPhone = new Map<string, string>(); // phone → customer_id
  const custByEmail = new Map<string, string>(); // email → customer_id
  for (const c of customers) {
    if (c.phone) {
      const norm = normalizePhone(c.phone);
      if (norm && !norm.startsWith('NOTEL')) custByPhone.set(norm, c.id);
    }
    if (c.email) custByEmail.set(c.email.trim().toLowerCase(), c.id);
  }

  // students by customerId + normalizedName
  const studentByKey = new Map<string, string>(); // `${customerId}:${nameLower}` → student_id
  for (const s of students) {
    const key = `${s.customerId}:${s.name.trim().toLowerCase()}`;
    studentByKey.set(key, s.id);
  }

  // cycles by fireberry_id (uppercase)
  const cycleByFbId = new Map<string, string>(); // fireberryId.upper → cycle_id
  for (const c of cycles) {
    if (c.fireberryId) cycleByFbId.set(c.fireberryId.toUpperCase(), c.id);
  }

  // existing registrations set
  const regSet = new Set(existingRegs.map(r => `${r.studentId}:${r.cycleId}`));

  // ── Parse CSV ────────────────────────────────────────────────────────────────
  const rows: any[] = await new Promise((resolve, reject) => {
    const data: any[] = [];
    fs.createReadStream(CSV_PATH)
      .pipe(csv.parse({ headers: true, trim: true }))
      .on('data', row => data.push(row))
      .on('end', () => resolve(data))
      .on('error', reject);
  });

  console.log(`📋 CSV rows: ${rows.length}`);

  // Only rows with a fireberry cycle ID
  const relevant = rows.filter(r => r['מזהה מחזור (Fireberry)']?.trim());
  console.log(`🎯 Rows with cycle Fireberry ID: ${relevant.length}`);

  // ── Link ──────────────────────────────────────────────────────────────────────
  let created = 0, alreadyExists = 0, noCustomer = 0, noStudent = 0, noCycle = 0, errors = 0;

  for (const r of relevant) {
    try {
      // Find customer
      const phone = normalizePhone(r['טלפון (שם מלא)'] || '');
      const email = (r['מייל (שם מלא)'] || '').trim().toLowerCase();
      const fbCycleId = (r['מזהה מחזור (Fireberry)'] || '').trim().toUpperCase();

      let customerId = custByPhone.get(phone) || custByEmail.get(email);
      if (!customerId) {
        noCustomer++;
        continue;
      }

      // Find student
      const studentName = (r['שם התלמיד/ה'] || '').trim();
      if (!studentName) {
        noStudent++;
        continue;
      }
      const studentKey = `${customerId}:${studentName.toLowerCase()}`;
      const studentId = studentByKey.get(studentKey);
      if (!studentId) {
        noStudent++;
        continue;
      }

      // Find cycle
      const cycleId = cycleByFbId.get(fbCycleId);
      if (!cycleId) {
        noCycle++;
        continue;
      }

      // Check if already exists
      const regKey = `${studentId}:${cycleId}`;
      if (regSet.has(regKey)) {
        alreadyExists++;
        continue;
      }

      // Create registration
      const status = mapStatus(r['סטטוס הרשמה'] || '');
      const regDateStr = r['תאריך הרשמה']?.trim() || '';
      let registrationDate: Date = new Date();
      if (regDateStr) {
        // Format: DD/MM/YYYY
        const [d, m, y] = regDateStr.split('/');
        if (d && m && y) registrationDate = new Date(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`);
      }
      const amount = parseFloat(r['סכום ששולם'] || '0') || 0;

      if (!DRY_RUN) {
        await prisma.$executeRawUnsafe(`
          INSERT INTO registrations (id, student_id, cycle_id, registration_date, status, amount, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5::"RegistrationStatus", $6, NOW(), NOW())
        `,
          randomUUID(), studentId, cycleId,
          registrationDate, status, amount > 0 ? amount : null
        );
      }

      regSet.add(regKey); // prevent duplicates within the same run
      created++;
    } catch (e: any) {
      errors++;
      if (errors <= 5) console.error(`  ❌ ${e.message?.slice(0, 100)}`);
    }
  }

  console.log(`\n✅ Done!`);
  console.log(`  Created:         ${created} registrations`);
  console.log(`  Already existed: ${alreadyExists}`);
  console.log(`  No customer:     ${noCustomer}`);
  console.log(`  No student:      ${noStudent}`);
  console.log(`  No cycle:        ${noCycle}`);
  console.log(`  Errors:          ${errors}`);
  if (DRY_RUN) console.log('\n⚠️  DRY RUN — nothing written');

  await prisma.$disconnect();
}

main().catch(async e => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
