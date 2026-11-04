/**
 * LMS signup nudge — one WhatsApp template to people who signed up on hai.tech/lms
 * (lead source 'website-lms') but didn't buy, opening a conversation sales can pick up.
 *
 * Separate from the (deliberately suppressed) generic lead welcome: delayed, conditional,
 * exactly once per lead.
 *
 * Eligibility (checked every 10 minutes):
 *  - source 'website-lms', created 60 minutes – 72 hours ago. The upper bound is 72h (not
 *    48h) so a Friday-afternoon / Shabbat signup still goes out on Sunday morning, with slack
 *    for missed runs.
 *  - salesStatus not converted / not_relevant, phone present, customer not deleted.
 *  - no payment evidence (findPaymentEvidence: paid payments incl. Woo/LMS purchases,
 *    paid registrations) and no 'purchase-form' (checkout) lead for the same person.
 *  - not already nudged (lead_activities marker), fewer than MAX_ATTEMPTS failed sends.
 *  - no WhatsApp message to/from that phone in the last 48h (someone is already talking).
 * Send window: 09:00–20:00 Asia/Jerusalem, never Saturday, Friday only before 14:00.
 * Outside the window the job just waits for the next run.
 *
 * Env: LMS_SIGNUP_NUDGE=off disables; LMS_SIGNUP_NUDGE_WA_TEMPLATE_NAME overrides the template.
 */
import cron, { ScheduledTask } from 'node-cron';
import { prisma } from '../utils/prisma.js';
import { findPaymentEvidence } from './lead-payment-evidence.js';
import { normalizeWhatsAppCloudPhone, sendWhatsAppCloudTemplate } from './whatsapp-cloud-templates.js';

const TZ = 'Asia/Jerusalem';
const DEFAULT_CRON = '*/10 * * * *';
const DEFAULT_TEMPLATE = 'lms_signup_no_purchase';

export const LMS_SOURCE = 'website-lms';
export const LMS_URL = 'https://hai.tech/lms/';
export const MIN_AGE_MS = 60 * 60 * 1000;
export const MAX_AGE_MS = 72 * 60 * 60 * 1000;
export const RECENT_CONVERSATION_MS = 48 * 60 * 60 * 1000;
export const PURCHASE_FORM_LOOKBACK_MS = 24 * 60 * 60 * 1000;
export const MAX_ATTEMPTS = 3;

export const NUDGE_SENT_NOTE = 'נשלחה הודעת וואטסאפ – נרשם לאתר בלי רכישה';
export const NUDGE_FAILED_NOTE_PREFIX = 'שליחת הודעת וואטסאפ – נרשם לאתר בלי רכישה נכשלה';
const ACTIVITY_TYPE = 'whatsapp';
const CLOSED_SALES_STATUSES = ['converted', 'not_relevant'];

export function isLmsNudgeEnabled(): boolean {
  return process.env.LMS_SIGNUP_NUDGE !== 'off';
}

export function lmsNudgeTemplateName(): string {
  return process.env.LMS_SIGNUP_NUDGE_WA_TEMPLATE_NAME || DEFAULT_TEMPLATE;
}

function israelParts(now: Date): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value || '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { weekday, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

/** 09:00–20:00 Israel time; Friday until 14:00; never Saturday. */
export function isWithinLmsNudgeSendWindow(now: Date = new Date()): boolean {
  const { weekday, minutes } = israelParts(now);
  if (weekday === 6) return false;
  const start = 9 * 60;
  const end = weekday === 5 ? 14 * 60 : 20 * 60;
  return minutes >= start && minutes < end;
}

export function firstNameOf(name?: string | null): string {
  return (name || '').trim().split(/\s+/)[0] || 'שלום';
}

export function buildLmsNudgePayload(lead: { customerName?: string | null; customerPhone: string }) {
  const firstName = firstNameOf(lead.customerName);
  return {
    phone: lead.customerPhone,
    contactName: lead.customerName || null,
    templateName: lmsNudgeTemplateName(),
    bodyParameters: [firstName, LMS_URL],
    preview:
      `היי ${firstName}, ראינו שנרשמת לאתר הלמידה של דרך ההייטק 🙌 ` +
      'יש שאלה על הקורסים, או שנעזור לבחור את המתאים? אפשר פשוט להשיב כאן ונשמח לעזור. ' +
      `לכל הקורסים: ${LMS_URL} נשמח לשמוע ממך 💙`,
  };
}

function phoneVariants(phone: string): string[] {
  const normalized = normalizeWhatsAppCloudPhone(phone);
  const set = new Set<string>([phone.trim()]);
  if (normalized) {
    set.add(normalized);
    set.add(`0${normalized.slice(3)}`);
    set.add(`+${normalized}`);
  }
  return [...set].filter(Boolean);
}

type CandidateLead = {
  id: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  createdAt: Date;
};

export type LmsNudgeSkipReason =
  | 'already_nudged'
  | 'max_attempts'
  | 'paid'
  | 'purchase_form'
  | 'recent_conversation';

/** Returns null when the lead should be nudged now, otherwise the reason to skip. */
export async function getLmsNudgeSkipReason(lead: CandidateLead, now: Date = new Date()): Promise<LmsNudgeSkipReason | null> {
  const activities = await prisma.leadActivity.findMany({
    where: {
      leadAppointmentId: lead.id,
      type: ACTIVITY_TYPE,
      OR: [{ note: NUDGE_SENT_NOTE }, { note: { startsWith: NUDGE_FAILED_NOTE_PREFIX } }],
    },
    select: { note: true },
  });
  if (activities.some(a => a.note === NUDGE_SENT_NOTE)) return 'already_nudged';
  if (activities.length >= MAX_ATTEMPTS) return 'max_attempts';

  if (await findPaymentEvidence(lead)) return 'paid';

  const phones = phoneVariants(lead.customerPhone);
  const purchaseForm = await prisma.leadAppointment.findFirst({
    where: {
      source: 'purchase-form',
      id: { not: lead.id },
      createdAt: { gte: new Date(lead.createdAt.getTime() - PURCHASE_FORM_LOOKBACK_MS) },
      OR: [
        ...(lead.customerId ? [{ customerId: lead.customerId }] : []),
        { customerPhone: { in: phones } },
      ],
    },
    select: { id: true },
  });
  if (purchaseForm) return 'purchase_form';

  const recentMessage = await prisma.waMessage.findFirst({
    where: {
      createdAt: { gte: new Date(now.getTime() - RECENT_CONVERSATION_MS) },
      conversation: { phone: { in: phones } },
    },
    select: { id: true },
  });
  if (recentMessage) return 'recent_conversation';

  return null;
}

export function findLmsNudgeCandidates(now: Date = new Date()): Promise<CandidateLead[]> {
  return prisma.leadAppointment.findMany({
    where: {
      source: LMS_SOURCE,
      createdAt: { gte: new Date(now.getTime() - MAX_AGE_MS), lte: new Date(now.getTime() - MIN_AGE_MS) },
      salesStatus: { notIn: CLOSED_SALES_STATUSES },
      customerPhone: { not: '' },
      OR: [{ customerId: null }, { customer: { deletedAt: null } }],
    },
    select: { id: true, customerId: true, customerName: true, customerPhone: true, customerEmail: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
}

export interface LmsNudgeRunResult {
  skipped?: 'disabled' | 'outside_window' | 'running';
  candidates: number;
  sent: number;
  failed: number;
  ineligible: number;
}

let running = false;

export async function runLmsSignupNudge(now: Date = new Date()): Promise<LmsNudgeRunResult> {
  const result: LmsNudgeRunResult = { candidates: 0, sent: 0, failed: 0, ineligible: 0 };
  if (!isLmsNudgeEnabled()) return { ...result, skipped: 'disabled' };
  if (!isWithinLmsNudgeSendWindow(now)) return { ...result, skipped: 'outside_window' };
  if (running) return { ...result, skipped: 'running' };

  running = true;
  try {
    const leads = await findLmsNudgeCandidates(now);
    result.candidates = leads.length;
    // Same phone may have several LMS leads — send at most one per phone per run.
    const handledPhones = new Set<string>();

    for (const lead of leads) {
      try {
        const phoneKey = normalizeWhatsAppCloudPhone(lead.customerPhone);
        if (!phoneKey || handledPhones.has(phoneKey)) {
          result.ineligible += 1;
          continue;
        }
        const reason = await getLmsNudgeSkipReason(lead, now);
        if (reason) {
          result.ineligible += 1;
          continue;
        }
        handledPhones.add(phoneKey);

        const send = await sendWhatsAppCloudTemplate(buildLmsNudgePayload(lead));
        if (send.success) {
          await prisma.leadActivity.create({
            data: { leadAppointmentId: lead.id, userId: null, type: ACTIVITY_TYPE, result: 'whatsapp_sent', note: NUDGE_SENT_NOTE },
          });
          result.sent += 1;
          console.log(`[LmsNudge] Sent ${lmsNudgeTemplateName()} to lead ${lead.id}`);
        } else {
          await prisma.leadActivity.create({
            data: {
              leadAppointmentId: lead.id,
              userId: null,
              type: ACTIVITY_TYPE,
              result: 'whatsapp_failed',
              note: `${NUDGE_FAILED_NOTE_PREFIX}: ${(send.error || 'unknown error').slice(0, 500)}`,
            },
          });
          result.failed += 1;
          console.error(`[LmsNudge] Send failed for lead ${lead.id}: ${send.error}`);
        }
      } catch (err) {
        result.failed += 1;
        console.error(`[LmsNudge] Failed processing lead ${lead.id}:`, err);
      }
    }

    if (result.candidates) {
      console.log(
        `[LmsNudge] Run done: candidates=${result.candidates}, sent=${result.sent}, failed=${result.failed}, ineligible=${result.ineligible}`,
      );
    }
  } catch (err) {
    console.error('[LmsNudge] Run failed:', err);
  } finally {
    running = false;
  }
  return result;
}

let scheduledTask: ScheduledTask | null = null;

export function initLmsSignupNudgeScheduler(): void {
  if (!isLmsNudgeEnabled()) {
    console.log('[LmsNudge] LMS_SIGNUP_NUDGE=off — scheduler disabled');
    return;
  }
  scheduledTask?.stop();
  scheduledTask = cron.schedule(DEFAULT_CRON, () => {
    runLmsSignupNudge().catch(err => console.error('[LmsNudge] Unexpected error:', err));
  }, { timezone: TZ });
  console.log(`[LmsNudge] Scheduler initialized (${DEFAULT_CRON}, ${TZ}, template=${lmsNudgeTemplateName()})`);
}

export function stopLmsSignupNudgeScheduler(): void {
  scheduledTask?.stop();
  scheduledTask = null;
}
