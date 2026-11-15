/**
 * Morning credit notes (חשבונית זיכוי, type 330) → CRM refunds.
 *
 * A credit note in Morning carries `linkedDocuments` pointing at the document it cancels
 * (e.g. a 320 receipt). We map that original back to the CRM rows that recorded it:
 *
 *  - payments        — `[morning-doc:<id>]` / `[<id>]` marker in description, or invoice_number.
 *                       A full credit flips status → 'refunded' and appends a note; a partial
 *                       credit only appends a note (status unchanged) for a human to review.
 *  - registrations   — invoice_link containing the original document id. A full credit sets
 *                       paymentStatus 'refunded' (+ refund amount/date/credit link, note).
 *  - billing_payments — morning_receipt_id / number. Never changed beyond an appended note;
 *                       returned in `billingMatches` so an admin can reverse it manually.
 *
 * Idempotent: rows already refunded or already carrying this credit note's number are skipped,
 * so the webhook and the nightly safety-net job can both process the same document.
 */

import { prisma } from '../utils/prisma.js';
import { logAudit } from '../utils/audit.js';
import { getMorningDocument } from './morning/documents.js';
import { morningDocMarker, morningInvoiceUrl } from './morning-receipt-sync.js';

export const CREDIT_NOTE_DOC_TYPE = 330;
const AMOUNT_TOLERANCE = 1; // ₪ — rounding differences between CRM and Morning

export interface MorningLinkedDocument {
  id?: string;
  type?: number;
  number?: number | string;
  documentDate?: string;
  amount?: number;
}

export interface MorningCreditNoteInput {
  id: string;
  number: number | string;
  type: number;
  amount?: number;
  total?: number;
  documentDate?: string;
  date?: string;
  linkedDocuments?: MorningLinkedDocument[];
}

export type CreditNoteOutcome = 'refunded' | 'partial' | 'not_found' | 'already';

export interface CreditNoteResult {
  outcome: CreditNoteOutcome;
  paymentIds: string[];
  registrationIds: string[];
  billingMatches: Array<{ id: string; billingPeriodId: string; amount: number; noted: boolean }>;
}

function stripLeadingZeros(value: string): string {
  return value.replace(/^0+(?=\d)/, '');
}

/** `[זוכה אוטומטית DD.MM – זיכוי מורנינג N]` — DD.MM from the credit note date (Israel time). */
export function creditNoteTag(creditNumber: string, date: string | undefined, now: Date = new Date()): string {
  let dd: string;
  let mm: string;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(date || '');
  if (iso) {
    [, , mm, dd] = iso;
  } else {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit' })
      .formatToParts(now);
    dd = parts.find(p => p.type === 'day')!.value;
    mm = parts.find(p => p.type === 'month')!.value;
  }
  return `[זוכה אוטומטית ${dd}.${mm} – זיכוי מורנינג ${creditNumber}]`;
}

function creditNumberMarker(creditNumber: string): string {
  return `זיכוי מורנינג ${creditNumber}]`;
}

function appendNote(text: string | null | undefined, note: string): string {
  const base = (text || '').trim();
  return base ? `${base} ${note}` : note;
}

async function resolveLinkedDocuments(doc: MorningCreditNoteInput): Promise<{
  linked: MorningLinkedDocument[];
  amount: number;
}> {
  let linked = Array.isArray(doc.linkedDocuments) ? doc.linkedDocuments : undefined;
  let amount = Math.abs(Number(doc.amount ?? doc.total ?? NaN));
  if (!linked || linked.length === 0 || !Number.isFinite(amount)) {
    const full = (await getMorningDocument(String(doc.id))) as MorningCreditNoteInput & Record<string, any>;
    if (!linked || linked.length === 0) linked = Array.isArray(full?.linkedDocuments) ? full.linkedDocuments : [];
    if (!Number.isFinite(amount)) amount = Math.abs(Number(full?.amount ?? full?.total ?? 0));
  }
  return { linked: linked.filter(l => l && (l.id || l.number != null)), amount };
}

export async function applyMorningCreditNote(doc: MorningCreditNoteInput): Promise<CreditNoteResult> {
  const result: CreditNoteResult = { outcome: 'not_found', paymentIds: [], registrationIds: [], billingMatches: [] };
  if (Number(doc.type) !== CREDIT_NOTE_DOC_TYPE) return result;

  const creditNumber = String(doc.number);
  const { linked, amount: creditAmount } = await resolveLinkedDocuments(doc);
  if (linked.length === 0) {
    console.log(`[MorningCreditNote] credit #${creditNumber}: no linked documents`);
    return result;
  }

  const tag = creditNoteTag(creditNumber, doc.documentDate || doc.date);
  const marker = creditNumberMarker(creditNumber);
  const origIds = [...new Set(linked.map(l => l.id).filter((id): id is string => !!id))];
  const origNumbers = [...new Set(
    linked
      .map(l => (l.number != null ? String(l.number).trim() : ''))
      .filter(Boolean)
      .flatMap(n => [n, stripLeadingZeros(n)]),
  )];

  // Remaining credit to allocate across the matched rows (a credit may cover several originals).
  let remaining = creditAmount;
  let refunded = 0;
  let partial = 0;
  let already = 0;

  // ─── payments ────────────────────────────────────────────────────────────────
  const payments = await prisma.payment.findMany({
    where: {
      OR: [
        ...origIds.flatMap(id => [
          { description: { contains: morningDocMarker(id) } },
          { description: { contains: `[${id}]` } },
        ]),
        ...(origNumbers.length ? [{ invoiceNumber: { in: origNumbers } }] : []),
      ],
    },
    orderBy: { createdAt: 'asc' },
  });
  // A number-only match must not be a payment explicitly tagged with a different Morning doc.
  const matchedPayments = payments.filter(p => {
    if (origIds.some(id => p.description.includes(morningDocMarker(id)) || p.description.includes(`[${id}]`))) return true;
    const taggedOther = /\[morning-doc:([^\]]+)\]/.exec(p.description);
    return !taggedOther || origIds.length === 0 || origIds.includes(taggedOther[1]);
  });

  for (const payment of matchedPayments) {
    result.paymentIds.push(payment.id);
    const paymentAmount = Number(payment.amount || 0);
    if (payment.status === 'refunded' || payment.description.includes(marker)) {
      if (payment.status === 'refunded' && payment.description.includes(marker)) remaining -= paymentAmount;
      already++;
      continue;
    }
    if (payment.status !== 'paid') {
      // pending/cancelled rows were never counted as received — nothing to reverse.
      already++;
      continue;
    }

    if (remaining + AMOUNT_TOLERANCE >= paymentAmount) {
      remaining -= paymentAmount;
      const description = appendNote(payment.description, tag);
      await prisma.payment.update({ where: { id: payment.id }, data: { status: 'refunded', description } });
      await logAudit({
        userId: 'system',
        userName: 'Morning credit note',
        action: 'UPDATE',
        entity: 'payment',
        entityId: payment.id,
        oldValue: { status: payment.status, description: payment.description },
        newValue: { status: 'refunded', description },
      });
      refunded++;
      console.log(`[MorningCreditNote] credit #${creditNumber} → payment ${payment.id} refunded`);
    } else {
      const note = `[זיכוי חלקי ₪${creditAmount} – זיכוי מורנינג ${creditNumber}]`;
      await prisma.payment.update({ where: { id: payment.id }, data: { description: appendNote(payment.description, note) } });
      partial++;
      console.log(`[MorningCreditNote] credit #${creditNumber} → payment ${payment.id} partial (₪${creditAmount} < ₪${paymentAmount})`);
    }
  }

  // ─── registrations (receipt linked as invoice_link) ──────────────────────────
  if (origIds.length) {
    const registrations = await prisma.registration.findMany({
      where: { deletedAt: null, OR: origIds.map(id => ({ invoiceLink: { contains: id } })) },
      select: { id: true, amount: true, paymentStatus: true, notes: true, creditInvoiceLink: true },
    });
    for (const reg of registrations) {
      result.registrationIds.push(reg.id);
      if (reg.paymentStatus === 'refunded' || (reg.notes || '').includes(marker)) {
        already++;
        continue;
      }
      const regAmount = Number(reg.amount ?? 0);
      // Compared against the whole credit (not `remaining`): a registration and a payment
      // linked to the same receipt are the same money, not two separate amounts.
      const fullCredit = creditAmount + AMOUNT_TOLERANCE >= regAmount;
      if (fullCredit) {
        const data = {
          paymentStatus: 'refunded' as const,
          refundAmount: regAmount > 0 ? Math.min(regAmount, creditAmount || regAmount) : creditAmount,
          refundDate: new Date(doc.documentDate || doc.date || Date.now()),
          ...(reg.creditInvoiceLink ? {} : { creditInvoiceLink: morningInvoiceUrl(String(doc.id)) }),
          notes: appendNote(reg.notes, tag),
        };
        await prisma.registration.update({ where: { id: reg.id }, data });
        await logAudit({
          userId: 'system',
          userName: 'Morning credit note',
          action: 'UPDATE',
          entity: 'registration',
          entityId: reg.id,
          oldValue: { paymentStatus: reg.paymentStatus },
          newValue: { paymentStatus: 'refunded', creditNote: creditNumber },
        });
        refunded++;
        console.log(`[MorningCreditNote] credit #${creditNumber} → registration ${reg.id} refunded`);
      } else {
        const note = `[זיכוי חלקי ₪${creditAmount} – זיכוי מורנינג ${creditNumber}]`;
        await prisma.registration.update({ where: { id: reg.id }, data: { notes: appendNote(reg.notes, note) } });
        partial++;
      }
    }
  }

  // ─── billing_payments (institutional receipts) — note only, for admin review ─
  const receiptNumbers = linked
    .filter(l => l.number != null && (l.type == null || l.type === 400))
    .map(l => Number(l.number))
    .filter(n => Number.isInteger(n));
  if (origIds.length || receiptNumbers.length) {
    const billing = await prisma.billingPayment.findMany({
      where: {
        OR: [
          ...(origIds.length ? [{ morningReceiptId: { in: origIds } }] : []),
          ...(receiptNumbers.length ? [{ morningReceiptNumber: { in: receiptNumbers } }] : []),
        ],
      },
      select: { id: true, billingPeriodId: true, amount: true, notes: true },
    });
    for (const bp of billing) {
      const hasNote = (bp.notes || '').includes(marker);
      if (!hasNote) {
        const note = `[זוכה במורנינג – זיכוי מורנינג ${creditNumber}; לבדיקת מנהל]`;
        await prisma.billingPayment.update({ where: { id: bp.id }, data: { notes: appendNote(bp.notes, note) } });
      }
      result.billingMatches.push({ id: bp.id, billingPeriodId: bp.billingPeriodId, amount: Number(bp.amount), noted: !hasNote });
      console.warn(
        `[MorningCreditNote] credit #${creditNumber} cancels billing payment ${bp.id} (period ${bp.billingPeriodId}) — needs admin review`,
      );
    }
  }

  if (refunded > 0) result.outcome = 'refunded';
  else if (partial > 0) result.outcome = 'partial';
  else if (already > 0) result.outcome = 'already';
  else result.outcome = 'not_found';

  console.log(
    `[MorningCreditNote] credit #${creditNumber} → ${result.outcome} ` +
      `(payments=${result.paymentIds.length}, registrations=${result.registrationIds.length}, billing=${result.billingMatches.length})`,
  );
  return result;
}
