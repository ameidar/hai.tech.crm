import { google } from 'googleapis';
import path from 'path';

const SA_KEY_PATH = path.join(process.cwd(), 'google-calendar-sa.json');
const CALENDAR_ID = 'info@hai.tech';
const TIMEZONE = 'Asia/Jerusalem';

function getCalendarClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: SA_KEY_PATH,
    scopes: ['https://www.googleapis.com/auth/calendar'],
    clientOptions: { subject: 'info@hai.tech' },
  });
  return google.calendar({ version: 'v3', auth });
}

export async function getAvailableSlots(date: string): Promise<string[]> {
  const calendar = getCalendarClient();
  
  // Query freeBusy using Israel timezone — API handles DST correctly
  const freeBusy = await calendar.freebusy.query({
    requestBody: {
      timeMin: `${date}T08:00:00+02:00`,
      timeMax: `${date}T18:00:00+02:00`,
      timeZone: TIMEZONE,
      items: [{ id: CALENDAR_ID }],
    },
  });

  const busySlots = freeBusy.data.calendars?.[CALENDAR_ID]?.busy || [];
  
  console.log(`[CALENDAR] Busy slots for ${date}:`, JSON.stringify(busySlots));
  
  // Generate 30-min slots between 09:00-17:30 Israel time
  const allSlots: string[] = [];
  for (let hour = 9; hour < 18; hour++) {
    for (let min = 0; min < 60; min += 30) {
      if (hour === 17 && min === 30) continue;
      allSlots.push(`${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`);
    }
  }
  allSlots.push('17:30');

  // Filter out busy slots — convert everything to comparable timestamps
  const available = allSlots.filter(slot => {
    // Create slot times as Israel local time — use the date string directly
    // We compare against busy periods which come back as UTC from the API
    const slotLocalStr = `${date}T${slot}:00`;
    
    // Get the UTC offset for this specific date/time in Israel
    const tempDate = new Date(slotLocalStr + '+02:00'); // approximate for offset calc
    const israelOffset = getIsraelOffset(tempDate);
    const offsetStr = israelOffset === 3 ? '+03:00' : '+02:00';
    
    const slotStart = new Date(`${date}T${slot}:00${offsetStr}`);
    const slotEnd = new Date(slotStart.getTime() + 30 * 60000);
    
    return !busySlots.some(busy => {
      const busyStart = new Date(busy.start!);
      const busyEnd = new Date(busy.end!);
      return slotStart < busyEnd && slotEnd > busyStart;
    });
  });

  console.log(`[CALENDAR] Available slots for ${date}:`, available.join(', '));
  return available;
}

// Determine Israel UTC offset (2 or 3) based on DST rules
function getIsraelOffset(date: Date): number {
  // Israel DST: last Friday before April 2 → last Sunday before October 1
  // Simplified: March-October = +3, November-February = +2
  const month = date.getUTCMonth(); // 0-indexed
  if (month >= 2 && month <= 9) return 3; // Mar-Oct: IDT (UTC+3)
  return 2; // Nov-Feb: IST (UTC+2)
}

export async function bookAppointment(
  date: string,
  time: string,
  customerName: string,
  phone?: string,
  notes?: string
): Promise<{ success: boolean; eventId?: string; error?: string }> {
  try {
    const calendar = getCalendarClient();
    
    const startDateTime = `${date}T${time}:00`;
    const [h, m] = time.split(':').map(Number);
    const endH = m === 30 ? h + 1 : h;
    const endM = m === 30 ? 0 : 30;
    const endTime = `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;
    const endDateTime = `${date}T${endTime}:00`;
    
    const description = [
      `לקוח: ${customerName}`,
      phone ? `טלפון: ${phone}` : '',
      notes ? `הערות: ${notes}` : '',
      '',
      'נקבע אוטומטית ע"י נועה (Vapi AI)',
    ].filter(Boolean).join('\n');

    const event = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: {
        summary: `פגישת היכרות - ${customerName}`,
        description,
        start: { dateTime: startDateTime, timeZone: TIMEZONE },
        end: { dateTime: endDateTime, timeZone: TIMEZONE },
        reminders: { useDefault: true },
      },
    });

    return { success: true, eventId: event.data.id || undefined };
  } catch (error: any) {
    console.error('[GOOGLE CALENDAR] Error booking appointment:', error);
    return { success: false, error: error.message };
  }
}
