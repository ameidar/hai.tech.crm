/**
 * Fireberry (Powerlink) Customer Import
 * Imports customers, students, and registrations from לקוחות-מאוחד.csv into HaiTech CRM.
 *
 * Logic:
 *   - For each row: find existing customer by phone OR email
 *   - If not found → create new customer
 *   - If student name exists → create student under that customer (if not duplicate)
 *   - If cycle name matches a CRM cycle → create registration (student → cycle)
 *   - Skips internal emails: ami@hai.tech, inna@hai.tech, etc.
 *
 * Run (DRY RUN):
 *   DRY_RUN=1 npx ts-node -r dotenv/config src/scripts/fireberry-import.ts
 * Run (REAL):
 *   npx ts-node -r dotenv/config src/scripts/fireberry-import.ts
 */
import { PrismaClient, RegistrationStatus, PaymentMethod } from '@prisma/client';
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
  regStatus: string;
  regDate: string;
  amount: string;
  paymentMethod: string;
}

function normalizePhone(raw: string): string {
  if (!raw || raw.trim() === '-') return '';
  const digits = raw.replace(/\D/g, '');
  if (!digits || digits.length < 9) return '';
  if (digits.startsWith('972') && digits.length === 12) return '0' + digits.slice(3);
  if (digits.startsWith('0') && digits.length >= 9 && digits.length <= 11) return digits;
  if (digits.length >= 9) return digits;
  return '';
}

function normalizeEmail(raw: string): string {
  if (!raw || raw.trim() === '-') return '';
  const email = raw.trim().toLowerCase();
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

function mapRegistrationStatus(raw: string): RegistrationStatus {
  const s = raw.trim();
  if (s === 'סיים' || s === 'Completed') return RegistrationStatus.completed;
  if (s === 'ביטל' || s === 'ביטל אחרי נסיון' || s === 'מחכה לביטול') return RegistrationStatus.cancelled;
  if (s === 'נרשם' || s === 'נרשם חיצוני' || s === 'נרשם לקורס דיגיטלי') return RegistrationStatus.registered;
  return RegistrationStatus.registered; // default
}

function mapPaymentMethod(raw: string): PaymentMethod | null {
  const s = raw.trim();
  if (s === 'אשראי' || s === 'צ׳קים' || s === 'הוראת קבע' || s === 'ביט') return PaymentMethod.credit;
  if (s === 'העברה בנקאית') return PaymentMethod.transfer;
  if (s === 'מזומן') return PaymentMethod.cash;
  return null;
}

function parseAmount(raw: string): number | null {
  if (!raw || raw.trim() === '-' || raw.trim() === '') return null;
  const n = parseFloat(raw.replace(/[^\d.]/g, ''));
  return isNaN(n) ? null : n;
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
          regStatus: (row['סטטוס הרשמה'] || '').trim(),
          regDate: (row['תאריך הרשמה'] || '').trim(),
          amount: (row['סכום ששולם'] || '').trim(),
          paymentMethod: (row['אמצעי תשלום'] || '').trim(),
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
  let registrationsCreated = 0;
  let registrationsSkipped = 0;
  let rowsSkipped = 0;
  const errors: string[] = [];

  // ── Load CRM cycles into name → id map ──────────────────────────────────
  console.log('Loading CRM cycles...');
  const crmCycles = await prisma.cycle.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
  });
  const cycleNameToId = new Map<string, string>();
  for (const c of crmCycles) {
    cycleNameToId.set(c.name.trim(), c.id);
  }
  console.log(`  CRM cycles loaded: ${crmCycles.length}`);

  // In-memory caches
  const phoneCache = new Map<string, string>();   // phone → customerId
  const emailCache = new Map<string, string>();   // email → customerId
  const studentCache = new Map<string, Set<string>>();    // customerId → Set<studentName lower>
  const studentIdCache = new Map<string, string>(); // `${customerId}:${studentName}` → studentId
  const regCache = new Set<string>();             // `${studentId}:${cycleId}` → already registered

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
    select: { id: true, customerId: true, name: true },
  });
  for (const s of existingStudents) {
    if (!studentCache.has(s.customerId)) studentCache.set(s.customerId, new Set());
    studentCache.get(s.customerId)!.add(s.name.trim().toLowerCase());
    studentIdCache.set(`${s.customerId}:${s.name.trim().toLowerCase()}`, s.id);
  }

  // Pre-load existing registrations
  const existingRegs = await prisma.registration.findMany({
    where: { deletedAt: null },
    select: { studentId: true, cycleId: true },
  });
  for (const r of existingRegs) {
    regCache.add(`${r.studentId}:${r.cycleId}`);
  }

  console.log(`  Existing customers: ${existingCustomers.length}`);
  console.log(`  Existing students: ${existingStudents.length}`);
  console.log(`  Existing registrations: ${existingRegs.length}`);
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
              phone: row.phone || `NOTEL-${generateId()}`,
              email: row.email || null,
              notes: `Fireberry: ${row.accountid}`,
            },
          });
          customerId = newCustomer.id;
        } catch (err: any) {
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
    let studentId: string | null = null;
    const studentName = row.studentName;

    if (studentName && studentName !== '-') {
      const key = `${customerId}:${studentName.toLowerCase()}`;
      const existingNames = studentCache.get(customerId) || new Set();

      if (existingNames.has(studentName.toLowerCase())) {
        studentsSkipped++;
        studentId = studentIdCache.get(key) || null;
      } else {
        if (DRY_RUN) {
          studentId = `dry_student_${generateId()}`;
          console.log(`  👦 [DRY] Student: ${studentName} → ${row.name}`);
        } else {
          try {
            const newStudent = await prisma.student.create({
              data: {
                id: generateId(),
                customerId,
                name: studentName,
              },
            });
            studentId = newStudent.id;
          } catch (err: any) {
            errors.push(`Failed student ${studentName} for ${row.name}: ${err.message}`);
            studentsSkipped++;
            // Try to get existing
            const existingStudent = await prisma.student.findFirst({
              where: { customerId, name: studentName, deletedAt: null },
            });
            if (existingStudent) studentId = existingStudent.id;
            // continue without incrementing, go to registration attempt
          }
        }
        if (studentId) {
          studentsCreated++;
          existingNames.add(studentName.toLowerCase());
          studentCache.set(customerId, existingNames);
          studentIdCache.set(key, studentId);
        }
      }
    }

    // Handle registration (only if we have a student + matching cycle)
    if (studentId && row.cycleName) {
      const cycleId = cycleNameToId.get(row.cycleName);
      if (cycleId) {
        const regKey = `${studentId}:${cycleId}`;
        if (regCache.has(regKey)) {
          registrationsSkipped++;
        } else {
          const status = mapRegistrationStatus(row.regStatus);
          const paymentMethod = mapPaymentMethod(row.paymentMethod);
          const amount = parseAmount(row.amount);
          // Parse DD/MM/YYYY format
          let regDate = new Date();
          if (row.regDate) {
            const parts = row.regDate.split('/');
            if (parts.length === 3) {
              const d = parseInt(parts[0], 10);
              const m = parseInt(parts[1], 10) - 1;
              const y = parseInt(parts[2], 10);
              const parsed = new Date(y, m, d);
              if (!isNaN(parsed.getTime())) regDate = parsed;
            }
          }

          if (DRY_RUN) {
            const studentLabel = studentName || '?';
            console.log(`    📋 [DRY] Registration: ${studentLabel} → ${row.cycleName} [${status}] ₪${amount ?? 0}`);
          } else {
            try {
              await prisma.registration.create({
                data: {
                  id: generateId(),
                  studentId,
                  cycleId,
                  registrationDate: regDate,
                  status,
                  amount: amount ? amount : undefined,
                  paymentMethod: paymentMethod || undefined,
                  notes: `Imported from Fireberry`,
                },
              });
              registrationsCreated++;
              regCache.add(regKey);
            } catch (err: any) {
              errors.push(`Failed registration ${studentName} → ${row.cycleName}: ${err.message}`);
              registrationsSkipped++;
            }
          }
          if (DRY_RUN) {
            registrationsCreated++;
            regCache.add(regKey);
          }
        }
      }
      // If no cycle match — silently skip (most historical cycles won't match)
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Total rows in CSV:              ${allRows.length}`);
  console.log(`After filtering internals:      ${rows.length}`);
  console.log(`Customers created:              ${customersCreated}`);
  console.log(`Customers already exist:        ${customersFound}`);
  console.log(`Students created:               ${studentsCreated}`);
  console.log(`Students already exist/skipped: ${studentsSkipped}`);
  console.log(`Registrations created:          ${registrationsCreated}`);
  console.log(`Registrations already exist:    ${registrationsSkipped}`);
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
