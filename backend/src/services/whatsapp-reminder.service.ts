/**
 * WhatsApp Reminder Service
 * - 08:00 morning reminder (WhatsApp) for instructors with meetings today
 * - Pre-meeting reminder (1h before) via WhatsApp
 * - 22:00 evening status check poll
 */

import { prisma } from '../utils/prisma.js';
import { sendWhatsApp, sendWhatsAppPoll } from './messaging.js';
import { generateMeetingMagicLink } from './instructor-reminder.service.js';

const APP_URL = process.env.FRONTEND_URL || 'https://crm.orma-ai.com';

// Israel timezone offset in hours (UTC+2 in winter, UTC+3 in summer)
const ISRAEL_OFFSET_HOURS = 2;

// In-memory set to track pre-meeting reminders sent this server session
const preMeetingRemindersSent = new Set<string>();

// Admin phone for notifications
const ADMIN_PHONE = process.env.ADMIN_PHONE || '972528746137';

/**
 * Get today's date in Israel time as Date (midnight UTC of that date)
 */
function getTodayIsraelDate(): Date {
  const now = new Date();
  const israelTime = new Date(now.getTime() + ISRAEL_OFFSET_HOURS * 60 * 60 * 1000);
  const dateStr = israelTime.toISOString().split('T')[0];
  return new Date(dateStr + 'T00:00:00.000Z');
}

/**
 * Get current time in Israel as total minutes since midnight
 */
function getCurrentTimeIsraelMinutes(): number {
  const now = new Date();
  const israelTime = new Date(now.getTime() + ISRAEL_OFFSET_HOURS * 60 * 60 * 1000);
  return israelTime.getUTCHours() * 60 + israelTime.getUTCMinutes();
}

/**
 * Extract HH:MM from a DateTime (used for @db.Time fields)
 */
function formatTimeFromDate(dt: Date | string | null): string {
  if (!dt) return '';
  const d = typeof dt === 'string' ? new Date(dt) : dt;
  const h = d.getUTCHours().toString().padStart(2, '0');
  const m = d.getUTCMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Convert HH:MM (or Date) to minutes since midnight
 */
function toMinutes(dt: Date | string | null): number {
  if (!dt) return 0;
  if (typeof dt === 'string') {
    const [h, m] = dt.substring(0, 5).split(':').map(Number);
    return h * 60 + m;
  }
  return dt.getUTCHours() * 60 + dt.getUTCMinutes();
}

/**
 * Build WhatsApp message for a single meeting
 */
function buildMeetingMessage(instructorName: string, meeting: any, meetingLink?: string): string {
  const cycleName = meeting.cycle?.name || '';
  const branchName = meeting.cycle?.branch?.name || '';
  const time = formatTimeFromDate(meeting.startTime);
  const zoom = meeting.zoomJoinUrl ? `\n🔗 קישור זום: ${meeting.zoomJoinUrl}` : '';
  const hostKey = meeting.zoomHostKey ? `\n🔑 קוד מנהל: ${meeting.zoomHostKey}` : '';
  const link = meetingLink ? `\n📋 לינק לפגישה: ${meetingLink}` : '';
  return `שלום ${instructorName} 👋\nתזכורת לשיעור היום:\n📚 ${cycleName}\n🏫 ${branchName}\n🕐 שעה: ${time}${zoom}${hostKey}${link}\nבהצלחה! 🙂`;
}

/**
 * Build combined WhatsApp message for multiple meetings
 */
function buildMorningMessage(instructorName: string, meetings: any[], meetingLinks?: Map<string, string>): string {
  if (meetings.length === 1) return buildMeetingMessage(instructorName, meetings[0], meetingLinks?.get(meetings[0].id));

  const lines = [`שלום ${instructorName} 👋\nתזכורת לשיעורים שלך היום:`];
  for (const m of meetings) {
    const time = formatTimeFromDate(m.startTime);
    const zoom = m.zoomJoinUrl ? ` | זום: ${m.zoomJoinUrl}` : '';
    const link = meetingLinks?.get(m.id) ? `\n📋 ${meetingLinks.get(m.id)}` : '';
    lines.push(`\n📚 ${m.cycle?.name || ''} | 🏫 ${m.cycle?.branch?.name || ''} | 🕐 ${time}${zoom}${link}`);
  }
  lines.push('\nבהצלחה! 🙂');
  return lines.join('');
}

/**
 * A) Morning reminders — 08:00 Israel time
 */
export async function sendMorningWhatsAppReminders(): Promise<void> {
  console.log('[WhatsApp] Running morning reminder job...');
  const today = getTodayIsraelDate();

  try {
    const meetings = await prisma.meeting.findMany({
      where: {
        scheduledDate: today,
        status: 'scheduled',
      },
      include: {
        cycle: { include: { branch: true, course: true } },
        instructor: true,
      },
      orderBy: { startTime: 'asc' },
    });

    const instructorMeetings = meetings.filter(m => m.instructor?.phone);
    console.log(`[WhatsApp] Found ${instructorMeetings.length} meetings with phone today`);

    // Group by instructor
    const byInstructor = new Map<string, { instructor: any; meetings: any[] }>();
    for (const m of instructorMeetings) {
      const key = m.instructor!.id;
      if (!byInstructor.has(key)) {
        byInstructor.set(key, { instructor: m.instructor, meetings: [] });
      }
      byInstructor.get(key)!.meetings.push(m);
    }

    for (const { instructor, meetings: instrMeetings } of byInstructor.values()) {
      // Generate magic links for each meeting (valid 24h, no login required)
      const meetingLinks = new Map<string, string>();
      for (const m of instrMeetings) {
        meetingLinks.set(m.id, generateMeetingMagicLink(instructor.id, m.id, APP_URL));
      }
      const message = buildMorningMessage(instructor.name, instrMeetings, meetingLinks);
      const result = await sendWhatsApp({ phone: instructor.phone!, message });
      console.log(`[WhatsApp] Morning to ${instructor.name}: ${result.success ? '✓' : result.error}`);
    }
  } catch (error: any) {
    console.error('[WhatsApp] Error in morning reminder job:', error.message);
  }
}

/**
 * B) Pre-meeting reminder — 1 hour before meeting (run every 15 min)
 */
export async function sendPreMeetingReminders(): Promise<void> {
  const today = getTodayIsraelDate();
  const nowMin = getCurrentTimeIsraelMinutes();
  const windowMin = nowMin + 55;
  const windowMax = nowMin + 70;

  try {
    const meetings = await prisma.meeting.findMany({
      where: { scheduledDate: today, status: 'scheduled' },
      include: {
        cycle: { include: { branch: true, course: true } },
        instructor: true,
      },
    });

    for (const m of meetings) {
      if (!m.instructor?.phone) continue;
      if (preMeetingRemindersSent.has(m.id)) continue;

      const meetMin = toMinutes(m.startTime);
      if (meetMin < windowMin || meetMin > windowMax) continue;

      const meetingLink = generateMeetingMagicLink(m.instructor.id, m.id, APP_URL);
      const message = buildMeetingMessage(m.instructor.name, m, meetingLink);
      const result = await sendWhatsApp({ phone: m.instructor.phone!, message });
      if (result.success) {
        preMeetingRemindersSent.add(m.id);
        console.log(`[WhatsApp] Pre-meeting reminder sent to ${m.instructor.name}`);
      }
    }
  } catch (error: any) {
    console.error('[WhatsApp] Error in pre-meeting reminder job:', error.message);
  }
}

/**
 * C) Evening status check — 22:00 Israel time
 */
export async function sendEveningStatusCheck(): Promise<void> {
  console.log('[WhatsApp] Running evening status check job...');
  const today = getTodayIsraelDate();

  try {
    const meetings = await prisma.meeting.findMany({
      where: { scheduledDate: today, status: 'scheduled' },
      include: {
        cycle: { include: { branch: true, course: true } },
        instructor: true,
      },
    });

    const instructorMeetings = meetings.filter(m => m.instructor?.phone);
    console.log(`[WhatsApp] Found ${instructorMeetings.length} unresolved meetings`);

    for (const m of instructorMeetings) {
      const instr = m.instructor!;
      const time = formatTimeFromDate(m.startTime);
      const question = `שלום ${instr.name}, האם העברת את השיעור היום?\n📚 ${m.cycle?.name || ''}\n🏫 ${m.cycle?.branch?.name || ''}\n🕐 שעה: ${time}`;

      const result = await sendWhatsAppPoll({
        phone: instr.phone!,
        question,
        options: ['✅ כן, העברתי', '❌ לא, לא העברתי'],
      });

      if (result.success) {
        await prisma.$executeRaw`
          INSERT INTO whatsapp_status_reminders (meeting_id, instructor_id, instructor_phone, type)
          VALUES (${m.id}, ${instr.id}, ${instr.phone}, 'status_check')
        `;
        console.log(`[WhatsApp] Status check sent to ${instr.name}`);
      }
    }
  } catch (error: any) {
    console.error('[WhatsApp] Error in evening status check job:', error.message);
  }
}

/**
 * Normalize phone: 972528746137 or 0528746137 or 528746137 → all formats searchable
 */
function normalizePhone(phone: string): string[] {
  const digits = phone.replace(/\D/g, '');
  const variants = new Set<string>();
  variants.add(digits);
  if (digits.startsWith('972')) {
    variants.add('0' + digits.slice(3)); // 0528746137
    variants.add(digits.slice(3));       // 528746137
  } else if (digits.startsWith('0')) {
    variants.add('972' + digits.slice(1)); // 972528746137
    variants.add(digits.slice(1));         // 528746137
  } else {
    variants.add('972' + digits);          // 972528746137
    variants.add('0' + digits);            // 0528746137
  }
  return Array.from(variants);
}

/**
 * Handle incoming WhatsApp status reply from instructor
 */
export async function handleStatusReply(phone: string, isYes: boolean): Promise<void> {
  try {
    const phoneVariants = normalizePhone(phone);
    const reminders = await prisma.$queryRaw<any[]>`
      SELECT wsr.id, wsr.meeting_id, wsr.instructor_id,
             i.name as instructor_name, c.name as cycle_name,
             m.notes as meeting_notes
      FROM whatsapp_status_reminders wsr
      JOIN meetings m ON m.id = wsr.meeting_id
      JOIN instructors i ON i.id = wsr.instructor_id
      JOIN cycles c ON c.id = m.cycle_id
      WHERE wsr.instructor_phone = ANY(${phoneVariants})
        AND wsr.type = 'status_check'
        AND wsr.response IS NULL
        AND wsr.sent_at > NOW() - INTERVAL '12 hours'
      ORDER BY wsr.sent_at DESC
      LIMIT 1
    `;

    if (!reminders.length) {
      console.log(`[WhatsApp] No pending reminder for phone ${phone}`);
      return;
    }

    const r = reminders[0];

    if (isYes) {
      await prisma.$executeRaw`
        UPDATE whatsapp_status_reminders
        SET response = 'yes', responded_at = NOW(), auto_completed = true
        WHERE id = ${r.id}
      `;

      const currentNotes = r.meeting_notes || '';
      const newNotes = (currentNotes + '\n[אוטומטי] מדריך דיווח שהשיעור התקיים דרך וואטסאפ. לא מילא עצמאית.').trim();

      await prisma.meeting.update({
        where: { id: r.meeting_id },
        data: { status: 'completed', notes: newNotes },
      });

      await sendWhatsApp({ phone, message: `תודה ${r.instructor_name}! רשמנו שהשיעור "${r.cycle_name}" התקיים 👍` });
      await sendWhatsApp({ phone: ADMIN_PHONE, message: `ℹ️ מדריך ${r.instructor_name} אישר שיעור "${r.cycle_name}" דרך וואטסאפ (לא מילא עצמאית)` });

      console.log(`[WhatsApp] Meeting ${r.meeting_id} auto-completed for ${r.instructor_name}`);
    } else {
      await prisma.$executeRaw`
        UPDATE whatsapp_status_reminders
        SET response = 'no', responded_at = NOW()
        WHERE id = ${r.id}
      `;

      const currentNotes = r.meeting_notes || '';
      const cancelNotes = (currentNotes + '\n[אוטומטי] מדריך דיווח שהשיעור לא התקיים דרך וואטסאפ.').trim();

      await prisma.meeting.update({
        where: { id: r.meeting_id },
        data: { status: 'cancelled', notes: cancelNotes },
      });

      await sendWhatsApp({ phone: ADMIN_PHONE, message: `🚨 מדריך ${r.instructor_name} דיווח שלא העביר שיעור "${r.cycle_name}" היום — הפגישה עברה לסטטוס בוטל.` });
      await sendWhatsApp({ phone, message: `תודה על העדכון ${r.instructor_name}. נצור איתך קשר בנוגע לשיעור.` });

      console.log(`[WhatsApp] No-show reported for ${r.instructor_name} — meeting cancelled`);
    }
  } catch (error: any) {
    console.error('[WhatsApp] Error handling status reply:', error.message);
  }
}
