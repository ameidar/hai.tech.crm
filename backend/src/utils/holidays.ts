// Israeli holidays utility using Hebcal API

interface HebcalItem {
  title: string;
  date: string;
  category: string;
}

interface HebcalResponse {
  items: HebcalItem[];
}

// Cache holidays by year
const holidayCache: Map<number, Set<string>> = new Map();

/**
 * Fetch Israeli holidays for a given year from Hebcal API
 */
export async function fetchHolidays(year: number): Promise<Set<string>> {
  // Check cache first
  if (holidayCache.has(year)) {
    return holidayCache.get(year)!;
  }

  try {
    const response = await fetch(
      `https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&min=off&mod=off&nx=off&year=${year}&month=x&ss=off&mf=off&c=off&geo=none`
    );
    
    if (!response.ok) {
      console.error(`Failed to fetch holidays for ${year}`);
      return new Set();
    }

    const data = await response.json() as HebcalResponse;
    
    // Filter for major holidays that would cancel classes
    const majorHolidays = [
      'Rosh Hashana', 'Yom Kippur', 'Sukkot', 'Shmini Atzeret', 'Simchat Torah',
      'Pesach', 'Shavuot', 'Yom HaAtzma\'ut', 'Yom HaZikaron',
      'Purim', 'Chanukah', 'Tish\'a B\'Av'
    ];

    const holidays = new Set<string>();
    
    for (const item of data.items) {
      // Add all major holidays
      const isHoliday = majorHolidays.some(h => item.title.includes(h)) ||
                       item.title.includes('Erev') ||
                       item.category === 'holiday';
      
      if (isHoliday) {
        holidays.add(item.date);
      }
    }

    // Cache the result
    holidayCache.set(year, holidays);
    
    return holidays;
  } catch (error) {
    console.error(`Error fetching holidays for ${year}:`, error);
    return new Set();
  }
}

/**
 * Check if a date is a holiday
 */
export async function isHoliday(date: Date): Promise<boolean> {
  const year = date.getFullYear();
  const holidays = await fetchHolidays(year);
  const dateStr = date.toISOString().split('T')[0];
  return holidays.has(dateStr);
}

/**
 * Check if a date is a Friday or Saturday (Shabbat)
 */
export function isShabbat(date: Date): boolean {
  const day = date.getDay();
  return day === 5 || day === 6; // Friday or Saturday
}

/**
 * Calculate end date for a cycle based on start date, day of week, and number of meetings
 * Skips holidays and Shabbat
 */
export async function calculateCycleEndDate(
  startDate: Date,
  dayOfWeek: number, // 0 = Sunday, 1 = Monday, etc.
  totalMeetings: number
): Promise<{ endDate: Date; meetingDates: Date[] }> {
  const meetingDates: Date[] = [];
  let currentDate = new Date(startDate);
  
  // Adjust to the correct day of week if needed
  while (currentDate.getDay() !== dayOfWeek) {
    currentDate.setDate(currentDate.getDate() + 1);
  }

  // Fetch holidays for relevant years
  const startYear = currentDate.getFullYear();
  const endYear = startYear + 1; // Assume cycles don't span more than a year
  await Promise.all([fetchHolidays(startYear), fetchHolidays(endYear)]);

  while (meetingDates.length < totalMeetings) {
    const dateStr = currentDate.toISOString().split('T')[0];
    const holidays = await fetchHolidays(currentDate.getFullYear());
    
    // Check if this date is valid (not a holiday, not Shabbat)
    if (!holidays.has(dateStr) && !isShabbat(currentDate)) {
      meetingDates.push(new Date(currentDate));
    }
    
    // Move to next week
    currentDate.setDate(currentDate.getDate() + 7);
  }

  return {
    endDate: meetingDates[meetingDates.length - 1],
    meetingDates,
  };
}

/**
 * Convert day name to day number
 */
export function dayNameToNumber(dayName: string): number {
  const days: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };
  return days[dayName.toLowerCase()] ?? 0;
}

/**
 * Get holidays between two dates
 */
export async function getHolidaysBetween(startDate: Date, endDate: Date): Promise<string[]> {
  const holidays: string[] = [];
  const startYear = startDate.getFullYear();
  const endYear = endDate.getFullYear();
  
  for (let year = startYear; year <= endYear; year++) {
    const yearHolidays = await fetchHolidays(year);
    for (const holiday of yearHolidays) {
      const holidayDate = new Date(holiday);
      if (holidayDate >= startDate && holidayDate <= endDate) {
        holidays.push(holiday);
      }
    }
  }
  
  return holidays.sort();
}
