#!/usr/bin/env node

/**
 * Import missing cycles from Fireberry to HaiTech CRM
 * With rate limiting and proper error handling
 */

const fs = require('fs');
const path = require('path');

const API_URL = 'http://localhost:3001/api';
let TOKEN = '';

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

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function login() {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@haitech.co.il', password: 'admin123' })
  });
  const data = await res.json();
  TOKEN = data.accessToken;
  console.log('✓ Logged in successfully');
}

async function apiGet(endpoint, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${API_URL}${endpoint}`, {
        headers: { 'Authorization': `Bearer ${TOKEN}` }
      });
      const data = await res.json();
      if (data.error && data.error.includes('Too many requests')) {
        console.log(`  Rate limited, waiting ${(i + 1) * 1000}ms...`);
        await sleep((i + 1) * 1000);
        continue;
      }
      return data;
    } catch (e) {
      if (i === retries - 1) throw e;
      await sleep(500);
    }
  }
  return { data: [] };
}

async function apiPost(endpoint, body, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TOKEN}` 
        },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (data.error && data.error.includes('Too many requests')) {
        console.log(`  Rate limited, waiting ${(i + 1) * 2000}ms...`);
        await sleep((i + 1) * 2000);
        continue;
      }
      return data;
    } catch (e) {
      if (i === retries - 1) throw e;
      await sleep(500);
    }
  }
  return { error: 'Max retries exceeded' };
}

async function loadCaches() {
  console.log('Loading reference data...');
  
  // Load instructors
  await sleep(100);
  const instructors = await apiGet('/instructors?limit=100');
  for (const i of instructors.data || []) {
    instructorsCache[i.name] = i.id;
  }
  console.log(`  ✓ Loaded ${Object.keys(instructorsCache).length} instructors`);
  
  // Load courses
  await sleep(100);
  const courses = await apiGet('/courses?limit=100');
  for (const c of courses.data || []) {
    coursesCache[c.name] = c.id;
  }
  console.log(`  ✓ Loaded ${Object.keys(coursesCache).length} courses`);
  
  // Load branches
  await sleep(100);
  const branches = await apiGet('/branches?limit=100');
  for (const b of branches.data || []) {
    branchesCache[b.name] = b.id;
  }
  console.log(`  ✓ Loaded ${Object.keys(branchesCache).length} branches`);
}

async function getOrCreateInstructor(name) {
  if (instructorsCache[name]) return instructorsCache[name];
  
  console.log(`    Creating instructor: ${name}`);
  await sleep(200);
  const result = await apiPost('/instructors', { 
    name, 
    email: `${name.replace(/\s+/g, '.').toLowerCase()}@temp.co.il`,
    phone: '0500000000',
    status: 'active'
  });
  if (result.id) {
    instructorsCache[name] = result.id;
    return result.id;
  }
  console.log(`    ⚠ Failed to create instructor: ${JSON.stringify(result)}`);
  return null;
}

async function getOrCreateCourse(name) {
  if (coursesCache[name]) return coursesCache[name];
  
  console.log(`    Creating course: ${name}`);
  await sleep(200);
  const result = await apiPost('/courses', { 
    name,
    description: `Course: ${name}`,
    defaultDuration: 75,
    status: 'active'
  });
  if (result.id) {
    coursesCache[name] = result.id;
    return result.id;
  }
  console.log(`    ⚠ Failed to create course: ${JSON.stringify(result)}`);
  return null;
}

async function getOrCreateBranch(name) {
  if (!name) return null;
  if (branchesCache[name]) return branchesCache[name];
  
  console.log(`    Creating branch: ${name}`);
  await sleep(200);
  const result = await apiPost('/branches', { 
    name,
    address: 'TBD'
  });
  if (result.id) {
    branchesCache[name] = result.id;
    return result.id;
  }
  console.log(`    ⚠ Failed to create branch: ${JSON.stringify(result)}`);
  return null;
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
  
  // Build cycle payload
  const cycleData = {
    name,
    instructorId,
    courseId,
    branchId,
    dayOfWeek,
    startTime,
    endTime,
    type,
    isOnline,
    startDate: fireberryCycle.startDate ? fireberryCycle.startDate.split('T')[0] : null,
    endDate: fireberryCycle.endDate ? fireberryCycle.endDate.split('T')[0] : null,
    meetingLink: fireberryCycle.zoomLink && !fireberryCycle.zoomLink.includes('לא ניתן') ? fireberryCycle.zoomLink : null,
    status: 'active'
  };
  
  // Remove null values
  Object.keys(cycleData).forEach(key => {
    if (cycleData[key] === null || cycleData[key] === undefined) {
      delete cycleData[key];
    }
  });
  
  await sleep(200);
  const result = await apiPost('/cycles', cycleData);
  
  if (result.id) {
    console.log(`  ✓ Created cycle: ${result.id}`);
    return result;
  } else {
    console.log(`  ✗ Failed: ${JSON.stringify(result)}`);
    return null;
  }
}

async function main() {
  console.log('=== Importing Missing Cycles from Fireberry to HaiTech ===\n');
  
  // Login
  await login();
  
  // Wait after login
  await sleep(500);
  
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
  let failed = 0;
  
  for (const cycle of missingCycles) {
    const result = await importCycle(cycle);
    if (result) {
      created++;
    } else {
      failed++;
    }
    // Delay between cycles
    await sleep(300);
  }
  
  console.log('\n=== Summary ===');
  console.log(`Total cycles to import: ${missingCycles.length}`);
  console.log(`Successfully created: ${created}`);
  console.log(`Failed: ${failed}`);
}

main().catch(console.error);
