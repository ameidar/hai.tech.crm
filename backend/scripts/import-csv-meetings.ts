import { PrismaClient, Prisma } from '@prisma/client';
import { readFileSync } from 'fs';

const prisma = new PrismaClient();

function parseDate(dateStr: string): Date | null {
  if (!dateStr || dateStr === '-') return null;
  // Format: DD/MM/YYYY HH:MM
  const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, day, month, year, hour, minute] = match;
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:00Z`);
}

function mapStatus(status: string): 'scheduled' | 'completed' | 'cancelled' | 'postponed' {
  const s = status?.trim();
  if (s === 'התקיימה') return 'completed';
  if (s === 'בוטלה') return 'cancelled';
  if (s === 'נדחתה') return 'postponed';
  if (s === 'לא בשימוש') return 'cancelled';
  return 'scheduled';
}

function mapActivityType(type: string): 'online' | 'frontal' | null {
  if (type?.includes('פרטי') || type?.includes('אונליין')) return 'online';
  if (type?.includes('פרונטאלי')) return 'frontal';
  return null;
}

async function main() {
  const csv = readFileSync('../import-meetings.csv', 'utf8');
  const lines = csv.split('\n').slice(1).filter(l => l.trim()); // skip header
  
  console.log(`Processing ${lines.length} meetings...`);
  
  // Cache for cycles and instructors
  const cycleCache = new Map<string, string>();
  const instructorCache = new Map<string, string>();
  
  // Preload all cycles
  const cycles = await prisma.cycle.findMany({ select: { id: true, name: true } });
  cycles.forEach(c => cycleCache.set(c.name, c.id));
  
  // Preload all instructors
  const instructors = await prisma.instructor.findMany({ select: { id: true, name: true } });
  instructors.forEach(i => instructorCache.set(i.name, i.id));
  
  let imported = 0;
  let skipped = 0;
  let errors = 0;
  const missingCycles = new Set<string>();
  const missingInstructors = new Set<string>();
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Parse CSV (simple - assumes no commas in quoted fields except in notes)
    const parts = line.match(/(?:^|,)("(?:[^"]*(?:""[^"]*)*)"|[^,]*)/g);
    if (!parts || parts.length < 8) continue;
    
    const clean = (s: string) => s?.replace(/^,?"?|"?$/g, '').replace(/""/g, '"').trim();
    
    const subject = clean(parts[0]);
    const startDateStr = clean(parts[1]);
    const endDateStr = clean(parts[2]);
    const zoomLink = clean(parts[3]);
    const instructorName = clean(parts[4]);
    const cycleName = clean(parts[5]);
    const status = clean(parts[6]);
    const activityType = clean(parts[7]);
    const topic = parts[8] ? clean(parts[8]) : null;
    const notes = parts[9] ? clean(parts[9]) : null;
    
    // Find cycle
    const cycleId = cycleCache.get(cycleName);
    if (!cycleId) {
      missingCycles.add(cycleName);
      skipped++;
      continue;
    }
    
    // Find instructor
    const instructorId = instructorCache.get(instructorName);
    if (!instructorId) {
      missingInstructors.add(instructorName);
      skipped++;
      continue;
    }
    
    // Parse dates
    const startDate = parseDate(startDateStr);
    const endDate = parseDate(endDateStr);
    if (!startDate) {
      skipped++;
      continue;
    }
    
    // Check if meeting already exists
    const scheduledDate = new Date(startDate.toISOString().split('T')[0]);
    const startTime = new Date(`1970-01-01T${startDate.toISOString().split('T')[1]}`);
    const endTime = endDate ? new Date(`1970-01-01T${endDate.toISOString().split('T')[1]}`) : startTime;
    
    const existing = await prisma.meeting.findFirst({
      where: {
        cycleId,
        scheduledDate,
        startTime,
      }
    });
    
    if (existing) {
      skipped++;
      continue;
    }
    
    try {
      await prisma.meeting.create({
        data: {
          cycleId,
          instructorId,
          scheduledDate,
          startTime,
          endTime,
          status: mapStatus(status),
          activityType: mapActivityType(activityType),
          topic: topic && topic !== '-' && topic !== '.' ? topic : null,
          notes: notes && notes !== '-' && notes !== '.' ? notes : null,
          zoomJoinUrl: zoomLink && zoomLink !== '-' ? zoomLink : null,
          revenue: new Prisma.Decimal(0),
          instructorPayment: new Prisma.Decimal(0),
          profit: new Prisma.Decimal(0),
        }
      });
      imported++;
      
      if (imported % 100 === 0) {
        console.log(`  Imported ${imported}...`);
      }
    } catch (err: any) {
      errors++;
      if (errors < 5) console.error(`Error on line ${i}: ${err.message}`);
    }
  }
  
  console.log(`\n✅ Import complete!`);
  console.log(`   Imported: ${imported}`);
  console.log(`   Skipped: ${skipped} (existing or missing refs)`);
  console.log(`   Errors: ${errors}`);
  
  if (missingCycles.size > 0) {
    console.log(`\n⚠️ Missing cycles (${missingCycles.size}):`);
    [...missingCycles].slice(0, 10).forEach(c => console.log(`   - ${c}`));
    if (missingCycles.size > 10) console.log(`   ... and ${missingCycles.size - 10} more`);
  }
  
  if (missingInstructors.size > 0) {
    console.log(`\n⚠️ Missing instructors (${missingInstructors.size}):`);
    [...missingInstructors].slice(0, 10).forEach(i => console.log(`   - ${i}`));
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
