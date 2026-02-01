#!/usr/bin/env node

/**
 * Import missing cycles directly via Prisma (bypassing API rate limits)
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

// Missing cycle names from the comparison
const MISSING_CYCLE_NAMES = [
  "אורט -  סייבר 8:30",
  "אלומות- ימי א' קבוצה 1",
  "אלומות- ימי א' קבוצה 2",
  "אלומות- ימי א' קבוצה 3",
  "אלומות- ימי א' קבוצה 4",
  "אלומות- ימי א' קבוצה 5",
  "אלומות- ימי ב' קבוצה 1",
  "אלומות- ימי ב' קבוצה 2",
  "בית יהדות איראן- קבוצה 1 ימי ה'",
  "זום חד פעמי נועה ושי- לי- עם הדר",
  "כלניות- קבוצה 1 ימי ג'",
  "כלניות- קבוצה 2 ימי ג'",
  "ניצנים יום א'- קבוצה 1",
  "ניצנים יום א'- קבוצה 2",
  "ניצנים יום א'- קבוצה 3",
  "ניצנים יום א'- קבוצה 4",
  "ניצנים יום ד'- קבוצה 1",
  "ניצנים יום ד'- קבוצה 2",
  "ניצנים יום ד'- קבוצה 3",
  "ניצנים יום ד'- קבוצה 4",
  "עמל רמות באר שבע סדנת AI להנהלה",
  "פגישות ללא הכנסה",
  "פלח 5- ai פיתוח משחקים",
  "פלח 5- מיינקראפט",
  "רימון רעננה- כיתה ז'",
  "רימון רעננה- כיתה ח'",
  "רימון רעננה- כיתה ט'",
  "רמות ספורטיב ימי ד- vibeCodding",
  "רמות ספורטיב קבוצה 1- ימי א'",
  "רמות ספורטיב קבוצה 2- ימי א'",
  "רמת נגב ימי ד' קבוצה 1",
  "רמת נגב ימי ד' קבוצה 2",
  "שיעורים פרטיים איתן בלנקי - רומן 055-6619780",
  "שיעורים פרטיים לאלונה וליה- עידן בראון",
  "שיעורים פרטיים לליאם- לוסי 0524313002",
  "שיעורים פרטיים לנער חי- 0505450035",
  "שיעורים פרטיים לעומרי- דרור 0526069144",
  "שיעורים פרטיים לעילאי- אסנת 0548147141"
];

// Day mapping from Hebrew to English
const DAY_MAP = {
  'ראשון': 'sunday',
  'שני': 'monday',
  'שלישי': 'tuesday',
  'רביעי': 'wednesday',
  'חמישי': 'thursday',
  'שישי': 'friday',
  'שבת': 'saturday'
};

// Cache for lookups
let instructorsCache = {};
let coursesCache = {};
let branchesCache = {};

async function loadCaches() {
  console.log('Loading reference data from database...');
  
  const instructors = await prisma.instructor.findMany();
  for (const i of instructors) {
    instructorsCache[i.name] = i.id;
  }
  console.log(`  ✓ Loaded ${Object.keys(instructorsCache).length} instructors`);
  
  const courses = await prisma.course.findMany();
  for (const c of courses) {
    coursesCache[c.name] = c.id;
  }
  console.log(`  ✓ Loaded ${Object.keys(coursesCache).length} courses`);
  
  const branches = await prisma.branch.findMany();
  for (const b of branches) {
    branchesCache[b.name] = b.id;
  }
  console.log(`  ✓ Loaded ${Object.keys(branchesCache).length} branches`);
}

async function getOrCreateInstructor(name) {
  if (instructorsCache[name]) return instructorsCache[name];
  
  console.log(`    Creating instructor: ${name}`);
  const result = await prisma.instructor.create({
    data: {
      name,
      email: `${name.replace(/\s+/g, '.').toLowerCase()}@temp.co.il`,
      phone: '0500000000',
      status: 'active'
    }
  });
  instructorsCache[name] = result.id;
  return result.id;
}

async function getOrCreateCourse(name) {
  if (coursesCache[name]) return coursesCache[name];
  
  console.log(`    Creating course: ${name}`);
  const result = await prisma.course.create({
    data: {
      name,
      description: `Course: ${name}`,
      defaultDuration: 75,
      status: 'active'
    }
  });
  coursesCache[name] = result.id;
  return result.id;
}

async function getOrCreateBranch(name) {
  if (!name) return null;
  if (branchesCache[name]) return branchesCache[name];
  
  console.log(`    Creating branch: ${name}`);
  const result = await prisma.branch.create({
    data: {
      name,
      address: 'TBD'
    }
  });
  branchesCache[name] = result.id;
  return result.id;
}

function calculateEndTime(startTime, duration) {
  if (!startTime) return null;
  const [hours, minutes] = startTime.split(':').map(Number);
  const totalMinutes = hours * 60 + minutes + (duration || 75);
  const endHours = Math.floor(totalMinutes / 60) % 24;
  const endMins = totalMinutes % 60;
  return `${String(endHours).padStart(2, '0')}:${String(endMins).padStart(2, '0')}`;
}

async function importCycle(fireberryCycle) {
  const name = fireberryCycle.name;
  console.log(`\nImporting: ${name}`);
  
  // Check if already exists
  const existing = await prisma.cycle.findFirst({ where: { name } });
  if (existing) {
    console.log(`  → Already exists, skipping`);
    return { skipped: true };
  }
  
  // Look up or create related entities
  const instructorId = await getOrCreateInstructor(fireberryCycle.instructorName);
  const courseId = await getOrCreateCourse(fireberryCycle.courseName);
  const branchId = await getOrCreateBranch(fireberryCycle.customerName);
  
  if (!instructorId || !courseId) {
    console.log(`  ✗ Skipping - missing required references`);
    return null;
  }
  
  // Determine type
  const pricingType = fireberryCycle.pricingType || '';
  const typeName = fireberryCycle.typeName || '';
  let type = 'institutional_fixed';
  if (pricingType.includes('פרטי') || typeName.includes('פרטי')) {
    type = 'private';
  }
  
  // Determine if online
  const isOnline = typeName.includes('אונליין') || (!!fireberryCycle.zoomLink && !fireberryCycle.zoomLink.includes('לא ניתן'));
  
  // Map day
  const dayOfWeek = fireberryCycle.day ? DAY_MAP[fireberryCycle.day] : null;
  
  // Calculate times
  const startTime = fireberryCycle.time;
  const endTime = calculateEndTime(startTime, fireberryCycle.duration);
  
  // Build cycle data
  const cycleData = {
    name,
    instructorId,
    courseId,
    branchId: branchId || undefined,
    dayOfWeek: dayOfWeek || undefined,
    startTime: startTime || undefined,
    endTime: endTime || undefined,
    type,
    isOnline,
    startDate: fireberryCycle.startDate ? new Date(fireberryCycle.startDate) : undefined,
    endDate: fireberryCycle.endDate ? new Date(fireberryCycle.endDate) : undefined,
    meetingLink: (fireberryCycle.zoomLink && !fireberryCycle.zoomLink.includes('לא ניתן')) ? fireberryCycle.zoomLink : undefined,
    status: 'active'
  };
  
  try {
    const result = await prisma.cycle.create({ data: cycleData });
    console.log(`  ✓ Created cycle: ${result.id}`);
    return result;
  } catch (e) {
    console.log(`  ✗ Failed: ${e.message}`);
    return null;
  }
}

async function main() {
  console.log('=== Importing Missing Cycles via Prisma ===\n');
  
  try {
    // Load reference data
    await loadCaches();
    
    // Load Fireberry data
    const fireberryPath = path.join(__dirname, 'data', 'fireberry_cycles.json');
    const fireberryData = JSON.parse(fs.readFileSync(fireberryPath, 'utf-8'));
    console.log(`\nLoaded ${fireberryData.length} cycles from Fireberry`);
    
    // Filter to only missing cycles
    const missingCycles = fireberryData.filter(c => MISSING_CYCLE_NAMES.includes(c.name));
    console.log(`Found ${missingCycles.length} cycles to import\n`);
    
    // Import each missing cycle
    let created = 0;
    let skipped = 0;
    let failed = 0;
    
    for (const cycle of missingCycles) {
      const result = await importCycle(cycle);
      if (result?.skipped) {
        skipped++;
      } else if (result) {
        created++;
      } else {
        failed++;
      }
    }
    
    console.log('\n=== Summary ===');
    console.log(`Total cycles to import: ${missingCycles.length}`);
    console.log(`Successfully created: ${created}`);
    console.log(`Already existed (skipped): ${skipped}`);
    console.log(`Failed: ${failed}`);
    
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
