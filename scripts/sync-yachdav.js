const fs = require('fs');

const TOKEN = fs.readFileSync('/home/opc/clawd/projects/haitech-crm/.api-token', 'utf8').trim();
const BASE_URL = 'https://crm.orma-ai.com/api';
const CYCLE_ID = '3101bbc2-c712-49cf-8410-e81fbf368b36';
const INSTRUCTOR_ID = '07b98917-8b39-451b-8ad3-17c312e5c99d';

const statusMap = {
  'התקיימה': 'completed',
  'נדחתה': 'postponed',
  'בוטלה': 'cancelled',
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
  const [datePart, timePart] = dateStr.split(' ');
  const [day, month, year] = datePart.split('/');
  return {
    date: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`,
    time: timePart,
  };
}

async function main() {
  const csvPath = '/home/opc/.clawdbot/media/inbound/ad76f891-f3fd-4f74-9dc2-8974395567d8.csv';
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const lines = csvContent.split('\n').slice(1).filter(l => l.trim());
  
  // Check existing meetings
  const existing = await api(`/meetings?cycleId=${CYCLE_ID}&limit=100`);
  const existingDates = new Set(existing.data.map(m => m.scheduledDate.split('T')[0]));
  
  console.log(`Found ${existing.data.length} existing meetings`);
  console.log(`Processing ${lines.length} meetings from CSV...`);
  
  let created = 0, updated = 0, errors = 0;
  
  for (const line of lines) {
    const matches = line.match(/("([^"]*)"|[^,]+)/g);
    if (!matches || matches.length < 7) continue;
    
    const fields = matches.map(f => f.replace(/^"|"$/g, ''));
    const [dateStr, status, , , , , notes] = fields;
    
    try {
      const { date, time } = parseDate(dateStr);
      const [h, m] = time.split(':').map(Number);
      const endTime = `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      const meetingStatus = statusMap[status] || 'scheduled';
      
      if (existingDates.has(date)) {
        // Update existing
        const existingMeeting = existing.data.find(m => m.scheduledDate.split('T')[0] === date);
        if (existingMeeting) {
          await api(`/meetings/${existingMeeting.id}`, 'PUT', {
            status: meetingStatus,
            notes: notes && notes !== '-' ? notes : undefined,
          });
          updated++;
        }
      } else {
        // Create new
        await api('/meetings', 'POST', {
          cycleId: CYCLE_ID,
          instructorId: INSTRUCTOR_ID,
          scheduledDate: date,
          startTime: time,
          endTime,
          status: meetingStatus,
          notes: notes && notes !== '-' ? notes : undefined,
        });
        created++;
      }
      
      process.stdout.write('.');
      await new Promise(r => setTimeout(r, 50));
      
    } catch (err) {
      console.error(`\nError: ${err.message}`);
      errors++;
    }
  }
  
  console.log(`\n\nDone! Created: ${created}, Updated: ${updated}, Errors: ${errors}`);
}

main().catch(console.error);
