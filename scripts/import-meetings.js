#!/usr/bin/env node
/**
 * Fireberry Meetings Import Script
 * Imports meetings from CSV to HaiTech CRM
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Config
const TOKEN = fs.readFileSync(path.join(__dirname, '../.api-token'), 'utf8').trim();
const BASE = 'crm.orma-ai.com';
const CSV_PATH = process.argv[2] || path.join(__dirname, '../fireberry-meetings-import.csv');
const LIMIT = process.argv[3] ? parseInt(process.argv[3]) : null; // Optional limit for testing

// Status mapping
const STATUS_MAP = {
  'התקיימה': 'completed',
  'נדחתה': 'cancelled',
  'בוטלה': 'cancelled',
  'לא בשימוש': 'cancelled',
  '-': 'scheduled',
  '': 'scheduled'
};

// Cache for cycles and instructors
const cycleCache = new Map();
const instructorCache = new Map();

// Delay helper to avoid rate limiting
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// API helper
function api(method, endpoint, data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BASE,
      path: `/api${endpoint}`,
      method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json'
      }
    };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { resolve(body); }
      });
    });
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

// Parse CSV
function parseCSV(content) {
  const lines = content.split('\n');
  const headers = parseCSVLine(lines[0]);
  const rows = [];
  
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => row[h] = values[idx] || '');
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
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
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

// Parse date from DD/MM/YYYY HH:MM format
function parseDate(dateStr) {
  if (!dateStr) return null;
  const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, day, month, year, hour, minute] = match;
  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}`
  };
}

// Full cycle cache with instructor info
const cycleFullCache = new Map();

// Get or create cycle
async function getOrCreateCycle(cycleName) {
  if (!cycleName || cycleName === '-') return null;
  
  if (cycleCache.has(cycleName)) {
    return cycleCache.get(cycleName);
  }
  
  // Search for existing cycle
  const searchResult = await api('GET', `/cycles?search=${encodeURIComponent(cycleName)}&limit=1`);
  if (searchResult.data && searchResult.data.length > 0) {
    const cycle = searchResult.data[0];
    cycleCache.set(cycleName, cycle.id);
    cycleFullCache.set(cycleName, cycle);
    return cycle.id;
  }
  
  // Create new cycle
  const newCycle = await api('POST', '/cycles', {
    name: cycleName,
    status: 'active',
    dayOfWeek: 'tuesday' // Default, can be updated
  });
  
  if (newCycle.id) {
    console.log(`  ➕ נוצר מחזור חדש: ${cycleName}`);
    cycleCache.set(cycleName, newCycle.id);
    return newCycle.id;
  }
  
  return null;
}

// Get cycle's default instructor
function getCycleInstructor(cycleName) {
  const cycle = cycleFullCache.get(cycleName);
  return cycle?.instructorId || null;
}

// Get or create instructor
async function getOrCreateInstructor(instructorName) {
  if (!instructorName || instructorName === '-') return null;
  
  if (instructorCache.has(instructorName)) {
    return instructorCache.get(instructorName);
  }
  
  // Search for existing instructor
  const searchResult = await api('GET', `/instructors?search=${encodeURIComponent(instructorName)}&limit=1`);
  if (searchResult.data && searchResult.data.length > 0) {
    const instructor = searchResult.data[0];
    instructorCache.set(instructorName, instructor.id);
    return instructor.id;
  }
  
  // Create new instructor
  const newInstructor = await api('POST', '/instructors', {
    name: instructorName,
    status: 'active'
  });
  
  if (newInstructor.id) {
    console.log(`  ➕ נוצר מדריך חדש: ${instructorName}`);
    instructorCache.set(instructorName, newInstructor.id);
    return newInstructor.id;
  }
  
  return null;
}

// Main import function
async function importMeetings() {
  console.log('=== ייבוא פגישות מפיירברי ===\n');
  
  // Read CSV
  const csvContent = fs.readFileSync(CSV_PATH, 'utf8');
  const rows = parseCSV(csvContent);
  console.log(`נטענו ${rows.length} שורות מהקובץ\n`);
  
  // Pre-load cycles and instructors
  console.log('טוען מחזורים ומדריכים קיימים...');
  let existingCycles = await api('GET', '/cycles?limit=500');
  
  // Handle rate limiting during initial load
  if (existingCycles.error) {
    console.log('  ⚠️ Rate limited, waiting 60 seconds...');
    await delay(60000);
    existingCycles = await api('GET', '/cycles?limit=500');
  }
  
  let existingInstructors = await api('GET', '/instructors?limit=200');
  if (existingInstructors.error) {
    console.log('  ⚠️ Rate limited, waiting 10 seconds...');
    await delay(10000);
    existingInstructors = await api('GET', '/instructors?limit=200');
  }
  
  if (existingCycles.data) {
    existingCycles.data.forEach(c => {
      cycleCache.set(c.name, c.id);
      cycleFullCache.set(c.name, c);
    });
    console.log(`  נטענו ${existingCycles.data.length} מחזורים`);
  } else {
    console.error('  ❌ שגיאה בטעינת מחזורים:', JSON.stringify(existingCycles));
    return { total: 0, imported: 0, skipped: 0, errors: 1 };
  }
  
  if (existingInstructors.data) {
    existingInstructors.data.forEach(i => instructorCache.set(i.name, i.id));
    console.log(`  נטענו ${existingInstructors.data.length} מדריכים`);
  } else {
    console.error('  ❌ שגיאה בטעינת מדריכים:', JSON.stringify(existingInstructors));
    return { total: 0, imported: 0, skipped: 0, errors: 1 };
  }
  console.log('');
  
  // Stats
  const stats = {
    total: rows.length,
    imported: 0,
    skipped: 0,
    errors: 0,
    newCycles: 0,
    newInstructors: 0
  };
  
  // Process each row
  const maxRows = LIMIT ? Math.min(LIMIT, rows.length) : rows.length;
  console.log(`מעבד ${maxRows} שורות${LIMIT ? ' (מוגבל לבדיקה)' : ''}...\n`);
  
  for (let i = 0; i < maxRows; i++) {
    const row = rows[i];
    
    // Parse dates
    const startDate = parseDate(row['תאריך התחלה']);
    const endDate = parseDate(row['תאריך סיום']);
    
    if (!startDate) {
      stats.skipped++;
      continue;
    }
    
    // Get cycle and instructor IDs
    const cycleName = row['שייך למחזור'];
    const instructorName = row['שם המדריך'];
    
    const cycleId = await getOrCreateCycle(cycleName);
    if (!cycleId) {
      stats.skipped++;
      continue;
    }
    
    // Get instructor ID - use row value, fall back to cycle's default instructor
    let instructorId = await getOrCreateInstructor(instructorName);
    if (!instructorId) {
      instructorId = getCycleInstructor(cycleName);
    }
    
    if (!instructorId) {
      // Still no instructor - skip this meeting
      stats.skipped++;
      continue;
    }
    
    // Map status
    const rawStatus = row['סטטוס'] || '-';
    const status = STATUS_MAP[rawStatus] || 'scheduled';
    
    // Build notes from multiple fields
    const noteParts = [];
    if (row['פירוט מהלך השיעור במלואו'] && row['פירוט מהלך השיעור במלואו'] !== '-' && row['פירוט מהלך השיעור במלואו'] !== '.' && row['פירוט מהלך השיעור במלואו'] !== '/') {
      noteParts.push(`פירוט השיעור: ${row['פירוט מהלך השיעור במלואו']}`);
    }
    if (row['מושגים שנלמדו השיעור'] && row['מושגים שנלמדו השיעור'] !== '-' && row['מושגים שנלמדו השיעור'] !== '.' && row['מושגים שנלמדו השיעור'] !== '/') {
      noteParts.push(`מושגים: ${row['מושגים שנלמדו השיעור']}`);
    }
    if (row['סוג הדרכה'] && row['סוג הדרכה'] !== '-') {
      noteParts.push(`סוג: ${row['סוג הדרכה']}`);
    }
    
    // Create meeting
    const meetingData = {
      cycleId,
      instructorId,
      scheduledDate: startDate.date,
      startTime: startDate.time,
      endTime: endDate ? endDate.time : null,
      status,
      notes: noteParts.length > 0 ? noteParts.join('\n') : null,
      topic: row['נושא'] !== '-' ? row['נושא'] : null,
      zoomJoinUrl: row['לינק לזום (שייך למחזור)'] !== '-' ? row['לינק לזום (שייך למחזור)'] : null
    };
    
    try {
      const result = await api('POST', '/meetings', meetingData);
      if (result.id) {
        stats.imported++;
        
        // Update status if not scheduled
        if (status !== 'scheduled') {
          await api('PUT', `/meetings/${result.id}`, { status });
        }
        
        // Progress indicator
        if (stats.imported % 500 === 0 || (LIMIT && stats.imported % 10 === 0)) {
          console.log(`  ⏳ ${stats.imported}/${maxRows} פגישות יובאו...`);
        }
      } else if (result.error && result.error.includes('Too many requests')) {
        // Rate limited - wait and retry
        await delay(2000);
        const retryResult = await api('POST', '/meetings', meetingData);
        if (retryResult.id) {
          stats.imported++;
          if (status !== 'scheduled') {
            await api('PUT', `/meetings/${retryResult.id}`, { status });
          }
        } else {
          stats.errors++;
          if (stats.errors < 10) {
            console.error(`  ❌ שגיאה בשורה ${i + 2}: ${JSON.stringify(retryResult)}`);
          }
        }
      } else {
        stats.errors++;
        if (stats.errors < 10) {
          console.error(`  ❌ שגיאה בשורה ${i + 2}: ${JSON.stringify(result)}`);
        }
      }
      
      // Small delay between requests to avoid rate limiting
      await delay(200);
    } catch (err) {
      stats.errors++;
      if (stats.errors < 10) {
        console.error(`  ❌ שגיאה בשורה ${i + 2}: ${err.message}`);
      }
    }
  }
  
  // Summary
  console.log('\n=== סיכום ייבוא ===');
  console.log(`סה"כ שורות: ${stats.total}`);
  console.log(`יובאו בהצלחה: ${stats.imported}`);
  console.log(`דילוג: ${stats.skipped}`);
  console.log(`שגיאות: ${stats.errors}`);
  
  return stats;
}

// Run
importMeetings()
  .then(stats => {
    console.log('\n✅ הייבוא הסתיים');
    process.exit(stats.errors > stats.imported ? 1 : 0);
  })
  .catch(err => {
    console.error('שגיאה קריטית:', err);
    process.exit(1);
  });
