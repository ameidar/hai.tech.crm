#!/usr/bin/env node
/**
 * Cycle Migration Script: Fireberry CRM → HaiTech CRM
 * Migrates cycles day by day, skipping existing ones
 */

import fs from 'fs';

const API_BASE = 'http://localhost:3001/api';
const DATA_FILE = '/home/opc/clawd/projects/haitech-crm/migration/data/fireberry_cycles.json';

// Hebrew day mapping
const DAY_MAP = {
  'ראשון': 'sunday',
  'שני': 'monday', 
  'שלישי': 'tuesday',
  'רביעי': 'wednesday',
  'חמישי': 'thursday',
  'שישי': 'friday'
};

let TOKEN = '';
let coursesMap = {};
let instructorsMap = {};
let existingCycles = new Set();

async function getToken() {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@haitech.co.il', password: 'admin123' })
  });
  const data = await res.json();
  return data.accessToken;
}

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Authorization': `Bearer ${TOKEN}` }
  });
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function loadMappings() {
  console.log('Loading mappings...');
  
  // Load courses
  const coursesRes = await apiGet('/courses?limit=100');
  for (const course of coursesRes.data) {
    coursesMap[course.name] = course.id;
  }
  console.log(`Loaded ${Object.keys(coursesMap).length} courses`);
  
  // Load instructors (2 pages)
  const instructors1 = await apiGet('/instructors?limit=100&page=1');
  const instructors2 = await apiGet('/instructors?limit=100&page=2');
  const allInstructors = [...instructors1.data, ...(instructors2.data || [])];
  for (const instructor of allInstructors) {
    instructorsMap[instructor.name] = instructor.id;
  }
  console.log(`Loaded ${Object.keys(instructorsMap).length} instructors`);
  
  // Load existing cycles
  const cyclesRes = await apiGet('/cycles?limit=100');
  for (const cycle of cyclesRes.data) {
    existingCycles.add(cycle.name);
  }
  console.log(`Found ${existingCycles.size} existing cycles`);
}

function calculateEndTime(startTime, durationMinutes) {
  if (!startTime) return null;
  const [hours, minutes] = startTime.split(':').map(Number);
  const totalMinutes = hours * 60 + minutes + durationMinutes;
  const endHours = Math.floor(totalMinutes / 60) % 24;
  const endMinutes = totalMinutes % 60;
  return `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`;
}

function determineType(typeName, pricingType) {
  // Type mapping based on Fireberry data
  if (pricingType === 'פרטי' || typeName === 'אונליין פרטי') {
    return 'private';
  }
  if (typeName?.includes('אונליין')) {
    return 'institutional_online';
  }
  return 'institutional_fixed';
}

function determineIsOnline(typeName) {
  return typeName?.includes('אונליין') || false;
}

async function createCycle(cycle) {
  // Skip if no day
  if (!cycle.day || !DAY_MAP[cycle.day]) {
    console.log(`  ⏭️  Skipping (no day): ${cycle.name}`);
    return { skipped: true, reason: 'no_day' };
  }
  
  // Skip if already exists
  if (existingCycles.has(cycle.name)) {
    console.log(`  ⏭️  Already exists: ${cycle.name}`);
    return { skipped: true, reason: 'exists' };
  }
  
  // Find course ID
  let courseId = coursesMap[cycle.courseName];
  if (!courseId) {
    console.log(`  ⚠️  Course not found: ${cycle.courseName}, using 'קורס כללי'`);
    courseId = coursesMap['קורס כללי'];
  }
  
  // Find instructor ID
  let instructorId = instructorsMap[cycle.instructorName];
  if (!instructorId) {
    console.log(`  ⚠️  Instructor not found: ${cycle.instructorName}`);
    return { skipped: true, reason: 'no_instructor' };
  }
  
  const startTime = cycle.time;
  const duration = cycle.duration || 75;
  const endTime = calculateEndTime(startTime, duration);
  
  const cycleData = {
    name: cycle.name,
    courseId: courseId,
    instructorId: instructorId,
    day: DAY_MAP[cycle.day],
    startTime: startTime,
    endTime: endTime,
    startDate: cycle.startDate?.split('T')[0] || null,
    endDate: cycle.endDate?.split('T')[0] || null,
    type: determineType(cycle.typeName, cycle.pricingType),
    isOnline: determineIsOnline(cycle.typeName),
    totalMeetings: cycle.totalMeetings || null,
    pricePerStudent: cycle.revenue || null,
    zoomLink: (cycle.zoomLink && !cycle.zoomLink.includes('לא ניתן')) ? cycle.zoomLink : null,
    notes: cycle.customerName ? `לקוח: ${cycle.customerName}` : null
  };
  
  try {
    const result = await apiPost('/cycles', cycleData);
    if (result.id) {
      console.log(`  ✅ Created: ${cycle.name}`);
      existingCycles.add(cycle.name);
      
      // Mark completed meetings if any
      if (cycle.completedMeetings && cycle.completedMeetings > 0) {
        // This would require getting meetings and marking them complete
        // For now, we'll note it in the log
        console.log(`     📋 Has ${Math.floor(cycle.completedMeetings)} completed meetings (manual marking needed)`);
      }
      
      return { created: true, id: result.id };
    } else {
      console.log(`  ❌ Error: ${cycle.name} - ${JSON.stringify(result)}`);
      return { error: true, details: result };
    }
  } catch (err) {
    console.log(`  ❌ Exception: ${cycle.name} - ${err.message}`);
    return { error: true, details: err.message };
  }
}

async function migrateDayCycles(dayHebrew, dayEnglish, cycles) {
  const dayCycles = cycles.filter(c => c.day === dayHebrew);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📅 ${dayHebrew} (${dayEnglish}) - ${dayCycles.length} cycles`);
  console.log('='.repeat(60));
  
  let created = 0, skipped = 0, errors = 0;
  
  for (const cycle of dayCycles) {
    const result = await createCycle(cycle);
    if (result.created) created++;
    else if (result.skipped) skipped++;
    else errors++;
    
    // Small delay to avoid overwhelming the API
    await new Promise(r => setTimeout(r, 100));
  }
  
  console.log(`\n📊 ${dayHebrew} Summary: ${created} created, ${skipped} skipped, ${errors} errors`);
  return { created, skipped, errors };
}

async function main() {
  console.log('🚀 Starting Fireberry → HaiTech Cycle Migration\n');
  
  // Get token
  TOKEN = await getToken();
  console.log('✅ Authenticated\n');
  
  // Load mappings
  await loadMappings();
  
  // Load Fireberry data
  const rawData = fs.readFileSync(DATA_FILE, 'utf-8');
  const cycles = JSON.parse(rawData);
  console.log(`\n📊 Total cycles in Fireberry: ${cycles.length}`);
  
  // Stats
  const totals = { created: 0, skipped: 0, errors: 0 };
  
  // Migrate day by day (Sunday → Friday)
  const days = [
    ['ראשון', 'Sunday'],
    ['שני', 'Monday'],
    ['שלישי', 'Tuesday'],
    ['רביעי', 'Wednesday'],
    ['חמישי', 'Thursday'],
    ['שישי', 'Friday']
  ];
  
  for (const [dayHeb, dayEng] of days) {
    const result = await migrateDayCycles(dayHeb, dayEng, cycles);
    totals.created += result.created;
    totals.skipped += result.skipped;
    totals.errors += result.errors;
  }
  
  // Handle cycles with no day
  const noDayCycles = cycles.filter(c => !c.day);
  if (noDayCycles.length > 0) {
    console.log(`\n⚠️  Cycles without day assignment: ${noDayCycles.length}`);
    for (const c of noDayCycles) {
      console.log(`   - ${c.name}`);
    }
  }
  
  // Final summary
  console.log('\n' + '='.repeat(60));
  console.log('🏁 MIGRATION COMPLETE');
  console.log('='.repeat(60));
  console.log(`✅ Created: ${totals.created}`);
  console.log(`⏭️  Skipped: ${totals.skipped}`);
  console.log(`❌ Errors: ${totals.errors}`);
  console.log(`📊 Total processed: ${totals.created + totals.skipped + totals.errors}`);
}

main().catch(console.error);
