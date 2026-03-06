/**
 * Fireberry (Powerlink) Customer Import
 * Imports customers and students from לקוחות-מאוחד.csv into HaiTech CRM.
 *
 * Logic:
 *   - For each row: find existing customer by phone OR email
 *   - If not found → create new customer
 *   - If student name exists (not "-" or empty) → create student under that customer (if not duplicate)
 *   - Duplicate student: same customer + same student name → skip
 *   - Skips internal emails: ami@hai.tech, inna@hai.tech, etc.
 *
 * Run (DRY RUN):
 *   DRY_RUN=1 npx ts-node -r dotenv/config src/scripts/fireberry-import.ts
 * Run (REAL):
 *   npx ts-node -r dotenv/config src/scripts/fireberry-import.ts
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import { parse } from '@fast-csv/parse';

const prisma = new PrismaClient();
const DRY_RUN = process.env.DRY_RUN === '1';
const CSV_PATH = process.env.CSV_PATH || '/home/ameidar/.openclaw/workspace/לקוחות-מאוחד.csv';

// Internal accounts to skip
const SKIP_EMAILS = new Set([
  'ami@hai.tech', 'inna@hai.tech', 'info@hai.tech', 'hila@hai.tech',
  'ami.meidar@gmail.com', 'mirit@miritbrodet.co.il',
]);
const SKIP_PHONES = new Set([
  '0501234567', '0500000000', '0528746137',
]);

interface CsvRow {
  accountid: string;
  name: string;
  phone: string;
  email: string;
  cycleName: string;
  studentName: string;
}

function normalizePhone(raw: string): string {
  if (!raw || raw.trim() === '-') return '';
  const digits = raw.replace(/\D/g, '');
  if (!digits || digits.length < 9) return '';
  if (digits.startsWith('972') && digits.length === 12) return '0' + digits.slice(3);
  if (digits.startsWith('0') && digits.length >= 9 && digits.length <= 11) return digits;
  if (digits.length >= 9) return digits; // fallback
  return '';
}

function normalizeEmail(raw: string): string {
  if (!raw || raw.trim() === '-') return '';
  const email = raw.trim().toLowerCase();
  // Basic validation — must contain @
  if (!email.includes('@')) return '';
  return email;
}

function normalizeName(raw: string): string {
  if (!raw || raw.trim() === '-') return '';
  return raw.trim();
}

function generateId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 25; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function parseCsv(filePath: string): Promise<CsvRow[]> {
  return new Promise((resolve, reject) => {
    const rows: CsvRow[] = [];
    fs.createReadStream(filePath)
      .pipe(parse({ headers: true, ignoreEmpty: true, trim: true, encoding: 'utf8' }))
      .on('data', (row: Record<string, string>) => {
        rows.push({
          accountid: (row['accountid'] || '').trim(),
          name: normalizeName(row['שם מלא'] || ''),
          phone: normalizePhone(row['טלפון (שם מלא)'] || ''),
          email: normalizeEmail(row['מייל (שם מלא)'] || ''),
          cycleName: normalizeName(row['שם המחזור (מחזור)'] || ''),
          studentName: normalizeName(row['שם התלמיד/ה'] || ''),
        });
      })
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

async function main() {
  console.log(`\n=== Fireberry Customer Import ${DRY_RUN ? '(DRY RUN)' : '(LIVE)'} ===\n`);
  console.log(`CSV: ${CSV_PATH}`);

  const allRows = await parseCsv(CSV_PATH);
  console.log(`Loaded: ${allRows.length} rows from CSV`);

  // Filter out internal/test accounts
  const rows = allRows.filter(r => {
    if (!r.phone && !r.email) return false;
    if (r.email && SKIP_EMAILS.has(r.email)) return false;
    if (r.phone && SKIP_PHONES.has(r.phone)) return false;
    return true;
  });
  console.log(`After filtering internal accounts: ${rows.length} rows\n`);

  // Stats
  let customersCreated = 0;
  let customersFound = 0;
  let studentsCreated = 0;
  let studentsSkipped = 0;
  let rowsSkipped = 0;
  const errors: string[] = [];

  // In-memory cache for speed
  const phoneCache = new Map<string, string>(); // phone → customerId
  const emailCache = new Map<string, string>(); // email → customerId
  const studentCache = new Map<string, Set<string>>(); // customerId → Set<studentName lower>

  // Pre-load existing customers
  console.log('Loading existing customers into cache...');
  const existingCustomers = await prisma.customer.findMany({
    where: { deletedAt: null },
    select: { id: true, phone: true, email: true },
  });
  for (const c of existingCustomers) {
    if (c.phone) phoneCache.set(c.phone, c.id);
    if (c.email) emailCache.set(c.email, c.id);
  }

  // Pre-load existing students
  const existingStudents = await prisma.student.findMany({
    where: { deletedAt: null },
    select: { customerId: true, name: true },
  });
  for (const s of existingStudents) {
    if (!studentCache.has(s.customerId)) studentCache.set(s.customerId, new Set());
    studentCache.get(s.customerId)!.add(s.name.trim().toLowerCase());
  }

  console.log(`  Existing customers: ${existingCustomers.length}`);
  console.log(`  Existing students: ${existingStudents.length}`);
  console.log('');

  for (const row of rows) {
    // Find existing customer by phone OR email
    let customerId: string | null = null;
    if (row.phone && phoneCache.has(row.phone)) {
      customerId = phoneCache.get(row.phone)!;
    } else if (row.email && emailCache.has(row.email)) {
      customerId = emailCache.get(row.email)!;
    }

    if (!customerId) {
      // Create new customer
      if (DRY_RUN) {
        customerId = `dry_${generateId()}`;
        console.log(`✅ [DRY] Customer: ${row.name} | ${row.phone} | ${row.email}`);
      } else {
        try {
          const newCustomer = await prisma.customer.create({
            data: {
              id: generateId(),
              name: row.name || 'ללא שם',
              phone: row.phone || '',
              email: row.email || null,
              notes: `Fireberry: ${row.accountid}`,
            },
          });
          customerId = newCustomer.id;
        } catch (err: any) {
          // Race condition — find the existing one
          const found = await prisma.customer.findFirst({
            where: {
              deletedAt: null,
              OR: [
                ...(row.phone ? [{ phone: row.phone }] : []),
                ...(row.email ? [{ email: row.email }] : []),
              ],
            },
          });
          if (found) {
            customerId = found.id;
          } else {
            errors.push(`Failed customer ${row.name} [${row.phone}]: ${err.message}`);
            rowsSkipped++;
            continue;
          }
        }
      }
      customersCreated++;
      if (row.phone) phoneCache.set(row.phone, customerId);
      if (row.email) emailCache.set(row.email, customerId);
      if (!studentCache.has(customerId)) studentCache.set(customerId, new Set());
    } else {
      customersFound++;
    }

    // Handle student
    const studentName = row.studentName;
    if (studentName && studentName !== '-') {
      const existingNames = studentCache.get(customerId) || new Set();
      if (existingNames.has(studentName.toLowerCase())) {
        studentsSkipped++;
      } else {
        if (DRY_RUN) {
          console.log(`  👦 [DRY] Student: ${studentName} → ${row.name}`);
        } else {
          try {
            await prisma.student.create({
              data: {
                id: generateId(),
                customerId,
                name: studentName,
              },
            });
          } catch (err: any) {
            errors.push(`Failed student ${studentName} for ${row.name}: ${err.message}`);
            studentsSkipped++;
            continue;
          }
        }
        studentsCreated++;
        existingNames.add(studentName.toLowerCase());
        studentCache.set(customerId, existingNames);
      }
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Total rows in CSV:              ${allRows.length}`);
  console.log(`After filtering internals:      ${rows.length}`);
  console.log(`Customers created:              ${customersCreated}`);
  console.log(`Customers already exist:        ${customersFound}`);
  console.log(`Students created:               ${studentsCreated}`);
  console.log(`Students already exist/skipped: ${studentsSkipped}`);
  console.log(`Rows skipped (errors):          ${rowsSkipped}`);
  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length}):`);
    errors.slice(0, 20).forEach(e => console.log(`  ❌ ${e}`));
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
