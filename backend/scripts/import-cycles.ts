import { PrismaClient, DayOfWeek, CycleType, CycleStatus, ActivityType, BranchType, CourseCategory } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// Day of week mapping
const dayMapping: Record<string, DayOfWeek> = {
  'ראשון': 'sunday',
  'שני': 'monday',
  'שלישי': 'tuesday',
  'רביעי': 'wednesday',
  'חמישי': 'thursday',
  'שישי': 'friday',
  'שבת': 'saturday',
};

// Cycle type mapping
function getCycleType(typeStr: string): CycleType {
  if (typeStr.includes('תשלום פר ילד')) return 'institutional_per_child';
  if (typeStr === 'מוסדי') return 'institutional_fixed';
  if (typeStr === 'פרטי') return 'private';
  return 'institutional_fixed'; // default
}

// Parse date from DD/MM/YYYY to Date
function parseDate(dateStr: string): Date {
  if (!dateStr) throw new Error('Empty date string');
  const parts = dateStr.split('/');
  if (parts.length !== 3) throw new Error(`Invalid date format: ${dateStr}`);
  const [day, month, year] = parts;
  return new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00Z`);
}

// Parse time to Date (for @db.Time field)
function parseTime(timeStr: string): Date {
  if (!timeStr) throw new Error('Empty time string');
  const parts = timeStr.split(':');
  const hours = parts[0] || '00';
  const minutes = parts[1] || '00';
  return new Date(`1970-01-01T${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:00Z`);
}

// Calculate end time (add 1 hour)
function calculateEndTime(startTimeStr: string): Date {
  if (!startTimeStr) throw new Error('Empty start time string');
  const parts = startTimeStr.split(':');
  const hours = parseInt(parts[0] || '0', 10);
  const minutes = parseInt(parts[1] || '0', 10);
  const endHours = (hours + 1) % 24;
  return new Date(`1970-01-01T${endHours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00Z`);
}

// Calculate end date based on start date and number of meetings
function calculateEndDate(startDate: Date, totalMeetings: number): Date {
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + (totalMeetings * 7)); // Approximate: one meeting per week
  return endDate;
}

// Parse CSV line properly handling quoted fields
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
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

async function main() {
  console.log('Starting cycle import...\n');

  // Get or create general branch
  let generalBranch = await prisma.branch.findFirst({
    where: { name: 'כללי' }
  });
  
  if (!generalBranch) {
    generalBranch = await prisma.branch.create({
      data: { 
        name: 'כללי', 
        type: 'community_center' as BranchType,
        address: '',
        isActive: true 
      }
    });
    console.log('Created general branch: כללי');
  }

  // Get or create general course
  let generalCourse = await prisma.course.findFirst({
    where: { name: 'קורס כללי' }
  });
  
  if (!generalCourse) {
    generalCourse = await prisma.course.create({
      data: { 
        name: 'קורס כללי', 
        description: 'קורס כללי לייבוא',
        category: 'programming' as CourseCategory,
        isActive: true 
      }
    });
    console.log('Created general course: קורס כללי');
  }

  // Get or create placeholder instructor for imported cycles
  let placeholderInstructor = await prisma.instructor.findFirst({
    where: { name: 'מדריך - ייבוא' }
  });
  
  if (!placeholderInstructor) {
    placeholderInstructor = await prisma.instructor.create({
      data: { 
        name: 'מדריך - ייבוא',
        phone: '0000000000',
        email: 'import@placeholder.local',
        isActive: true 
      }
    });
    console.log('Created placeholder instructor: מדריך - ייבוא');
  }

  // Read CSV
  const csvPath = '/home/opc/.clawdbot/media/inbound/bcbd80a5-a9f7-4ff6-8cf5-d6a5f2593192.csv';
  let csvContent = fs.readFileSync(csvPath, 'utf-8');
  
  // Remove BOM if present
  if (csvContent.charCodeAt(0) === 0xFEFF) {
    csvContent = csvContent.slice(1);
  }
  
  // Normalize line endings
  csvContent = csvContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  
  const lines = csvContent.split('\n').filter(line => line.trim());
  
  // Skip header
  const dataLines = lines.slice(1);
  
  console.log(`Found ${dataLines.length} cycles to import\n`);

  const importLog: any[] = [];
  let successCount = 0;
  let errorCount = 0;

  for (const line of dataLines) {
    const fields = parseCSVLine(line);
    
    // CSV columns:
    // 0: שם המחזור
    // 1: מדריך ראשי
    // 2: מחיר לילד עבור מחזור מוסדי
    // 3: סכום לתשלום עבור פגישה
    // 4: סוג המחזור - מוסדי/פרטי
    // 5: שעת התחלה
    // 6: יום בשבוע
    // 7: סניף מקושר למחזור
    // 8: תאריך תחילת מחזור
    // 9: סטטוס רישום
    // 10: מספר מפגשים
    
    const name = fields[0];
    const instructorName = fields[1];
    const pricePerChildStr = fields[2];
    const meetingRevenueStr = fields[3];
    const cycleTypeStr = fields[4];
    const startTimeStr = fields[5];
    const dayOfWeekStr = fields[6];
    const branchName = fields[7];
    const startDateStr = fields[8];
    const totalMeetingsStr = fields[10];

    if (!name) continue;

    try {
      const cycleType = getCycleType(cycleTypeStr || '');
      const dayOfWeek = dayMapping[dayOfWeekStr] || 'sunday';
      const startTime = parseTime(startTimeStr);
      const endTime = calculateEndTime(startTimeStr);
      const startDate = parseDate(startDateStr);
      const totalMeetings = Math.round(parseFloat(totalMeetingsStr) || 12);
      const endDate = calculateEndDate(startDate, totalMeetings);
      const durationMinutes = 60; // Default 1 hour
      
      // Set price based on type
      let pricePerStudent: number | null = null;
      let meetingRevenue: number | null = null;
      
      if (cycleType === 'institutional_per_child' && pricePerChildStr) {
        pricePerStudent = parseFloat(pricePerChildStr);
      } else if (cycleType === 'institutional_fixed' && meetingRevenueStr) {
        meetingRevenue = parseFloat(meetingRevenueStr);
      }

      const cycle = await prisma.cycle.create({
        data: {
          name,
          branchId: generalBranch.id,
          courseId: generalCourse.id,
          instructorId: placeholderInstructor.id,
          type: cycleType,
          status: 'active' as CycleStatus,
          dayOfWeek,
          startTime,
          endTime,
          startDate,
          endDate,
          durationMinutes,
          totalMeetings,
          remainingMeetings: totalMeetings,
          activityType: 'frontal' as ActivityType,
          pricePerStudent,
          meetingRevenue,
        }
      });

      successCount++;
      importLog.push({
        status: 'success',
        name,
        cycleId: cycle.id,
        type: cycleType,
        startDate: startDateStr,
        totalMeetings,
        pricePerStudent,
        meetingRevenue,
        originalInstructor: instructorName,
        originalBranch: branchName,
        createdAt: cycle.createdAt
      });

      console.log(`✓ Imported: ${name}`);
    } catch (error: any) {
      errorCount++;
      importLog.push({
        status: 'error',
        name,
        fields: fields.slice(0, 11),
        error: error.message
      });
      console.error(`✗ Failed: ${name} - ${error.message}`);
    }
  }

  // Write log file
  const logPath = path.join(__dirname, `import-log-${new Date().toISOString().replace(/:/g, '-')}.json`);
  fs.writeFileSync(logPath, JSON.stringify(importLog, null, 2));

  console.log('\n========================================');
  console.log(`Import completed!`);
  console.log(`Success: ${successCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`Log file: ${logPath}`);
  console.log('========================================');

  await prisma.$disconnect();
}

main().catch(console.error);
