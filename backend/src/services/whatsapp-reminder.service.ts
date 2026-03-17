/**
 * WhatsApp Reminder Service
 * - 08:00 morning reminder (WhatsApp) for instructors with meetings today
 * - 08:00 unresolved alert (WhatsApp) to management for yesterday's missing statuses
 * - Pre-meeting reminder (1h before) via WhatsApp
 * - 22:00 evening status check poll
 */

import { prisma } from '../utils/prisma.js';
import { sendWhatsApp, sendWhatsAppPoll } from './messaging.js';
import { generateMeetingMagicLink } from './instructor-reminder.service.js';

const APP_URL = process.env.FRONTEND_URL || 'https://crm.orma-ai.com';
const TZ = 'Asia/Jerusalem';

// In-memory set to track pre-meeting reminders sent this server session
const preMeetingRemindersSent = new Set<string>();

// Admin phone for notifications
const ADMIN_PHONE = process.env.ADMIN_PHONE || '972528746137';

/**
 * Get start-of-day and end-of-day in Israel timezone, DST-aware.
 * Returns UTC Date objects suitable for Prisma range queries.
 * offsetDays=0 → today, offsetDays=-1 → yesterday, etc.
 */
function getIsraelDayBounds(offsetDays = 0): { start: Date; end: Date } {
  const now = new Date();
  // Get current Israel date string e.g. "2026-03-17"
  const israelDateStr = new Intl.DateTimeFormat('sv', { timeZone: TZ }).format(now);
  // UTC midnight of that calendar date
  const utcMidnight = new Date(`${israelDateStr}T00:00:00Z`);
  // How many hours ahead is Israel at UTC midnight? (2 in winter, 3 in summer)
  const israelHourAtUTCMidnight = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }).format(utcMidnight)
  );
  // Israel midnight in UTC = UTC midnight minus Israel offset
  const israelMidnightUTC = new Date(utcMidnight.getTime() - israelHourAtUTCMidnight * 3_600_000);
  const start = new Date(israelMidnightUTC.getTime() + offsetDays * 86_400_000);
  const end   = new Date(start.getTime() + 86_400_000);
  return { start, end };
}

/**
 * Get current time in Israel as total minutes since midnight (DST-aware)
 */
function getCurrentTimeIsraelMinutes(): number {
  const now = new Date();
  const h = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }).format(now));
  const m = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: TZ, minute: 'numeric' }).format(now));
  return h * 60 + m;
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
  const { start, end } = getIsraelDayBounds();

  try {
    const meetings = await prisma.meeting.findMany({
      where: {
        scheduledDate: { gte: start, lt: end },
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
 * A2) Morning unresolved alert — 08:00 Israel time
 * If meetings from YESTERDAY still have status = 'scheduled' (no instructor response),
 * send a WhatsApp alert to all management users (admin/manager with phone).
 */
export async function sendMorningUnresolvedAlert(): Promise<void> {
  console.log('[WhatsApp] Running morning unresolved alert job...');

  // Get yesterday in Israel time (DST-aware range)
  const { start, end } = getIsraelDayBounds(-1);

  try {
    const unresolved = await prisma.meeting.findMany({
      where: { scheduledDate: { gte: start, lt: end }, status: 'scheduled' },
      include: {
        cycle: { include: { branch: true, course: true } },
        instructor: true,
      },
      orderBy: { startTime: 'asc' },
    });

    if (!unresolved.length) {
      console.log('[WhatsApp] No unresolved meetings from yesterday — all good ✓');
      return;
    }

    // Build message
    // Use midday of the day (start + 12h) for Hebrew display to avoid edge cases
    const yesterdayMidday = new Date(start.getTime() + 12 * 3_600_000);
    const dateStr = yesterdayMidday.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
    const lines = [`⚠️ פגישות ללא דיווח סטטוס מ-${dateStr}:`];
    for (const m of unresolved) {
      const time = formatTimeFromDate(m.startTime);
      const instr = m.instructor?.name || 'לא ידוע';
      const cycleName = m.cycle?.name || '';
      const branch = m.cycle?.branch?.name || '';
      lines.push(`• ${cycleName} | ${branch} | ${time} | מדריך: ${instr}`);
    }
    lines.push(`\nסה"כ: ${unresolved.length} פגישות. נא לבדוק ב-CRM.`);
    const message = lines.join('\n');

    // Get management phones: users with role admin/manager who have a phone
    const mgmtUsers = await prisma.user.findMany({
      where: { role: { in: ['admin', 'manager'] }, phone: { not: null }, isActive: true },
      select: { phone: true, name: true },
    });

    // Unique phone set — always include ADMIN_PHONE as fallback
    const phones = new Set<string>([ADMIN_PHONE]);
    for (const u of mgmtUsers) {
      if (u.phone) phones.add(u.phone.replace(/\D/g, ''));
    }

    for (const phone of phones) {
      const result = await sendWhatsApp({ phone, message });
      console.log(`[WhatsApp] Unresolved alert → ${phone}: ${result.success ? '✓' : result.error}`);
    }
  } catch (error: any) {
    console.error('[WhatsApp] Error in morning unresolved alert:', error.message);
  }
}

/**
 * B) Pre-meeting reminder — 1 hour before meeting (run every 15 min)
 */
export async function sendPreMeetingReminders(): Promise<void> {
  const { start, end } = getIsraelDayBounds();
  const nowMin = getCurrentTimeIsraelMinutes();
  const windowMin = nowMin + 55;
  const windowMax = nowMin + 70;

  try {
    const meetings = await prisma.meeting.findMany({
      where: { scheduledDate: { gte: start, lt: end }, status: 'scheduled' },
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
  const { start, end } = getIsraelDayBounds();

  try {
    const meetings = await prisma.meeting.findMany({
      where: { scheduledDate: { gte: start, lt: end }, status: 'scheduled' },
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
