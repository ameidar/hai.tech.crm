/**
 * Import operations tasks from the legacy Base44 CSV export.
 *
 * Usage:
 *   npx tsx src/scripts/import-tasks.ts <path-to-csv> --dry-run
 *   npx tsx src/scripts/import-tasks.ts <path-to-csv>
 */

import fs from 'fs';
import path from 'path';
import { PrismaClient, TaskPriority, TaskStatus, User } from '@prisma/client';

const prisma = new PrismaClient();

type CsvRow = Record<string, string>;
type UserPick = Pick<User, 'id' | 'email' | 'name' | 'isActive'>;

const statusMap: Record<string, TaskStatus> = {
  New: 'new',
  'In Progress': 'in_progress',
  'Waiting on Info': 'waiting_info',
  Done: 'completed',
};

const priorityMap: Record<string, TaskPriority> = {
  נמוכה: 'low',
  רגילה: 'normal',
  גבוהה: 'high',
  דחופה: 'urgent',
};

function parseCsv(content: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const next = content[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((value) => value.trim() !== '')) rows.push(row);

  const [headers, ...dataRows] = rows;
  if (!headers) return [];

  return dataRows.map((values) => {
    const record: CsvRow = {};
    headers.forEach((header, index) => {
      record[header] = values[index] ?? '';
    });
    return record;
  });
}

function parseDate(value?: string | null): Date | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const normalized = /^\d{4}-\d{2}-\d{2}T/.test(trimmed) ? trimmed : trimmed.replace(' ', 'T');
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseJsonArray(value?: string): unknown[] {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === '[]') return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function userKey(email?: string | null) {
  return email?.trim().toLowerCase() || '';
}

function findUser(usersByEmail: Map<string, UserPick>, email?: string | null) {
  return usersByEmail.get(userKey(email)) ?? null;
}

function formatNotes(label: string, items: unknown[]) {
  if (items.length === 0) return '';

  const lines = items.map((item) => {
    if (!item || typeof item !== 'object') return `- ${String(item)}`;
    const record = item as Record<string, unknown>;
    const author = typeof record.author === 'string' ? record.author : record.user;
    const text = typeof record.text === 'string' ? record.text : record.note;
    const status = typeof record.status === 'string' ? ` (${record.status})` : '';
    const timestamp = typeof record.timestamp === 'string' ? ` - ${record.timestamp}` : '';
    return `- ${author || 'unknown'}${status}${timestamp}: ${text || ''}`;
  });

  return [``, `${label}:`, ...lines].join('\n');
}

function buildDescription(row: CsvRow) {
  const parts = [
    row.description?.trim(),
    row.change_type?.trim() ? `סוג שינוי: ${row.change_type.trim()}` : '',
    formatNotes('הערות פנימיות מהמערכת הישנה', parseJsonArray(row.internal_notes)),
    formatNotes('היסטוריית סטטוסים מהמערכת הישנה', parseJsonArray(row.status_history)),
  ].filter(Boolean);

  return parts.join('\n\n') || null;
}

async function main() {
  const csvPath = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');

  if (!csvPath) {
    console.error('Usage: npx tsx src/scripts/import-tasks.ts <path-to-csv> [--dry-run]');
    process.exit(1);
  }

  const absolutePath = path.resolve(csvPath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`File not found: ${absolutePath}`);
    process.exit(1);
  }

  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, isActive: true },
  });
  const usersByEmail = new Map(users.map((user) => [user.email.toLowerCase(), user]));
  const fallbackCreator =
    findUser(usersByEmail, 'ami.meidar@gmail.com') ||
    findUser(usersByEmail, 'arielmeidar23@gmail.com') ||
    users.find((user) => user.isActive) ||
    users[0];

  if (!fallbackCreator) {
    throw new Error('No users found. Cannot import tasks without a creator fallback.');
  }

  const content = fs.readFileSync(absolutePath, 'utf8');
  const rows = parseCsv(content);

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const missingUsers = new Set<string>();

  for (const row of rows) {
    const id = row.id?.trim();
    const title = row.title?.trim();
    if (!id || !title) {
      skipped++;
      continue;
    }

    const creator = findUser(usersByEmail, row.created_by) || findUser(usersByEmail, row.requester) || fallbackCreator;
    const assignee = findUser(usersByEmail, row.assignee);
    const completedBy = row.status === 'Done' ? assignee : null;

    for (const email of [row.created_by, row.requester, row.assignee].filter(Boolean)) {
      if (!findUser(usersByEmail, email)) missingUsers.add(email.trim().toLowerCase());
    }

    const status = statusMap[row.status?.trim()] || 'new';
    const priority = priorityMap[row.priority?.trim()] || 'normal';
    const completedAt = status === 'completed' ? parseDate(row.actual_end_time) || parseDate(row.updated_date) : null;
    const createdAt = parseDate(row.created_date) || new Date();
    const updatedAt = parseDate(row.updated_date) || createdAt;

    if (dryRun) {
      const existing = await prisma.task.findUnique({ where: { id }, select: { id: true } });
      if (existing) updated++;
      else created++;
      continue;
    }

    const existing = await prisma.task.findUnique({ where: { id }, select: { id: true } });

    await prisma.task.upsert({
      where: { id },
      create: {
        id,
        title,
        description: buildDescription(row),
        status,
        priority,
        dueDate: parseDate(row.deadline),
        createdById: creator.id,
        assigneeId: assignee?.id ?? null,
        completedAt,
        completedById: completedBy?.id ?? null,
        createdAt,
        updatedAt,
      },
      update: {
        title,
        description: buildDescription(row),
        status,
        priority,
        dueDate: parseDate(row.deadline),
        createdById: creator.id,
        assigneeId: assignee?.id ?? null,
        completedAt,
        completedById: completedBy?.id ?? null,
        createdAt,
        updatedAt,
        deletedAt: null,
      },
    });

    if (existing) updated++;
    else created++;
  }

  console.log(`${dryRun ? 'Dry run' : 'Import'} complete`);
  console.log(`Rows parsed: ${rows.length}`);
  console.log(`Created: ${created}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  if (missingUsers.size > 0) {
    console.log(`Missing users (${missingUsers.size}): ${Array.from(missingUsers).sort().join(', ')}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
