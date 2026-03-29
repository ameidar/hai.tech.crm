/**
 * Import Historical Meetings from Fireberry CSV
 *
 * Rules:
 * - Only import meetings for cycles with status: completed, cancelled (NOT active)
 * - Match cycle by name
 * - Match instructor by name (use placeholder if not found)
 * - Skip meetings that already exist for the same cycle+date+time
 *
 * Run: cd backend && npx ts-node src/scripts/import-meetings.ts [--dry-run]
 */

import fs from 'fs';
import * as csv from '@fast-csv/parse';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

const CSV_PATH = '/home/ameidar/.openclaw/media/inbound/f919c890-8b62-4d45-a22f-28a84c2bcfff.csv';

// Parse "DD/MM/YYYY HH:MM" → { date: Date, time: string }
function parseDateTime(s: string): { date: Date; startTime: string } | null {
  if (!s?.trim() || s.trim() === '-') return null;
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [, d, mo, y, h, min] = m;
  const date = new Date(`${y}-${mo}-${d}`);
  if (isNaN(date.getTime())) return null;
  const startTime = `${h.padStart(2, '0')}:${min}`;
  return { date, startTime };
}

// Map Fireberry status → MeetingStatus enum
function mapStatus(s: string): string {
  const map: Record<string, string> = {
    'התקיימה': 'completed',
    'בוטלה': 'cancelled',
    'נדחתה': 'postponed',
    'לא בשימוש': 'cancelled',
    '-': 'completed',
    '': 'completed',
  };
  return map[s?.trim()] || 'completed';
}

async function main() {
  console.log(`📅 Import Historical Meetings${DRY_RUN ? ' [DRY RUN]' : ''}`);

  // ── Load non-active cycles ───────────────────────────────────────────────────
  const [nonActiveCycles, instructors, existingMeetings] = await Promise.all([
    prisma.cycle.findMany({
      where: { status: { in: ['completed', 'cancelled'] } },
      select: { id: true, name: true, instructorId: true },
    }),
    prisma.instructor.findMany({ select: { id: true, name: true } }),
    prisma.meeting.findMany({
      select: { cycleId: true, scheduledDate: true, startTime: true }
    }),
  ]);

  console.log(`📊 Non-active cycles: ${nonActiveCycles.length} | Instructors: ${instructors.length} | Existing meetings: ${existingMeetings.length}`);

  // ── Build lookup maps ────────────────────────────────────────────────────────
  const cycleByName = new Map<string, { id: string; instructorId: string }>();
  for (const c of nonActiveCycles) {
    cycleByName.set(c.name.trim(), { id: c.id, instructorId: c.instructorId });
  }

  const instructorByName = new Map<string, string>();
  for (const i of instructors) {
    instructorByName.set(i.name.trim(), i.id);
  }

  // Existing meetings dedup key: cycleId:YYYY-MM-DD:HH:MM
  const meetingSet = new Set<string>();
  for (const m of existingMeetings) {
    const dateStr = (m.scheduledDate as Date).toISOString().slice(0, 10);
    const timeStr = (m.startTime as Date).toISOString().slice(11, 16);
    meetingSet.add(`${m.cycleId}:${dateStr}:${timeStr}`);
  }

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

  // ── Import ───────────────────────────────────────────────────────────────────
  let created = 0, skippedActiveCycle = 0, skippedDuplicate = 0, skippedNoDate = 0, errors = 0;

  const BATCH_SIZE = 200;
  const toInsert: any[] = [];

  for (const r of rows) {
    const cycleName = r['שייך למחזור']?.trim() || '';
    const cycle = cycleByName.get(cycleName);
    if (!cycle) {
      skippedActiveCycle++; // cycle not found or is active
      continue;
    }

    const startParsed = parseDateTime(r['תאריך התחלה'] || '');
    if (!startParsed) {
      skippedNoDate++;
      continue;
    }

    const endParsed = parseDateTime(r['תאריך סיום'] || '');
    const endTime = endParsed?.startTime || addHour(startParsed.startTime);

    // Dedup check
    const dateStr = startParsed.date.toISOString().slice(0, 10);
    const dedupKey = `${cycle.id}:${dateStr}:${startParsed.startTime}`;
    if (meetingSet.has(dedupKey)) {
      skippedDuplicate++;
      continue;
    }
    meetingSet.add(dedupKey);

    // Instructor
    const instrName = r['שם המדריך']?.trim() || '';
    const instructorId = instructorByName.get(instrName) || cycle.instructorId;

    const status = mapStatus(r['סטטוס'] || '');
    const topic = r['נושא']?.trim() && r['נושא'].trim() !== '-' ? r['נושא'].trim() : null;
    const notes = buildNotes(r);

    toInsert.push({
      id: randomUUID(),
      cycleId: cycle.id,
      instructorId,
      scheduledDate: startParsed.date,
      startTime: startParsed.startTime,
      endTime,
      status,
      topic,
      notes,
    });
  }

  console.log(`🎯 To insert: ${toInsert.length} | Active/unfound cycles: ${skippedActiveCycle} | Duplicates: ${skippedDuplicate} | No date: ${skippedNoDate}`);

  if (!DRY_RUN) {
    // Batch insert
    for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
      const batch = toInsert.slice(i, i + BATCH_SIZE);
      for (const m of batch) {
        try {
          await prisma.$executeRawUnsafe(`
            INSERT INTO meetings (
              id, cycle_id, instructor_id, scheduled_date,
              start_time, end_time, status, topic, notes,
              revenue, instructor_payment, profit,
              created_at, updated_at
            ) VALUES (
              $1, $2, $3, $4,
              $5::time, $6::time, $7::"MeetingStatus", $8, $9,
              0, 0, 0,
              NOW(), NOW()
            )`,
            m.id, m.cycleId, m.instructorId, m.scheduledDate,
            m.startTime, m.endTime, m.status, m.topic, m.notes
          );
          created++;
        } catch (e: any) {
          errors++;
          if (errors <= 5) console.error(`  ❌ ${e.message?.slice(0, 120)}`);
        }
      }
      if ((i / BATCH_SIZE) % 10 === 0) process.stdout.write(`  ${created}...`);
    }
  } else {
    created = toInsert.length;
  }

  console.log(`\n\n✅ Done!`);
  console.log(`  Created:             ${created} meetings`);
  console.log(`  Skipped (active):    ${skippedActiveCycle}`);
  console.log(`  Skipped (duplicate): ${skippedDuplicate}`);
  console.log(`  Skipped (no date):   ${skippedNoDate}`);
  console.log(`  Errors:              ${errors}`);
  if (DRY_RUN) console.log('\n⚠️  DRY RUN — nothing written');

  await prisma.$disconnect();
}

function addHour(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const nh = (h + 1) % 24;
  return `${String(nh).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function buildNotes(r: any): string | null {
  const parts: string[] = [];
  const detail = r['פירוט מהלך השיעור במלואו']?.trim();
  const concepts = r['מושגים שנלמדו השיעור']?.trim();
  if (detail && detail !== '-') parts.push(detail);
  if (concepts && concepts !== '-') parts.push(`מושגים: ${concepts}`);
  return parts.length > 0 ? parts.join('\n') : null;
}

main().catch(async e => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
