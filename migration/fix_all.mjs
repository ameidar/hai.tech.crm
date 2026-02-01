// Complete migration fix script
import fs from 'fs';

const API_BASE = 'http://localhost:3001/api';
let TOKEN = '';

async function login() {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@haitech.co.il', password: 'admin123' })
  });
  const data = await res.json();
  TOKEN = data.accessToken;
  console.log('Logged in successfully');
}

async function api(method, path, body = null) {
  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  return res.json();
}

// Load Fireberry data
const fireberryData = JSON.parse(fs.readFileSync('/home/opc/clawd/projects/haitech-crm/migration/data/fireberry_cycles.json'));

// Day mapping
const dayMap = {
  'ראשון': 'sunday', 'שני': 'monday', 'שלישי': 'tuesday',
  'רביעי': 'wednesday', 'חמישי': 'thursday', 'שישי': 'friday'
};

function normalizeTime(time) {
  if (!time) return null;
  if (time.includes('T')) {
    const d = new Date(time);
    return `${d.getUTCHours().toString().padStart(2,'0')}:${d.getUTCMinutes().toString().padStart(2,'0')}`;
  }
  return time.substring(0, 5);
}

function findMatch(fbCycle, htCycles) {
  // Try exact match first
  let match = htCycles.find(h => h.name === fbCycle.name);
  if (match) return match;
  
  // Try normalized match (remove extra spaces)
  const fbNorm = fbCycle.name.replace(/\s+/g, ' ').trim();
  match = htCycles.find(h => h.name.replace(/\s+/g, ' ').trim() === fbNorm);
  if (match) return match;
  
  // Try contains match with instructor
  const fbInstructor = fbCycle.instructorName;
  match = htCycles.find(h => 
    h.name.includes(fbCycle.name.split(' ')[0]) && 
    h.instructor?.name === fbInstructor
  );
  
  return match;
}

async function fixCompletedMeetings() {
  console.log('\n=== Fixing Completed Meetings ===');
  
  // Get all HaiTech cycles
  const page1 = await api('GET', '/cycles?limit=100&page=1');
  const page2 = await api('GET', '/cycles?limit=100&page=2');
  const htCycles = [...(page1.data || []), ...(page2.data || [])];
  console.log(`Found ${htCycles.length} cycles in HaiTech`);
  
  let fixed = 0;
  let errors = 0;
  
  for (const fbCycle of fireberryData) {
    const completed = Math.floor(fbCycle.completedMeetings || 0);
    if (completed === 0) continue;
    
    const htCycle = findMatch(fbCycle, htCycles);
    if (!htCycle) continue;
    
    if (htCycle.completedMeetings >= completed) continue;
    
    // Get meetings for this cycle
    const meetings = await api('GET', `/cycles/${htCycle.id}/meetings`);
    if (!meetings || !Array.isArray(meetings)) continue;
    
    // Sort by date
    const sorted = meetings.sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate));
    
    // Mark first N as completed
    const toComplete = completed - htCycle.completedMeetings;
    let marked = 0;
    
    for (const meeting of sorted) {
      if (marked >= toComplete) break;
      if (meeting.status === 'completed') continue;
      
      try {
        await api('PUT', `/meetings/${meeting.id}`, { status: 'completed' });
        marked++;
      } catch (e) {
        errors++;
      }
    }
    
    if (marked > 0) {
      fixed++;
      console.log(`  Fixed: ${htCycle.name} (+${marked} completed)`);
    }
  }
  
  console.log(`Fixed ${fixed} cycles, ${errors} errors`);
}

async function removeDuplicates() {
  console.log('\n=== Removing Duplicates ===');
  
  const page1 = await api('GET', '/cycles?limit=100&page=1');
  const page2 = await api('GET', '/cycles?limit=100&page=2');
  const htCycles = [...(page1.data || []), ...(page2.data || [])];
  
  // Group by normalized name
  const byName = {};
  for (const c of htCycles) {
    const norm = c.name.replace(/\s+/g, ' ').trim();
    if (!byName[norm]) byName[norm] = [];
    byName[norm].push(c);
  }
  
  let deleted = 0;
  for (const [name, cycles] of Object.entries(byName)) {
    if (cycles.length <= 1) continue;
    
    // Keep the one with most completed meetings
    cycles.sort((a, b) => b.completedMeetings - a.completedMeetings);
    
    for (let i = 1; i < cycles.length; i++) {
      try {
        await api('DELETE', `/cycles/${cycles[i].id}`);
        deleted++;
        console.log(`  Deleted duplicate: ${cycles[i].name}`);
      } catch (e) {
        console.log(`  Error deleting: ${cycles[i].name}`);
      }
    }
  }
  
  console.log(`Deleted ${deleted} duplicates`);
}

async function main() {
  await login();
  await fixCompletedMeetings();
  await removeDuplicates();
  
  // Final count
  const final = await api('GET', '/cycles?limit=1');
  console.log(`\n=== Final: ${final.pagination?.total || 0} cycles ===`);
}

main().catch(console.error);
