#!/usr/bin/env node

/**
 * Import cycles from CSV file to HaiTech CRM
 */

const fs = require('fs');
const path = require('path');

const API_URL = 'http://localhost:3001/api';
let TOKEN = '';

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

function parseCSV(csvText) {
  const lines = csvText.trim().split('\n');
  const headers = parseCSVLine(lines[0]);
  const rows = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || '';
    });
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

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
  const instructors = await apiGet('/instructors?limit=200');
  for (const i of instructors.data || instructors || []) {
    instructorsCache[i.name] = i.id;
  }
  console.log(`  ✓ Loaded ${Object.keys(instructorsCache).length} instructors`);
  
  // Load courses
  await sleep(100);
  const courses = await apiGet('/courses?limit=200');
  for (const c of courses.data || courses || []) {
    coursesCache[c.name] = c.id;
  }
  console.log(`  ✓ Loaded ${Object.keys(coursesCache).length} courses`);
  
  // Load branches
  await sleep(100);
  const branches = await apiGet('/branches?limit=200');
  for (const b of branches.data || branches || []) {
    branchesCache[b.name] = b.id;
  }
  console.log(`  ✓ Loaded ${Object.keys(branchesCache).length} branches`);
}

async function getOrCreateInstructor(name) {
  if (!name) return null;
  if (instructorsCache[name]) return instructorsCache[name];
  
  console.log(`    Creating instructor: ${name}`);
  await sleep(200);
  const result = await apiPost('/instructors', { 
    name, 
    phone: `050${Math.floor(1000000 + Math.random() * 9000000)}`,
    isActive: true
  });
  if (result.id) {
    instructorsCache[name] = result.id;
    return result.id;
  }
  console.log(`    ⚠ Failed to create instructor: ${JSON.stringify(result)}`);
  return null;
}

async function getOrCreateCourse(name) {
  if (!name) {
    // Use default course
    name = 'קורס כללי';
  }
  if (coursesCache[name]) return coursesCache[name];
  
  console.log(`    Creating course: ${name}`);
  await sleep(200);
  const result = await apiPost('/courses', { 
    name,
    description: `Course: ${name}`,
    defaultDuration: 75
  });
  if (result.id) {
    coursesCache[name] = result.id;
    return result.id;
  }
  console.log(`    ⚠ Failed to create course: ${JSON.stringify(result)}`);
  return null;
}

async function getOrCreateBranch(name) {
  if (!name || name === 'ללא סניף') return null;
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

function calculateEndTime(startTime, duration = 75) {
  if (!startTime) return '17:00';
  const [hours, minutes] = startTime.split(':').map(Number);
  const totalMinutes = hours * 60 + minutes + duration;
  const endHours = Math.floor(totalMinutes / 60) % 24;
  const endMins = totalMinutes % 60;
  return `${String(endHours).padStart(2, '0')}:${String(endMins).padStart(2, '0')}`;
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  // Format: DD/MM/YYYY
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    const [day, month, year] = parts;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return null;
}

async function importCycle(row) {
  const name = row['שם המחזור'];
  console.log(`\nImporting: ${name}`);
  
  // Look up or create related entities
  const instructorName = row['מדריך ראשי'];
  const instructorId = await getOrCreateInstructor(instructorName);
  
  // Extract course name from cycle name (or use default)
  const courseId = await getOrCreateCourse('קורס כללי');
  
  const branchName = row['סניף מקושר למחזור'];
  const branchId = await getOrCreateBranch(branchName);
  
  if (!instructorId || !courseId) {
    console.log(`  ✗ Skipping - missing required references`);
    return null;
  }
  
  // Determine type
  const typeStr = row['סוג המחזור - מוסדי/פרטי'] || '';
  let type = 'institutional_fixed';
  if (typeStr.includes('פרטי')) {
    type = 'private';
  } else if (row['מחיר לילד עבור מחזור מוסדי']) {
    type = 'institutional_per_child';
  }
  
  // Check if online
  const isOnline = branchName && branchName.includes('אונליין');
  const activityType = isOnline ? 'online' : 'frontal';
  
  // Map day
  const dayStr = row['יום בשבוע'];
  const dayOfWeek = dayStr ? DAY_MAP[dayStr] : 'sunday';
  
  // Times
  const startTime = row['שעת התחלה'] || '16:00';
  const endTime = calculateEndTime(startTime, 75);
  
  // Date
  const startDate = parseDate(row['תאריך תחילת מחזור']);
  
  // Meetings
  const totalMeetings = parseInt(row['מספר מפגשים']) || 10;
  
  // Pricing
  const pricePerStudent = parseFloat(row['מחיר לילד עבור מחזור מוסדי']) || 0;
  const meetingRevenue = parseFloat(row['סכום לתשלום עבור פגישה']) || 0;
  
  // Build cycle payload
  const cycleData = {
    name,
    instructorId,
    courseId,
    branchId: branchId || undefined,
    dayOfWeek,
    startTime,
    endTime,
    durationMinutes: 75,
    type,
    isOnline,
    activityType,
    startDate: startDate || new Date().toISOString().split('T')[0],
    totalMeetings,
    status: 'active',
    sendParentReminders: false
  };
  
  // Add pricing based on type
  if (type === 'institutional_per_child' && pricePerStudent > 0) {
    cycleData.pricePerStudent = pricePerStudent;
  } else if (type === 'institutional_fixed' && meetingRevenue > 0) {
    cycleData.meetingRevenue = meetingRevenue;
  }
  
  // Remove undefined values
  Object.keys(cycleData).forEach(key => {
    if (cycleData[key] === undefined) {
      delete cycleData[key];
    }
  });
  
  console.log(`  Data:`, JSON.stringify(cycleData, null, 2));
  
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
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: node import_csv_cycles.js <csv_file>');
    process.exit(1);
  }
  
  console.log('=== Importing Cycles from CSV to HaiTech CRM ===\n');
  
  // Read CSV
  const csvText = fs.readFileSync(csvPath, 'utf-8');
  const rows = parseCSV(csvText);
  console.log(`Parsed ${rows.length} cycles from CSV\n`);
  
  // Login
  await login();
  await sleep(500);
  
  // Load reference data
  await loadCaches();
  
  // Import each cycle
  let created = 0;
  let failed = 0;
  
  for (const row of rows) {
    const result = await importCycle(row);
    if (result) {
      created++;
    } else {
      failed++;
    }
    // Delay between cycles
    await sleep(300);
  }
  
  console.log('\n=== Summary ===');
  console.log(`Total cycles in CSV: ${rows.length}`);
  console.log(`Successfully created: ${created}`);
  console.log(`Failed: ${failed}`);
}

main().catch(console.error);
