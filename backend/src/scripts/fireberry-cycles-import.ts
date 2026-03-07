/**
 * Fireberry Cycles Import Script
 * Imports historical (non-active) cycles from Fireberry CSV into HaiTech CRM dev DB.
 *
 * Rules:
 * - Skip cycles where status = 'פעיל' (active)
 * - Skip cycles already existing in CRM (by name OR fireberry_id)
 * - Import all others as completed/cancelled
 *
 * Run: cd backend && npx ts-node src/scripts/fireberry-cycles-import.ts [--dry-run]
 */

import fs from 'fs';
import * as csv from '@fast-csv/parse';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

const CSV_PATH = '/home/ameidar/.openclaw/media/inbound/23b53379-0531-4f6c-92a8-c5c51e9ec610.csv';

// Hebrew day → DB enum
const DAY_MAP: Record<string, string> = {
  'ראשון': 'sunday',
  'שני': 'monday',
  'שלישי': 'tuesday',
  'רביעי': 'wednesday',
  'חמישי': 'thursday',
  'שישי': 'friday',
  'שבת': 'saturday',
};

// FB status → CRM status
const STATUS_MAP: Record<string, string> = {
  'הסתיים': 'completed',
  'בוטל': 'cancelled',
  'נדחה': 'cancelled',
  'מוקפא עד להודעה חדשה': 'cancelled',
  'פתוח להרשמה': 'cancelled',
  'יצירת לינק לזום': 'cancelled',
  'מחיקת זום (לוודא שיש לינק)': 'cancelled',
  'צור service': 'cancelled',
  '': 'cancelled',
};

// FB institutional type → CycleType
const CYCLE_TYPE_MAP: Record<string, string> = {
  'מוסדי': 'institutional_fixed',
  'מוסדי (תשלום פר ילד)': 'institutional_per_child',
  'פרטי': 'private',
  'סדנה/כנס': 'institutional_fixed',
  '': 'institutional_fixed',
};

// FB activity type → activity_type
const ACTIVITY_TYPE_MAP: Record<string, string> = {
  'אונליין פרטי': 'online',
  'אונליין קבוצתי': 'online',
  'אונליין בתי ספר (גפ"ן)': 'online',
  'אונליין עמותה': 'online',
  'פרונטלי כללי': 'frontal',
  'פרונטלי בתי ספר (גפ״ן)': 'frontal',
  'פרונטלי בתי ספר': 'frontal',
  'סדנה/כנס': 'frontal',
  '': 'frontal',
};

// Course name → category (best guess)
function courseCategory(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('ai') || n.includes('בינה') || n.includes('רובוטיקה')) return 'ai';
  if (n.includes('רובוט')) return 'robotics';
  if (n.includes('3d') || n.includes('תלת')) return '3d_printing';
  return 'programming';
}

function parseDate(s: string): Date | null {
  if (!s?.trim()) return null;
  const d = new Date(s.trim());
  return isNaN(d.getTime()) ? null : d;
}

function parseTimeAsDate(s: string): Date {
  const m = s?.trim().match(/^(\d{1,2}):(\d{2})$/);
  const h = m ? parseInt(m[1]) : 9;
  const min = m ? parseInt(m[2]) : 0;
  return new Date(Date.UTC(1970, 0, 1, h, min, 0));
}

function addMinsToDate(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60 * 1000);
}

async function main() {
  console.log(`🚀 Fireberry Cycles Import${DRY_RUN ? ' [DRY RUN]' : ''}`);

  // ── Load existing ────────────────────────────────────────────────────────────
  const [existingCycles, existingCourses, existingBranches, existingInstructors] = await Promise.all([
    prisma.cycle.findMany({ select: { name: true, fireberryId: true } }),
    prisma.course.findMany({ select: { id: true, name: true } }),
    prisma.branch.findMany({ select: { id: true, name: true } }),
    prisma.instructor.findMany({ select: { id: true, name: true } }),
  ]);

  const existingNames = new Set(existingCycles.map(c => c.name.trim()));
  const existingFbIds = new Set(
    existingCycles.filter(c => c.fireberryId).map(c => c.fireberryId!.toUpperCase())
  );
  const courseMap = new Map(existingCourses.map(c => [c.name.trim(), c.id]));
  const branchMap = new Map(existingBranches.map(b => [b.name.trim(), b.id]));
  const instructorMap = new Map(existingInstructors.map(i => [i.name.trim(), i.id]));

  console.log(`📊 Existing: ${existingCycles.length} cycles | ${existingCourses.length} courses | ${existingBranches.length} branches | ${existingInstructors.length} instructors`);

  // ── Ensure placeholder branch & instructor ───────────────────────────────────
  const HIST_BRANCH = 'מחזורים היסטוריים';
  const HIST_INSTRUCTOR = 'מדריך היסטורי';

  if (!branchMap.has(HIST_BRANCH)) {
    const id = randomUUID();
    if (!DRY_RUN) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO branches (id, name, type, city, created_at, updated_at)
         VALUES ($1, $2, 'frontal'::"BranchType", 'לא ידוע', NOW(), NOW())`,
        id, HIST_BRANCH
      );
    }
    branchMap.set(HIST_BRANCH, id);
    console.log(`  ✅ Created branch: ${HIST_BRANCH}`);
  }

  if (!instructorMap.has(HIST_INSTRUCTOR)) {
    const id = randomUUID();
    if (!DRY_RUN) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO instructors (id, name, phone, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())`,
        id, HIST_INSTRUCTOR, `NOTEL-${id.slice(0, 8)}`
      );
    }
    instructorMap.set(HIST_INSTRUCTOR, id);
    console.log(`  ✅ Created instructor: ${HIST_INSTRUCTOR}`);
  }

  const histBranchId = branchMap.get(HIST_BRANCH)!;
  const histInstructorId = instructorMap.get(HIST_INSTRUCTOR)!;

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

  // ── Filter ───────────────────────────────────────────────────────────────────
  const toImport = rows.filter(r => {
    const status = r['pcfsystemfield37name']?.trim() || '';
    if (status === 'פעיל') return false;
    const name = r['name']?.trim() || '';
    if (!name) return false;
    const fbId = r['customobject1000id']?.trim().toUpperCase();
    if (fbId && existingFbIds.has(fbId)) return false;
    if (existingNames.has(name)) return false;
    return true;
  });

  console.log(`🎯 To import: ${toImport.length} | Skipping: ${rows.length - toImport.length}`);
  if (DRY_RUN) {
    console.log('\n⚠️  DRY RUN — nothing written to DB');
    await prisma.$disconnect();
    return;
  }

  // ── Import ───────────────────────────────────────────────────────────────────
  let imported = 0, errors = 0;
  const newCourseNames: Set<string> = new Set();
  const newInstructorNames: Set<string> = new Set();
  const newBranchNames: Set<string> = new Set();

  for (const r of toImport) {
    try {
      const name = r['name']?.trim() || '';
      const fbStatus = r['pcfsystemfield37name']?.trim() || '';
      const status = (STATUS_MAP[fbStatus] || 'cancelled') as any;

      // ── Course ──────────────────────────────────────────────────────────────
      const courseName = (r['pcfsystemfield28name']?.trim() || 'קורס כללי');
      if (!courseMap.has(courseName)) {
        const id = randomUUID();
        const cat = courseCategory(courseName) as any;
        await prisma.$executeRawUnsafe(
          `INSERT INTO courses (id, name, category, is_active, created_at, updated_at)
           VALUES ($1, $2, $3::"CourseCategory", true, NOW(), NOW())
           ON CONFLICT DO NOTHING`,
          id, courseName, cat
        );
        courseMap.set(courseName, id);
        newCourseNames.add(courseName);
      }
      const courseId = courseMap.get(courseName)!;

      // ── Instructor ──────────────────────────────────────────────────────────
      const instructorName = r['pcfsystemfield85name']?.trim() || '';
      if (instructorName && !instructorMap.has(instructorName)) {
        const id = randomUUID();
        await prisma.$executeRawUnsafe(
          `INSERT INTO instructors (id, name, phone, created_at, updated_at)
           VALUES ($1, $2, $3, NOW(), NOW())
           ON CONFLICT DO NOTHING`,
          id, instructorName, `NOTEL-${id.slice(0, 8)}`
        );
        instructorMap.set(instructorName, id);
        newInstructorNames.add(instructorName);
      }
      const instructorId = instructorName ? (instructorMap.get(instructorName) || histInstructorId) : histInstructorId;

      // ── Branch ──────────────────────────────────────────────────────────────
      const branchName = r['pcfsystemfield546name']?.trim() || r['pcfsystemfield560name']?.trim() || '';
      if (branchName && !branchMap.has(branchName)) {
        const id = randomUUID();
        await prisma.$executeRawUnsafe(
          `INSERT INTO branches (id, name, type, city, created_at, updated_at)
           VALUES ($1, $2, 'frontal'::"BranchType", 'לא ידוע', NOW(), NOW())
           ON CONFLICT DO NOTHING`,
          id, branchName
        );
        branchMap.set(branchName, id);
        newBranchNames.add(branchName);
      }
      const branchId = branchName ? (branchMap.get(branchName) || histBranchId) : histBranchId;

      // ── Dates & Time ────────────────────────────────────────────────────────
      const startDate = parseDate(r['pcfsystemfield33']) || parseDate(r['createdon']) || new Date('2020-01-01');
      const endDate = parseDate(r['pcfsystemfield35']) || parseDate(r['modifiedon']) || startDate;
      const startTime = parseTimeAsDate(r['pcfsystemfield544']);
      const durationMins = 60;
      const endTime = addMinsToDate(startTime, durationMins);

      // ── Day of week ─────────────────────────────────────────────────────────
      const dayHeb = r['pcfsystemfield268name']?.trim() || '';
      const dayOfWeek = (DAY_MAP[dayHeb] || 'sunday') as any;

      // ── Meetings ────────────────────────────────────────────────────────────
      const totalMeetings = parseInt(r['pcfsystemfield88'] || '0') || 0;
      const completedMeetings = status === 'completed' ? totalMeetings : 0;

      // ── Type & activity ─────────────────────────────────────────────────────
      const typeRaw = r['pcfsystemfield549name']?.trim() || '';
      const cycleType = (CYCLE_TYPE_MAP[typeRaw] || 'institutional_fixed') as any;
      const activityRaw = r['pcfsystemfield536name']?.trim() || '';
      const activityType = (ACTIVITY_TYPE_MAP[activityRaw] || 'frontal') as any;

      // ── Fireberry ID ────────────────────────────────────────────────────────
      const fireberryId = r['customobject1000id']?.trim() || null;

      await prisma.$executeRawUnsafe(`
        INSERT INTO cycles (
          id, name, course_id, branch_id, instructor_id,
          type, status, start_date, end_date,
          day_of_week, start_time, end_time,
          duration_minutes, total_meetings, completed_meetings, remaining_meetings,
          send_parent_reminders, fireberry_id, activity_type,
          created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6::"CycleType", $7::"CycleStatus", $8, $9,
          $10::"DayOfWeek", $11::time, $12::time,
          $13, $14, $15, 0,
          false, $16, $17::activity_type,
          NOW(), NOW()
        )`,
        randomUUID(), name, courseId, branchId, instructorId,
        cycleType, status, startDate, endDate,
        dayOfWeek, startTime.toISOString().slice(11, 16), endTime.toISOString().slice(11, 16),
        durationMins, totalMeetings, completedMeetings,
        fireberryId || null, activityType
      );

      imported++;
      if (imported % 100 === 0) process.stdout.write(`  ${imported}...`);
    } catch (e: any) {
      errors++;
      if (errors <= 10) console.error(`\n  ❌ '${r['name']}': ${e.message?.slice(0, 120)}`);
    }
  }

  console.log(`\n\n✅ Done!`);
  console.log(`  Imported:             ${imported}`);
  console.log(`  Errors:               ${errors}`);
  console.log(`  New courses:          ${newCourseNames.size}`);
  console.log(`  New instructors:      ${newInstructorNames.size}`);
  console.log(`  New branches:         ${newBranchNames.size}`);

  await prisma.$disconnect();
}

main().catch(async e => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
