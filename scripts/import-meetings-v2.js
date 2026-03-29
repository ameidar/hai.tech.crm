#!/usr/bin/env node
/**
 * Fireberry Meetings Import Script v2
 * Imports meetings from CSV to HaiTech CRM
 * Handles missing instructors gracefully
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Config
const TOKEN = fs.readFileSync(path.join(__dirname, '../.api-token'), 'utf8').trim();
const BASE = 'crm.orma-ai.com';
const CSV_PATH = path.join(__dirname, '../fireberry-meetings-import.csv');

// Default instructor for when no match found
const DEFAULT_INSTRUCTOR_ID = 'd323ca14-1189-4c0c-a2b3-044fd63ac56c'; // "מדריך - ייבוא" or first available

// Status mapping
const STATUS_MAP = {
  'התקיימה': 'completed',
  'נדחתה': 'cancelled',
  'בוטלה': 'cancelled',
  'לא בשימוש': 'cancelled',
  '-': 'scheduled',
  '': 'scheduled'
};

// Cache
const cycleCache = new Map();
const instructorCache = new Map();

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

// Parse CSV - handle Windows line endings
function parseCSV(content) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const headers = parseCSVLine(lines[0]);
  const rows = [];
  
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseCSVLine(lines[i]);
    if (values.length < 6) continue; // Skip malformed rows
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

// Main import function
async function importMeetings() {
  console.log('=== ייבוא פגישות מפיירברי v2 ===\n');
  
  // Read CSV
  const csvContent = fs.readFileSync(CSV_PATH, 'utf8');
  const rows = parseCSV(csvContent);
  console.log(`נטענו ${rows.length} שורות מהקובץ\n`);
  
  // Pre-load cycles and instructors
  console.log('טוען מחזורים ומדריכים קיימים...');
  const existingCycles = await api('GET', '/cycles?limit=500');
  const existingInstructors = await api('GET', '/instructors?limit=200');
  
  let defaultInstructorId = DEFAULT_INSTRUCTOR_ID;
  
  if (existingCycles.data) {
    existingCycles.data.forEach(c => cycleCache.set(c.name, c.id));
    console.log(`  נטענו ${existingCycles.data.length} מחזורים`);
  }
  if (existingInstructors.data) {
    existingInstructors.data.forEach(i => {
      instructorCache.set(i.name, i.id);
    });
    // Use first active instructor as default if our default doesn't exist
    if (!existingInstructors.data.find(i => i.id === defaultInstructorId)) {
      defaultInstructorId = existingInstructors.data[0]?.id;
    }
    console.log(`  נטענו ${existingInstructors.data.length} מדריכים`);
  }
  console.log('');
  
  // Stats
  const stats = {
    total: rows.length,
    imported: 0,
    skipped: 0,
    errors: 0,
    newCycles: 0,
    missingInstructors: new Set()
  };
  
  // Process each row
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    
    // Parse dates
    const startDate = parseDate(row['תאריך התחלה']);
    const endDate = parseDate(row['תאריך סיום']);
    
    if (!startDate) {
      stats.skipped++;
      continue;
    }
    
    // Get cycle name
    const cycleName = row['שייך למחזור'];
    if (!cycleName || cycleName === '-' || cycleName.length < 3) {
      stats.skipped++;
      continue;
    }
    
    // Get or create cycle
    let cycleId = cycleCache.get(cycleName);
    if (!cycleId) {
      // Create new cycle
      const newCycle = await api('POST', '/cycles', {
        name: cycleName,
        status: 'active',
        dayOfWeek: 'tuesday'
      });
      if (newCycle.id) {
        cycleId = newCycle.id;
        cycleCache.set(cycleName, cycleId);
        stats.newCycles++;
        console.log(`  ➕ מחזור חדש: ${cycleName}`);
      } else {
        stats.errors++;
        continue;
      }
    }
    
    // Get instructor
    const instructorName = row['שם המדריך'];
    let instructorId = instructorCache.get(instructorName);
    
    // If instructor not found, use default
    if (!instructorId) {
      if (instructorName && instructorName !== '-' && instructorName.length > 2) {
        stats.missingInstructors.add(instructorName);
      }
      instructorId = defaultInstructorId;
    }
    
    // Map status
    const rawStatus = row['סטטוס'] || '-';
    const status = STATUS_MAP[rawStatus] || 'scheduled';
    
    // Prepare notes
    let notes = null;
    const detail = row['פירוט מהלך השיעור במלואו'];
    const topics = row['מושגים שנלמדו השיעור'];
    if (detail && detail !== '-' && detail !== '.') {
      notes = detail;
      if (topics && topics !== '-' && topics !== '.' && topics !== detail) {
        notes += '\n\nמושגים: ' + topics;
      }
    }
    
    // Create meeting
    const meetingData = {
      cycleId,
      instructorId,
      scheduledDate: startDate.date,
      startTime: startDate.time,
      endTime: endDate ? endDate.time : addHour(startDate.time),
      status
    };
    
    try {
      const result = await api('POST', '/meetings', meetingData);
      if (result.id) {
        stats.imported++;
        
        // Update status if not scheduled
        if (status !== 'scheduled') {
          await api('PUT', `/meetings/${result.id}`, { status });
        }
        
        // Update notes if exists
        if (notes) {
          await api('PUT', `/meetings/${result.id}`, { notes });
        }
        
        // Progress indicator
        if (stats.imported % 500 === 0) {
          console.log(`  ⏳ ${stats.imported}/${rows.length} פגישות יובאו...`);
        }
      } else {
        stats.errors++;
        if (stats.errors <= 5) {
          console.error(`  ❌ שגיאה בשורה ${i + 2}: ${JSON.stringify(result)}`);
        }
      }
    } catch (err) {
      stats.errors++;
      if (stats.errors <= 5) {
        console.error(`  ❌ שגיאה בשורה ${i + 2}: ${err.message}`);
      }
    }
  }
  
  // Summary
  console.log('\n=== סיכום ייבוא ===');
  console.log(`סה"כ שורות: ${stats.total}`);
  console.log(`יובאו בהצלחה: ${stats.imported}`);
  console.log(`מחזורים חדשים: ${stats.newCycles}`);
  console.log(`דילוג: ${stats.skipped}`);
  console.log(`שגיאות: ${stats.errors}`);
  
  if (stats.missingInstructors.size > 0) {
    console.log(`\nמדריכים שלא נמצאו (הוחלפו בברירת מחדל):`);
    stats.missingInstructors.forEach(name => console.log(`  - ${name}`));
  }
  
  return stats;
}

function addHour(time) {
  const [h, m] = time.split(':').map(Number);
  return `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Run
importMeetings()
  .then(stats => {
    console.log('\n✅ הייבוא הסתיים');
    process.exit(stats.errors > stats.imported * 0.1 ? 1 : 0);
  })
  .catch(err => {
    console.error('שגיאה קריטית:', err);
    process.exit(1);
  });
