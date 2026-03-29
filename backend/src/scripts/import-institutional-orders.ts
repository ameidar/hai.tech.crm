/**
 * Import institutional orders from Fireberry CSV export
 * Usage: npx tsx src/scripts/import-institutional-orders.ts <path-to-csv>
 */

import fs from 'fs';
import path from 'path';
import { PrismaClient, OrderStatus } from '@prisma/client';

const prisma = new PrismaClient();

// Map Hebrew Fireberry status → OrderStatus enum
function mapStatus(hebrewStatus: string): OrderStatus {
  const s = hebrewStatus?.trim();
  if (!s || s === '-') return OrderStatus.draft;
  if (['הסתיים'].includes(s)) return OrderStatus.completed;
  if (['לא יצא לפועל', 'לא רלוונטי'].includes(s)) return OrderStatus.cancelled;
  if (['יצירת קשר ראשוני', 'הגשת הצעה', 'פגישת התאמה', 'סיכום וסגירה',
    'הקצאת מדריך', 'תכנון המפגשים', 'אישור והכנה סופית', 'אישור סופי עם מרכז הלמידה',
    'החתמה על ההסכם', 'מעקב וגבייה'].includes(s)) return OrderStatus.active;
  return OrderStatus.draft;
}

// Parse DD/MM/YYYY HH:mm → Date
function parseDate(raw: string): Date | null {
  if (!raw || raw.trim() === '' || raw.trim() === '-') return null;
  const [datePart] = raw.trim().split(' ');
  const [day, month, year] = datePart.split('/');
  if (!day || !month || !year) return null;
  const d = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
}

// Parse amount string like "79650.0000" or ""
function parseAmount(raw: string): number | null {
  const v = raw?.trim();
  if (!v || v === '-') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

// Simple CSV parser (handles quoted fields with commas and escaped quotes)
function parseCSV(content: string): Record<string, string>[] {
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === 0) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? '';
    });
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: npx tsx src/scripts/import-institutional-orders.ts <csv-path>');
    process.exit(1);
  }

  const absolutePath = path.resolve(csvPath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`File not found: ${absolutePath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(absolutePath, 'utf-8');
  const rows = parseCSV(content);
  console.log(`📄 Parsed ${rows.length} rows from CSV`);

  // Load all branches for name matching
  const branches = await prisma.branch.findMany({ select: { id: true, name: true } });
  const branchByName = new Map<string, string>();
  for (const b of branches) {
    branchByName.set(b.name.trim(), b.id);
  }
  console.log(`🏫 Loaded ${branches.length} branches`);

  let created = 0;
  let skipped = 0;
  let noMatch = 0;

  for (const row of rows) {
    const orderName = row['שם ההזמנה']?.trim();
    if (!orderName || orderName === '-') { skipped++; continue; }

    const branchName = row['מקושר לסניף']?.trim();
    let branchId: string | null = null;
    if (branchName && branchName !== '-') {
      branchId = branchByName.get(branchName) ?? null;
      if (!branchId) {
        // Partial match
        const entry = [...branchByName.entries()].find(([k]) =>
          k.includes(branchName) || branchName.includes(k)
        );
        branchId = entry ? entry[1] : null;
        if (!branchId) noMatch++;
      }
    }

    const hebrewStatus = row['סטטוס הזמנה']?.trim();
    const createdAtRaw = row['נוצר בתאריך']?.trim();
    const followUpRaw = row['תאריך פולואפ']?.trim();
    const totalRaw = row['תשלום כולל']?.trim();
    const notesRaw = row['תאור']?.trim();
    const payingBodyRaw = row['גוף משלם (מקושר לסניף)']?.trim();
    const emailRaw = row['מייל (מקושר לסניף)']?.trim();
    const contactNameRaw = row['איש קשר (מקושר לסניף)']?.trim();
    const salespersonRaw = row['מבצע']?.trim();
    const orderTypeRaw = row['סוג ההזמנה']?.trim();
    const createdByRaw = row['נוצר על ידי']?.trim();

    const createdAt = parseDate(createdAtRaw);
    const followUpDate = parseDate(followUpRaw);
    const totalAmount = parseAmount(totalRaw);

    try {
      await prisma.institutionalOrder.create({
        data: {
          orderName,
          branchId: branchId || undefined,
          contactName: (contactNameRaw && contactNameRaw !== '-') ? contactNameRaw : null,
          contactEmail: (emailRaw && emailRaw !== '-') ? emailRaw : null,
          payingBody: (payingBodyRaw && payingBodyRaw !== '-') ? payingBodyRaw : null,
          followUpDate,
          salesperson: (salespersonRaw && salespersonRaw !== '-') ? salespersonRaw : null,
          orderType: (orderTypeRaw && orderTypeRaw !== '-') ? orderTypeRaw : null,
          createdBy: (createdByRaw && createdByRaw !== '-') ? createdByRaw : null,
          fireberryStatus: (hebrewStatus && hebrewStatus !== '-') ? hebrewStatus : null,
          status: mapStatus(hebrewStatus || ''),
          notes: (notesRaw && notesRaw !== '-') ? notesRaw : null,
          totalAmount: totalAmount !== null ? totalAmount : undefined,
          createdAt: createdAt || undefined,
        },
      });
      created++;
    } catch (err: any) {
      console.error(`❌ Failed to insert "${orderName}": ${err.message}`);
    }
  }

  console.log(`\n✅ Import complete:`);
  console.log(`   Created: ${created}`);
  console.log(`   Skipped (empty name): ${skipped}`);
  console.log(`   No branch match: ${noMatch}`);
  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
