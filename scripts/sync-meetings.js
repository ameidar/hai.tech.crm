const fs = require('fs');
const path = require('path');

const TOKEN = fs.readFileSync('/home/opc/clawd/projects/haitech-crm/.api-token', 'utf8').trim();
const BASE_URL = 'https://crm.orma-ai.com/api';
const CYCLE_ID = '94ae2b95-9e85-4360-94e5-3ada1ec6fe1a';

// Instructor mapping
const instructorMap = {
  'אור יוסף אשטמקר': '6a4e3f5d-dd62-4ba7-a04a-70389f185206',
  'ברק בונקר': 'f1cc4e65-1645-4e06-98cf-d1dfa23c85da',
  'דן שרגר': null, // Will be created
};

// Status mapping
const statusMap = {
  'התקיימה': 'completed',
  'נדחתה': 'postponed',
  'בוטלה': 'cancelled',
  'לא בשימוש': 'cancelled',
  '-': 'scheduled',
};

async function api(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) options.body = JSON.stringify(body);
  
  const res = await fetch(`${BASE_URL}${endpoint}`, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

function parseDate(dateStr) {
  // Format: "28/11/2024 17:00"
  const [datePart, timePart] = dateStr.split(' ');
  const [day, month, year] = datePart.split('/');
  return {
    date: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`,
    time: timePart,
  };
}

async function createInstructor(name) {
  console.log(`Creating instructor: ${name}`);
  const result = await api('/instructors', 'POST', {
    name,
    phone: '0500000000',
    email: 'dan.sharger@haitech.temp',
    rateFrontal: 100,
    rateOnline: 100,
  });
  return result.id;
}

async function main() {
  // Read CSV
  const csvPath = '/home/opc/.clawdbot/media/inbound/17553ad4-248e-474e-9219-b1a8db77af74.csv';
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const lines = csvContent.split('\n').slice(1).filter(l => l.trim()); // Skip header
  
  console.log(`Processing ${lines.length} meetings...`);
  
  // Create missing instructor
  if (!instructorMap['דן שרגר']) {
    instructorMap['דן שרגר'] = await createInstructor('דן שרגר');
  }
  
  let created = 0;
  let errors = 0;
  
  for (const line of lines) {
    // Parse CSV line (handling quoted fields with commas)
    const matches = line.match(/("([^"]*)"|[^,]+)/g);
    if (!matches || matches.length < 7) continue;
    
    const fields = matches.map(f => f.replace(/^"|"$/g, ''));
    const [dateStr, status, , instructorName, , , notes] = fields;
    
    try {
      const { date, time } = parseDate(dateStr);
      const instructorId = instructorMap[instructorName];
      
      if (!instructorId) {
        console.log(`Unknown instructor: ${instructorName}`);
        continue;
      }
      
      // Calculate end time (1 hour later)
      const [h, m] = time.split(':').map(Number);
      const endTime = `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      
      const meetingData = {
        cycleId: CYCLE_ID,
        instructorId,
        scheduledDate: date,
        startTime: time,
        endTime,
        status: statusMap[status] || 'scheduled',
        notes: notes && notes !== '-' ? notes : undefined,
      };
      
      await api('/meetings', 'POST', meetingData);
      created++;
      process.stdout.write('.');
      
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 100));
      
    } catch (err) {
      console.error(`\nError for ${dateStr}: ${err.message}`);
      errors++;
    }
  }
  
  console.log(`\n\nDone! Created: ${created}, Errors: ${errors}`);
}

main().catch(console.error);
