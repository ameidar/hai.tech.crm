import cron from 'node-cron';
import { prisma } from '../utils/prisma.js';
import { sendEmail, sendWhatsAppToChat } from './messaging.js';

// Internal recipients for open-proforma alerts (NOT the customer).
const ALERT_EMAIL = process.env.OPEN_PROFORMA_ALERT_EMAIL || 'info@hai.tech';
// HR WhatsApp group — Green API only (Meta Cloud API cannot post to groups).
const ALERT_WA_GROUP = process.env.OPEN_PROFORMA_ALERT_WA_GROUP || '120363145522985520@g.us';

const ALERT_INTERVAL_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Due date for an issued proforma = end of the issue month + paymentTermsDays.
 * E.g. issued 2026-04-10 with 30-day terms → 2026-04-30 + 30 = 2026-05-30.
 * Computed in UTC to stay aligned with how DateTime @db.Date values are stored.
 */
export function computeProformaDueDate(issuedAt: Date, paymentTermsDays: number): Date {
  // First day of the month AFTER the issue month, at UTC midnight = the moment
  // after end-of-month; subtract a day to land on the last day of the issue month.
  const eom = new Date(Date.UTC(issuedAt.getUTCFullYear(), issuedAt.getUTCMonth() + 1, 0));
  const due = new Date(eom);
  due.setUTCDate(due.getUTCDate() + paymentTermsDays);
  return due;
}

function startOfUTCDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface OverdueEntry {
  institution: string;
  docNumber: string;
  docUrl: string | null;
  totalGross: number;
  paidAmount: number;
  outstanding: number;
  dueDate: Date;
  daysOverdue: number;
}

/**
 * Scan issued-but-unpaid billing periods, find the ones past their proforma due
 * date, and send a consolidated internal alert (email + HR WhatsApp group).
 * Alerts once when first overdue, then at most weekly until paid.
 * Returns the entries alerted on (for tests / manual runs).
 */
export async function runOpenProformaAlerts(now: Date = new Date()): Promise<OverdueEntry[]> {
  const today = startOfUTCDay(now);

  const periods = await prisma.billingPeriod.findMany({
    where: {
      status: 'issued',
      paymentStatus: { in: ['unpaid', 'partial'] },
      issuedAt: { not: null },
    },
    include: { institutionalOrder: true },
  });

  const due: OverdueEntry[] = [];

  for (const p of periods) {
    if (!p.issuedAt) continue;
    const terms = p.institutionalOrder?.paymentTermsDays ?? 30;
    const dueDate = computeProformaDueDate(p.issuedAt, terms);
    if (today.getTime() < startOfUTCDay(dueDate).getTime()) continue; // not yet due

    // Throttle: only alert if never alerted, or last alert was >= ALERT_INTERVAL_DAYS ago.
    if (p.lastOpenProformaAlertAt) {
      const sinceLast = (today.getTime() - startOfUTCDay(p.lastOpenProformaAlertAt).getTime()) / MS_PER_DAY;
      if (sinceLast < ALERT_INTERVAL_DAYS) continue;
    }

    const totalGross = Number(p.totalAmount) * 1.18;
    const paidAmount = Number(p.paidAmount);
    const daysOverdue = Math.round((today.getTime() - startOfUTCDay(dueDate).getTime()) / MS_PER_DAY);

    due.push({
      institution: p.institutionalOrder?.orderName || p.institutionalOrder?.orderNumber || '(ללא שם)',
      docNumber: p.morningDocNumber ? String(p.morningDocNumber) : '—',
      docUrl: p.morningDocUrl,
      totalGross,
      paidAmount,
      outstanding: Math.max(0, totalGross - paidAmount),
      dueDate,
      daysOverdue,
    });

    await prisma.billingPeriod.update({
      where: { id: p.id },
      data: { lastOpenProformaAlertAt: now },
    });
  }

  if (due.length === 0) return [];

  const { subject, text, html } = buildAlertMessage(due);
  const [emailRes, waRes] = await Promise.all([
    sendEmail({ to: ALERT_EMAIL, subject, body: html, html: true }),
    sendWhatsAppToChat(ALERT_WA_GROUP, text),
  ]);
  if (!emailRes.success) console.error('[PROFORMA-ALERT] email failed:', emailRes.error);
  if (!waRes.success) console.error('[PROFORMA-ALERT] whatsapp failed:', waRes.error);

  return due;
}

function buildAlertMessage(entries: OverdueEntry[]) {
  const subject = `התראה: ${entries.length} חשבונות עסקה פתוחים שעברו את מועד התשלום`;

  const lines = entries.map((e) => {
    const amount = e.outstanding.toLocaleString('he-IL', { maximumFractionDigits: 0 });
    return `• ${e.institution} — מסמך ${e.docNumber} — יתרה לתשלום ₪${amount} — לתשלום עד ${fmtDate(e.dueDate)} (${e.daysOverdue} ימי איחור)`;
  });
  const text = `חשבונות עסקה פתוחים שטרם שולמו ועברו את מועד התשלום:\n\n${lines.join('\n')}`;

  const rows = entries.map((e) => {
    const amount = e.outstanding.toLocaleString('he-IL', { maximumFractionDigits: 0 });
    const link = e.docUrl ? `<a href="${e.docUrl}">${e.docNumber}</a>` : e.docNumber;
    return `<tr><td>${e.institution}</td><td>${link}</td><td>₪${amount}</td><td>${fmtDate(e.dueDate)}</td><td>${e.daysOverdue}</td></tr>`;
  });
  const html = `
    <div dir="rtl" style="font-family:Arial,sans-serif">
      <h2>חשבונות עסקה פתוחים שעברו את מועד התשלום</h2>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">
        <thead><tr><th>מוסד</th><th>מסמך</th><th>יתרה לתשלום</th><th>לתשלום עד</th><th>ימי איחור</th></tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>`;

  return { subject, text, html };
}

/**
 * Daily at 09:00 (Asia/Jerusalem via host TZ): alert on open, overdue proformas.
 */
export function initProformaAlertScheduler() {
  cron.schedule('0 9 * * *', async () => {
    console.log('[PROFORMA-ALERT] Checking open overdue proformas...');
    try {
      const alerted = await runOpenProformaAlerts();
      console.log(`[PROFORMA-ALERT] Done — alerted on ${alerted.length} period(s)`);
    } catch (e) {
      console.error('[PROFORMA-ALERT] Scheduler error:', e);
    }
  });
  console.log('[PROFORMA-ALERT] Scheduler initialized (daily 09:00) — internal alerts only');
}
