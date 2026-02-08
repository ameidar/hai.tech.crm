const fs = require('fs');

const TOKEN = fs.readFileSync('/home/opc/clawd/projects/haitech-crm/.api-token', 'utf8').trim();
const BASE_URL = 'https://crm.orma-ai.com/api';
const CYCLE_ID = '94ae2b95-9e85-4360-94e5-3ada1ec6fe1a';

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
  const [datePart] = dateStr.split(' ');
  const [day, month, year] = datePart.split('/');
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

async function main() {
  // Read CSV and build date->status map
  const csvPath = '/home/opc/.clawdbot/media/inbound/17553ad4-248e-474e-9219-b1a8db77af74.csv';
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const lines = csvContent.split('\n').slice(1).filter(l => l.trim());
  
  const dateStatusMap = {};
  const dateNotesMap = {};
  
  for (const line of lines) {
    const matches = line.match(/("([^"]*)"|[^,]+)/g);
    if (!matches || matches.length < 7) continue;
    
    const fields = matches.map(f => f.replace(/^"|"$/g, ''));
    const [dateStr, status, , , , , notes] = fields;
    const date = parseDate(dateStr);
    
    dateStatusMap[date] = statusMap[status] || 'scheduled';
    if (notes && notes !== '-') {
      dateNotesMap[date] = notes;
    }
  }
  
  // Get all meetings
  const meetings = await api(`/meetings?cycleId=${CYCLE_ID}&limit=100`);
  console.log(`Found ${meetings.data.length} meetings to update`);
  
  let updated = 0;
  
  for (const meeting of meetings.data) {
    const date = meeting.scheduledDate.split('T')[0];
    const newStatus = dateStatusMap[date];
    const notes = dateNotesMap[date];
    
    if (newStatus && newStatus !== meeting.status) {
      try {
        await api(`/meetings/${meeting.id}`, 'PUT', { 
          status: newStatus,
          notes: notes || meeting.notes,
        });
        updated++;
        process.stdout.write('.');
      } catch (err) {
        console.error(`\nError updating ${meeting.id}: ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 50));
    }
  }
  
  console.log(`\n\nUpdated ${updated} meetings`);
}

main().catch(console.error);
