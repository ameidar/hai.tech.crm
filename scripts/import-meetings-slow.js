#!/usr/bin/env node
/**
 * Fireberry Meetings Import - Slow version with rate limiting
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Config
const TOKEN_PATH = path.join(__dirname, '../.api-token');
const BASE = 'crm.orma-ai.com';
const CSV_PATH = path.join(__dirname, '../fireberry-meetings-import.csv');
const BATCH_SIZE = 20; // Import 20 at a time
const BATCH_DELAY_MS = 2000; // Wait 2 seconds between batches

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

// Get fresh token
async function getToken() {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      email: 'admin@haitech.co.il',
      password: 'admin123'
    });
    const options = {
      hostname: BASE,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { 
          const result = JSON.parse(body);
          resolve(result.accessToken);
        } catch { reject(new Error('Invalid login response')); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

let currentToken = null;

// API helper with retry
async function api(method, endpoint, data = null, retries = 3) {
  if (!currentToken) {
    currentToken = await getToken();
  }
  
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BASE,
      path: `/api${endpoint}`,
      method,
      headers: {
        'Authorization': `Bearer ${currentToken}`,
        'Content-Type': 'application/json'
      }
    };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', async () => {
        try { 
          const result = JSON.parse(body);
          if (result.error && result.error.includes('Too many requests') && retries > 0) {
            console.log('  ⏸ Rate limited, waiting 5s...');
            await sleep(5000);
            resolve(api(method, endpoint, data, retries - 1));
          } else if (result.error && result.error.includes('expired') && retries > 0) {
            currentToken = await getToken();
            resolve(api(method, endpoint, data, retries - 1));
          } else {
            resolve(result);
          }
        }
        catch { resolve(body); }
      });
    });
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Parse CSV
function parseCSV(content) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const headers = parseCSVLine(lines[0]);
  const rows = [];
  
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseCSVLine(lines[i]);
    if (values.length < 6) continue;
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

function addHour(time) {
  const [h, m] = time.split(':').map(Number);
  return `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

async function importMeetings() {
  console.log('=== ייבוא פגישות (איטי עם rate limiting) ===\n');
  
  // Get initial token
  currentToken = await getToken();
  console.log('✅ התחברות הצליחה\n');
  
  // Read CSV
  const csvContent = fs.readFileSync(CSV_PATH, 'utf8');
  const rows = parseCSV(csvContent);
  console.log(`נטענו ${rows.length} שורות מהקובץ\n`);
  
  // Load cycles and instructors
  console.log('טוען מחזורים ומדריכים...');
  
  const existingCycles = await api('GET', '/cycles?limit=500');
  await sleep(500);
  const existingInstructors = await api('GET', '/instructors?limit=200');
  
  let defaultInstructorId = null;
  
  if (existingCycles.data) {
    existingCycles.data.forEach(c => cycleCache.set(c.name, c.id));
    console.log(`  ${existingCycles.data.length} מחזורים`);
  }
  if (existingInstructors.data) {
    existingInstructors.data.forEach(i => instructorCache.set(i.name, i.id));
    defaultInstructorId = existingInstructors.data[0]?.id;
    console.log(`  ${existingInstructors.data.length} מדריכים`);
  }
  
  console.log('');
  
  // Stats
  const stats = { imported: 0, skipped: 0, errors: 0, newCycles: 0 };
  
  // Process in batches
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    
    for (const row of batch) {
      const startDate = parseDate(row['תאריך התחלה']);
      const endDate = parseDate(row['תאריך סיום']);
      
      if (!startDate) { stats.skipped++; continue; }
      
      const cycleName = row['שייך למחזור'];
      if (!cycleName || cycleName === '-' || cycleName.length < 3) {
        stats.skipped++; continue;
      }
      
      // Get or create cycle
      let cycleId = cycleCache.get(cycleName);
      if (!cycleId) {
        const newCycle = await api('POST', '/cycles', {
          name: cycleName,
          status: 'active',
          dayOfWeek: 'tuesday'
        });
        if (newCycle.id) {
          cycleId = newCycle.id;
          cycleCache.set(cycleName, cycleId);
          stats.newCycles++;
          console.log(`  ➕ מחזור: ${cycleName}`);
        } else {
          stats.errors++;
          continue;
        }
      }
      
      // Get instructor
      const instructorName = row['שם המדריך'];
      let instructorId = instructorCache.get(instructorName) || defaultInstructorId;
      
      const rawStatus = row['סטטוס'] || '-';
      const status = STATUS_MAP[rawStatus] || 'scheduled';
      
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
          if (status !== 'scheduled') {
            await api('PUT', `/meetings/${result.id}`, { status });
          }
        } else {
          stats.errors++;
          if (stats.errors <= 3) {
            console.error(`  ❌ ${JSON.stringify(result)}`);
          }
        }
      } catch (err) {
        stats.errors++;
      }
    }
    
    // Progress
    console.log(`⏳ ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length} (${stats.imported} יובאו, ${stats.errors} שגיאות)`);
    
    // Wait between batches
    if (i + BATCH_SIZE < rows.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }
  
  console.log('\n=== סיכום ===');
  console.log(`יובאו: ${stats.imported}`);
  console.log(`מחזורים חדשים: ${stats.newCycles}`);
  console.log(`דילוג: ${stats.skipped}`);
  console.log(`שגיאות: ${stats.errors}`);
  
  return stats;
}

importMeetings()
  .then(() => console.log('\n✅ הסתיים'))
  .catch(err => console.error('❌ שגיאה:', err.message));
