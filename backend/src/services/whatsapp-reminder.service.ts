/**
 * WhatsApp Reminder Service
 * - 08:00 morning reminder (WhatsApp) for instructors with meetings today
 * - 08:00 unresolved alert (WhatsApp) to management for yesterday's missing statuses
 * - Pre-meeting reminder (1h before) via WhatsApp
 * - 22:00 evening status check poll
 */

import { prisma } from '../utils/prisma.js';
import { meetingRevenueForMeeting } from '../utils/revenue.js';
import { syncCycleProgress } from '../utils/cycle-sync.js';
import { handleCycleCompletion } from './cycle-completion.js';
import { generateMeetingMagicLink } from './instructor-reminder.service.js';
import { reminderEligibleMeetingWhereForDate } from './reminder-eligibility.js';
import {
  calculateInstructorPayment,
  recalculateDailyInstructorPaymentsForMeeting,
} from './instructor-payment.js';
import { checkAndSendNegativeProfitAlert } from './negative-profit-alert.js';
import {
  WhatsAppTemplatePayload,
  WhatsAppCloudResult,
  normalizeWhatsAppCloudPhone,
  sendWhatsAppCloudTemplate,
  sendWhatsAppCloudText,
  templateText,
} from './whatsapp-cloud-templates.js';
import {
  getOperationsWhatsAppRecipients,
  sendOperationsWhatsApp,
} from './operations-notifications.js';

const APP_URL = process.env.FRONTEND_URL || 'https://crm.orma-ai.com';
const TZ = 'Asia/Jerusalem';

// In-memory set to track pre-meeting reminders sent this server session
const preMeetingRemindersSent = new Set<string>();
const PRE_MEETING_EARLIEST_LEAD_MIN = 70;
const PRE_MEETING_LATEST_LEAD_MIN = 30;

/**
 * Get the target Israel calendar date as a UTC midnight Date, for use with @db.Date fields.
 * offsetDays=0 → today, offsetDays=-1 → yesterday, etc.
 *
 * ⚠️  scheduledDate is @db.Date (pure DATE column in PostgreSQL).
 *     Use exact-date equality for Prisma queries — NOT timestamp ranges.
 *     Timestamp ranges cause off-by-one: PostgreSQL casts timestamps to DATE
 *     using UTC, so a meeting stored as 2026-03-18 (DATE) fails the check
 *     `lt: 2026-03-18T22:00:00Z` because DATE '2026-03-18' < DATE '2026-03-18' = false.
 */
function getIsraelDateOnly(offsetDays = 0): Date {
  const now = new Date();
  const israelDateStr = new Intl.DateTimeFormat('sv', { timeZone: TZ }).format(now);
  const [y, m, d] = israelDateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + offsetDays));
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
 * Optional context block appended to a meeting message:
 * how many lessons remain in the cycle and a summary of the previous lesson.
 * Both fields are optional — only rendered when the caller provides them.
 */
type MeetingExtras = {
  remaining?: number;
  remainingAfter?: number;
  lessonNumber?: number;
  totalMeetings?: number;
  lastSummary?: string | null;
};

export function formatLessonProgress(extras?: MeetingExtras, compact = false): string {
  if (!extras) return '';

  if (typeof extras.lessonNumber === 'number' && typeof extras.totalMeetings === 'number') {
    const remainingAfter = typeof extras.remainingAfter === 'number'
      ? extras.remainingAfter
      : Math.max(0, extras.totalMeetings - extras.lessonNumber);
    return compact
      ? `שיעור ${extras.lessonNumber}/${extras.totalMeetings}, נותרו ${remainingAfter}`
      : `📊 שיעור ${extras.lessonNumber} מתוך ${extras.totalMeetings} | נותרו ${remainingAfter} לסיום אחרי השיעור.`;
  }

  if (typeof extras.remaining === 'number') {
    const total = extras.totalMeetings;
    return compact
      ? `נותרו ${extras.remaining}${total ? `/${total}` : ''}`
      : `📊 נותרו ${extras.remaining}${total ? ` מתוך ${total}` : ''} שיעורים במחזור.`;
  }

  return '';
}

function buildExtrasBlock(extras?: MeetingExtras): string {
  if (!extras) return '';
  const parts: string[] = [];
  const progress = formatLessonProgress(extras);
  if (progress) parts.push(progress);
  if (extras.lastSummary !== undefined) {
    const trimmed = (extras.lastSummary || '').trim();
    parts.push(trimmed
      ? `📝 סיכום השיעור הקודם:\n${trimmed}`
      : `📝 אין סיכום לשיעור הקודם.`);
  }
  return parts.length ? `\n\n${parts.join('\n\n')}` : '';
}

export async function getMeetingProgressExtras(meeting: any, options: { includeLastSummary?: boolean } = {}): Promise<MeetingExtras | undefined> {
  const totalMeetings = typeof meeting.cycle?.totalMeetings === 'number'
    ? meeting.cycle.totalMeetings
    : undefined;

  if (typeof totalMeetings !== 'number') {
    return undefined;
  }

  const completedBefore = await prisma.meeting.count({
    where: {
      cycleId: meeting.cycleId,
      status: 'completed',
      deletedAt: null,
      OR: [
        { scheduledDate: { lt: meeting.scheduledDate } },
        { scheduledDate: meeting.scheduledDate, startTime: { lt: meeting.startTime } },
      ],
    },
  });

  const lessonNumber = Math.min(totalMeetings, completedBefore + 1);
  const remainingAfter = Math.max(0, totalMeetings - lessonNumber);
  const extras: MeetingExtras = {
    lessonNumber,
    totalMeetings,
    remainingAfter,
    remaining: Math.max(0, totalMeetings - completedBefore),
  };

  if (options.includeLastSummary) {
    const previous = await prisma.meeting.findFirst({
      where: {
        cycleId: meeting.cycleId,
        status: 'completed',
        OR: [
          { scheduledDate: { lt: meeting.scheduledDate } },
          { scheduledDate: meeting.scheduledDate, startTime: { lt: meeting.startTime } },
        ],
      },
      orderBy: [
        { scheduledDate: 'desc' },
        { startTime: 'desc' },
      ],
      select: { topic: true },
    });
    extras.lastSummary = previous ? previous.topic ?? null : null;
  }

  return extras;
}

/**
 * Build WhatsApp message for a single meeting
 */
function buildMeetingMessage(instructorName: string, meeting: any, meetingLink?: string, extras?: MeetingExtras): string {
  const cycleName = meeting.cycle?.name || '';
  const branchName = meeting.cycle?.branch?.name || '';
  const time = formatTimeFromDate(meeting.startTime);
  const zoom = meeting.zoomJoinUrl ? `\n🔗 קישור זום: ${meeting.zoomJoinUrl}` : '';
  const hostKey = meeting.zoomHostKey ? `\n🔑 קוד מנהל: ${meeting.zoomHostKey}` : '';
  const link = meetingLink ? `\n📋 לינק לפגישה: ${meetingLink}` : '';
  const extrasBlock = buildExtrasBlock(extras);
  return `שלום ${instructorName} 👋\nתזכורת לשיעור היום:\n📚 ${cycleName}\n🏫 ${branchName}\n🕐 שעה: ${time}${zoom}${hostKey}${link}${extrasBlock}\n\nבהצלחה! 🙂`;
}

/**
 * Build combined WhatsApp message for multiple meetings
 */
function buildMorningMessage(instructorName: string, meetings: any[], meetingLinks?: Map<string, string>, meetingExtras?: Map<string, MeetingExtras>): string {
  if (meetings.length === 1) return buildMeetingMessage(instructorName, meetings[0], meetingLinks?.get(meetings[0].id), meetingExtras?.get(meetings[0].id));

  const lines = [`שלום ${instructorName} 👋\nתזכורת לשיעורים שלך היום:`];
  for (const m of meetings) {
    const time = formatTimeFromDate(m.startTime);
    const zoom = m.zoomJoinUrl ? ` | זום: ${m.zoomJoinUrl}` : '';
    const hostKey = m.zoomHostKey ? ` | קוד מנהל: ${m.zoomHostKey}` : '';
    const progress = formatLessonProgress(meetingExtras?.get(m.id), true);
    const progressText = progress ? ` | 📊 ${progress}` : '';
    const link = meetingLinks?.get(m.id) ? `\n📋 ${meetingLinks.get(m.id)}` : '';
    lines.push(`\n📚 ${m.cycle?.name || ''} | 🏫 ${m.cycle?.branch?.name || ''} | 🕐 ${time}${progressText}${zoom}${hostKey}${link}`);
  }
  lines.push('\nבהצלחה! 🙂');
  return lines.join('');
}

function buildMorningScheduleText(meetings: any[], meetingLinks?: Map<string, string>, meetingExtras?: Map<string, MeetingExtras>): string {
  return meetings.map((m) => {
    const time = formatTimeFromDate(m.startTime);
    const zoom = m.zoomJoinUrl ? ` | זום: ${m.zoomJoinUrl}` : '';
    const hostKey = m.zoomHostKey ? ` | קוד מנהל: ${m.zoomHostKey}` : '';
    const progress = formatLessonProgress(meetingExtras?.get(m.id), true);
    const progressText = progress ? ` | ${progress}` : '';
    const link = meetingLinks?.get(m.id) ? ` | דיווח: ${meetingLinks.get(m.id)}` : '';
    return `${time} - ${m.cycle?.name || 'שיעור'} | ${m.cycle?.branch?.name || 'אונליין'}${progressText}${zoom}${hostKey}${link}`;
  }).join('\n');
}

function buildMeetingTitle(meeting: any): string {
  const cycleName = meeting.cycle?.name || meeting.cycle?.course?.name || 'שיעור';
  const branchName = meeting.cycle?.branch?.name;
  return branchName ? `${cycleName} | ${branchName}` : cycleName;
}

function buildMeetingTitleWithProgress(meeting: any, extras?: MeetingExtras): string {
  const progress = formatLessonProgress(extras, true);
  return progress ? `${buildMeetingTitle(meeting)} | ${progress}` : buildMeetingTitle(meeting);
}

export function isPreMeetingReminderDue(nowMin: number, meetMin: number): boolean {
  const leadMin = meetMin - nowMin;
  return leadMin >= PRE_MEETING_LATEST_LEAD_MIN && leadMin <= PRE_MEETING_EARLIEST_LEAD_MIN;
}

async function hasPreMeetingReminderBeenLogged(meetingId: string, instructorPhone: string): Promise<boolean> {
  const phone = normalizeWhatsAppCloudPhone(instructorPhone);
  if (!phone) return false;

  const existing = await prisma.waMessage.findFirst({
    where: {
      direction: 'outbound',
      content: {
        contains: `[תבנית: ${process.env.INSTRUCTOR_PRE_LESSON_WA_TEMPLATE_NAME || 'instructor_pre_lesson_60m'}]`,
      },
      conversation: {
        phone,
      },
      AND: [
        { content: { contains: meetingId } },
      ],
    },
    select: { id: true },
  });

  return Boolean(existing);
}

export function buildInstructorPreLessonTemplatePayload(meeting: any, meetingLink: string, extras?: MeetingExtras): WhatsAppTemplatePayload {
  const message = buildMeetingMessage(meeting.instructor.name, meeting, meetingLink, extras);
  return {
    phone: meeting.instructor.phone,
    contactName: meeting.instructor.name,
    templateName: process.env.INSTRUCTOR_PRE_LESSON_WA_TEMPLATE_NAME || 'instructor_pre_lesson_60m',
    bodyParameters: [
      templateText(meeting.instructor.name, 'מדריך/ה'),
      templateText(buildMeetingTitleWithProgress(meeting, extras), 'שיעור'),
      templateText(meeting.cycle?.branch?.name || (meeting.zoomJoinUrl ? 'אונליין' : ''), 'אונליין'),
      templateText(formatTimeFromDate(meeting.startTime), 'השעה תעודכן בהמשך'),
      meetingLink,
    ],
    preview: `[תבנית: ${process.env.INSTRUCTOR_PRE_LESSON_WA_TEMPLATE_NAME || 'instructor_pre_lesson_60m'}] ${message}`,
  };
}

export function buildInstructorStatusCheckTemplatePayload(meeting: any, meetingLink: string, extras?: MeetingExtras): WhatsAppTemplatePayload {
  const time = formatTimeFromDate(meeting.startTime);
  const progressLine = formatLessonProgress(extras);
  const progress = progressLine ? `\n${progressLine}` : '';
  const question = `שלום ${meeting.instructor.name}, האם השיעור של היום התקיים?\n📚 ${meeting.cycle?.name || ''}\n🏫 ${meeting.cycle?.branch?.name || ''}\n🕐 שעה: ${time}${progress}\n\nאפשר להשיב כאן: כן / לא`;
  return {
    phone: meeting.instructor.phone,
    contactName: meeting.instructor.name,
    templateName: process.env.INSTRUCTOR_STATUS_CHECK_WA_TEMPLATE_NAME || 'instructor_status_check',
    bodyParameters: [
      templateText(meeting.instructor.name, 'מדריך/ה'),
      templateText(buildMeetingTitleWithProgress(meeting, extras), 'שיעור'),
      templateText(time, 'השעה תעודכן בהמשך'),
      meetingLink,
    ],
    preview: `[תבנית: ${process.env.INSTRUCTOR_STATUS_CHECK_WA_TEMPLATE_NAME || 'instructor_status_check'}] ${question}`,
  };
}

export async function sendInstructorPreLessonReminder(meeting: any): Promise<WhatsAppCloudResult> {
  if (!meeting.instructor?.phone) return { success: false, error: 'Instructor has no phone number' };
  const meetingLink = generateMeetingMagicLink(meeting.instructor.id, meeting.id, APP_URL);
  const extras = await getMeetingProgressExtras(meeting, { includeLastSummary: true });
  return sendWhatsAppCloudTemplate(buildInstructorPreLessonTemplatePayload(meeting, meetingLink, extras));
}

export async function sendInstructorStatusCheckReminder(meeting: any): Promise<WhatsAppCloudResult> {
  if (!meeting.instructor?.phone) return { success: false, error: 'Instructor has no phone number' };
  const meetingLink = generateMeetingMagicLink(meeting.instructor.id, meeting.id, APP_URL);
  const extras = await getMeetingProgressExtras(meeting);
  return sendWhatsAppCloudTemplate(buildInstructorStatusCheckTemplatePayload(meeting, meetingLink, extras));
}

function parseInstructorStatusReplyText(text: string | null | undefined): boolean | null {
  const lower = (text || '').toLowerCase().trim();
  if (/^(כן|כ|נכון|yes|y|עברתי|העברתי|התקיים|✅)/.test(lower)) return true;
  if (/^(לא|ל|no|n|לא עברתי|לא התקיים|בוטל|❌)/.test(lower)) return false;
  return null;
}

export const parseInstructorStatusReply = parseInstructorStatusReplyText;

/**
 * A) Morning reminders — 08:00 Israel time
 */
export async function sendMorningWhatsAppReminders(): Promise<void> {
  console.log('[WhatsApp] Running morning reminder job...');
  const todayDate = getIsraelDateOnly(); // @db.Date exact match

  try {
    const meetings = await prisma.meeting.findMany({
      where: reminderEligibleMeetingWhereForDate(todayDate),
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
      const meetingExtras = new Map<string, MeetingExtras>();
      for (const m of instrMeetings) {
        meetingLinks.set(m.id, generateMeetingMagicLink(instructor.id, m.id, APP_URL));
        const extras = await getMeetingProgressExtras(m);
        if (extras) meetingExtras.set(m.id, extras);
      }
      const scheduleText = buildMorningScheduleText(instrMeetings, meetingLinks, meetingExtras);
      const preview = `[תבנית: instructor_daily_schedule] ${buildMorningMessage(instructor.name, instrMeetings, meetingLinks, meetingExtras)}`;
      const result = await sendWhatsAppCloudTemplate({
        phone: instructor.phone!,
        contactName: instructor.name,
        templateName: process.env.INSTRUCTOR_DAILY_REMINDER_WA_TEMPLATE_NAME || 'instructor_daily_schedule',
        bodyParameters: [
          templateText(instructor.name, 'מדריך/ה'),
          templateText(scheduleText, 'אין פירוט שיעורים'),
          `${APP_URL}/instructor`,
        ],
        preview,
      });
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

  // Get yesterday's date in Israel time — @db.Date exact match
  const yesterdayDate = getIsraelDateOnly(-1);

  try {
    const unresolved = await prisma.meeting.findMany({
      where: reminderEligibleMeetingWhereForDate(yesterdayDate),
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

    // Build message — use midday of yesterdayDate for Hebrew display
    const yesterdayMidday = new Date(yesterdayDate.getTime() + 12 * 3_600_000);
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

    // Unique phone set — always include the operations recipients as fallback.
    const phones = new Set<string>(
      getOperationsWhatsAppRecipients().map((recipient) => recipient.phone)
    );
    for (const u of mgmtUsers) {
      if (u.phone) phones.add(u.phone.replace(/\D/g, ''));
    }

    for (const phone of phones) {
      const result = await sendWhatsAppCloudTemplate({
        phone,
        contactName: 'הנהלה',
        templateName: process.env.MANAGEMENT_UNRESOLVED_WA_TEMPLATE_NAME || 'management_unresolved_meetings',
        bodyParameters: [
          templateText(dateStr, 'אתמול'),
          String(unresolved.length),
          templateText(lines.slice(1, -1).join('\n'), 'פירוט ב-CRM'),
          APP_URL,
        ],
        preview: `[תבנית: management_unresolved_meetings] ${message}`,
      });
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
  const todayDate = getIsraelDateOnly(); // @db.Date exact match
  const nowMin = getCurrentTimeIsraelMinutes();

  try {
    const meetings = await prisma.meeting.findMany({
      where: reminderEligibleMeetingWhereForDate(todayDate),
      include: {
        cycle: { include: { branch: true, course: true } },
        instructor: true,
      },
    });

    for (const m of meetings) {
      if (!m.instructor?.phone) continue;
      if (preMeetingRemindersSent.has(m.id)) continue;

      const meetMin = toMinutes(m.startTime);
      if (!isPreMeetingReminderDue(nowMin, meetMin)) continue;
      if (await hasPreMeetingReminderBeenLogged(m.id, m.instructor.phone!)) {
        preMeetingRemindersSent.add(m.id);
        continue;
      }

      const meetingLink = generateMeetingMagicLink(m.instructor.id, m.id, APP_URL);

      const extras = await getMeetingProgressExtras(m, { includeLastSummary: true });

      const message = buildMeetingMessage(m.instructor.name, m, meetingLink, extras);
      const result = await sendWhatsAppCloudTemplate({
        ...buildInstructorPreLessonTemplatePayload(m, meetingLink, extras),
        preview: `[תבנית: ${process.env.INSTRUCTOR_PRE_LESSON_WA_TEMPLATE_NAME || 'instructor_pre_lesson_60m'}] ${message}`,
      });
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
  const todayDate = getIsraelDateOnly(); // @db.Date exact match

  try {
    const meetings = await prisma.meeting.findMany({
      where: reminderEligibleMeetingWhereForDate(todayDate),
      include: {
        cycle: { include: { branch: true, course: true } },
        instructor: true,
      },
    });

    const instructorMeetings = meetings.filter(m => m.instructor?.phone);
    console.log(`[WhatsApp] Found ${instructorMeetings.length} unresolved meetings`);

    for (const m of instructorMeetings) {
      const instr = m.instructor!;
      const meetingLink = generateMeetingMagicLink(instr.id, m.id, APP_URL);
      const extras = await getMeetingProgressExtras(m);

      const result = await sendWhatsAppCloudTemplate(buildInstructorStatusCheckTemplatePayload(m, meetingLink, extras));

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

async function recalculateCompletedMeetingFinancials(meetingId: string): Promise<void> {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: {
      cycle: {
        include: {
          registrations: {
            where: { status: { in: ['registered', 'active', 'completed'] } },
          },
        },
      },
      instructor: true,
    },
  });

  if (!meeting) return;

  const { remainingMeetings } = await syncCycleProgress(meeting.cycleId);

  if (meeting.status !== 'completed') return;

  const cycleData = meeting.cycle;
  const revenue = meetingRevenueForMeeting(cycleData, meeting);

  const instructorPayment = calculateInstructorPayment(cycleData, meeting.instructor, meeting);

  const approvedExpenses = await prisma.meetingExpense.aggregate({
    where: { meetingId, status: 'approved' },
    _sum: { amount: true },
  });
  const expensesTotal = Number(approvedExpenses._sum.amount || 0);
  const profit = revenue - instructorPayment - expensesTotal;

  const updatedMeeting = await prisma.meeting.update({
    where: { id: meetingId },
    data: { revenue, instructorPayment, profit },
  });
  await recalculateDailyInstructorPaymentsForMeeting(updatedMeeting);
  await checkAndSendNegativeProfitAlert(meetingId, 'whatsapp-status-reply');

  if (remainingMeetings <= 0 && !['completed', 'cancelled'].includes(cycleData.status)) {
    await handleCycleCompletion(meeting.cycleId);
  }

  console.log(`[WhatsApp] Meeting ${meetingId} financials recalculated after status reply: revenue=${revenue}, instructorPayment=${instructorPayment}, profit=${profit}`);
}

/**
 * Handle incoming WhatsApp status reply from instructor
 */
export async function handleStatusReply(phone: string, isYes: boolean): Promise<boolean> {
  try {
    const phoneVariants = normalizePhone(phone);
    const reminders = await prisma.$queryRaw<any[]>`
      SELECT wsr.id, wsr.meeting_id, wsr.instructor_id,
             i.name as instructor_name, c.name as cycle_name,
             m.notes as meeting_notes, m.cycle_id
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
      return false;
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

      await recalculateCompletedMeetingFinancials(r.meeting_id);

      await sendWhatsAppCloudText({
        phone,
        contactName: r.instructor_name,
        message: `תודה ${r.instructor_name}! רשמנו שהשיעור "${r.cycle_name}" התקיים 👍`,
      });
      await sendOperationsWhatsApp(`ℹ️ מדריך ${r.instructor_name} אישר שיעור "${r.cycle_name}" דרך וואטסאפ (לא מילא עצמאית)`);

      console.log(`[WhatsApp] Meeting ${r.meeting_id} auto-completed for ${r.instructor_name}`);
      return true;
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

      await syncCycleProgress(r.cycle_id);

      await sendOperationsWhatsApp(`🚨 מדריך ${r.instructor_name} דיווח שלא העביר שיעור "${r.cycle_name}" היום — הפגישה עברה לסטטוס בוטל.`);
      await sendWhatsAppCloudText({
        phone,
        contactName: r.instructor_name,
        message: `תודה על העדכון ${r.instructor_name}. נצור איתך קשר בנוגע לשיעור.`,
      });

      console.log(`[WhatsApp] No-show reported for ${r.instructor_name} — meeting cancelled`);
      return true;
    }
  } catch (error: any) {
    console.error('[WhatsApp] Error handling status reply:', error.message);
    return false;
  }
}
