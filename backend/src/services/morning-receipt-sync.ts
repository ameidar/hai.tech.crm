/**
 * Morning receipt → Omer registration sync.
 *
 * Parents who pay through the generic Omer Morning payment page (not a CRM
 * payment link) produce a Morning receipt that the CRM never hears about: the
 * Morning webhook does not fire for these documents, so the registration stays
 * "unpaid" until someone updates it by hand.
 *
 * This job polls recent Morning receipts and, only when the receipt belongs to a
 * customer (matched by phone) with exactly one unpaid Omer auto-registration,
 * records a CRM payment and runs the existing Omer reconciliation. Everything
 * else is skipped so a receipt is never applied to the wrong child/cycle and
 * payments already recorded via payment links / Woo are not duplicated.
 *
 * Receipts that don't fit the Omer flow (any cycle, incl. registrations already
 * marked paid by hand) are linked as the registration's invoice when exactly one
 * of the customer's registrations has no invoice yet and the same amount.
 */

import { autoConvertLeadsForPayment, autoConvertLeadsForRegistration } from './lead-payment-evidence.js';
import { prisma } from '../utils/prisma.js';
import { isMorningConfigured } from './morning/client.js';
import { searchMorningDocuments, type MorningDocument } from './morning/documents.js';
import { extractMorningRef, settleMorningPaymentByRef } from './morning-payment-link.js';
import {
  findReconcilableOmerRegistrations,
  reconcileOmerRegistrationPayment,
} from './omer-payment-reconciliation.js';

// Receipt-bearing document types: חשבונית מס/קבלה (305), חשבון עסקה + קבלה (315), קבלה (320).
export const RECEIPT_DOC_TYPES = [305, 315, 320];
export const PAYMENT_METHOD = 'morning_receipt_sync';
const DUPLICATE_WINDOW_DAYS = 3;
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

export type ReceiptSyncOutcome =
  | 'created'
  | 'would_create'
  | 'already_recorded'
  | 'no_phone'
  | 'invalid_amount'
  | 'no_customer'
  | 'ambiguous_customer'
  | 'no_matching_registration'
  | 'ambiguous_registrations'
  | 'similar_payment_exists'
  | 'would_link_invoice'
  | 'linked_invoice';

export interface ReceiptSyncResult {
  days: number;
  dryRun: boolean;
  total: number;
  counts: Partial<Record<ReceiptSyncOutcome, number>>;
  details: Array<{ docNumber: number; outcome: ReceiptSyncOutcome; registrationId?: string }>;
}

export function morningDocMarker(docId: string): string {
  return `[morning-doc:${docId}]`;
}

function last9Digits(phone: string | undefined): string {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : '';
}

const INVOICE_URL_BASE = 'https://app.greeninvoice.co.il/incomes/documents/';
const AMOUNT_TOLERANCE = 1; // ₪ — rounding differences between CRM and Morning

export function morningInvoiceUrl(docId: string): string {
  return `${INVOICE_URL_BASE}${docId}`;
}

/**
 * Attach a receipt to the customer's single matching registration (no invoice yet,
 * same amount). Marks it paid if it wasn't. Ambiguous matches are left for a human.
 */
async function linkReceiptToRegistration(
  doc: MorningDocument,
  customerId: string,
  amount: number,
  opts: { dryRun?: boolean },
): Promise<{ outcome: ReceiptSyncOutcome; registrationId?: string }> {
  const candidates = await prisma.registration.findMany({
    where: {
      deletedAt: null,
      status: { not: 'cancelled' },
      student: { customerId },
      OR: [{ invoiceLink: null }, { invoiceLink: '' }],
    },
    select: { id: true, amount: true, paymentStatus: true },
  });
  const matches = candidates.filter(
    r => r.amount != null && Math.abs(Number(r.amount) - amount) < AMOUNT_TOLERANCE,
  );
  if (matches.length === 0) return { outcome: 'no_matching_registration' };
  if (matches.length > 1) return { outcome: 'ambiguous_registrations' };

  const registration = matches[0];
  if (opts.dryRun) return { outcome: 'would_link_invoice', registrationId: registration.id };

  await prisma.registration.update({
    where: { id: registration.id },
    data: {
      invoiceLink: morningInvoiceUrl(doc.id),
      ...(registration.paymentStatus !== 'paid' ? { paymentStatus: 'paid' as const } : {}),
    },
  });
  console.log(`[MorningReceiptSync] doc #${doc.number} linked as invoice of registration ${registration.id}`);
  await autoConvertLeadsForRegistration(registration.id);
  return { outcome: 'linked_invoice', registrationId: registration.id };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function processMorningReceipt(
  doc: MorningDocument,
  opts: { dryRun?: boolean } = {},
): Promise<{ outcome: ReceiptSyncOutcome; registrationId?: string }> {
  const marker = morningDocMarker(doc.id);

  // Documents issued by a CRM Morning payment link carry an `HT-…` ref — settle that
  // pending payment (re-verified against the Morning API) instead of guessing.
  const paymentFormRef = extractMorningRef(doc.description, doc.remarks);
  if (paymentFormRef && !opts.dryRun) {
    const settled = await settleMorningPaymentByRef(paymentFormRef, doc.id);
    if (settled.outcome !== 'not_found') return { outcome: 'already_recorded' };
  }

  // Already recorded by this job, or by the webhook (which stores the raw doc id in brackets).
  const existing = await prisma.payment.findFirst({
    where: {
      OR: [
        { description: { contains: marker } },
        { description: { contains: `[${doc.id}]` } },
      ],
    },
    select: { id: true },
  });
  if (existing) return { outcome: 'already_recorded' };
  const alreadyLinked = await prisma.registration.findFirst({
    where: { invoiceLink: { contains: doc.id } },
    select: { id: true },
  });
  if (alreadyLinked) return { outcome: 'already_recorded', registrationId: alreadyLinked.id };

  const amount = Number(doc.amount || 0);
  if (!(amount > 0)) return { outcome: 'invalid_amount' };

  const last9 = last9Digits(doc.client?.mobile || doc.client?.phone);
  const email = doc.client?.emails?.find(Boolean)?.trim().toLowerCase();
  if (!last9 && !email) return { outcome: 'no_phone' };

  let customers = last9
    ? await prisma.customer.findMany({
        where: { deletedAt: null, phone: { contains: last9 } },
        select: { id: true, name: true, phone: true },
        take: 2,
      })
    : [];
  if (customers.length === 0 && email) {
    customers = await prisma.customer.findMany({
      where: { deletedAt: null, email: { equals: email, mode: 'insensitive' } },
      select: { id: true, name: true, phone: true },
      take: 2,
    });
  }
  if (customers.length === 0) return { outcome: 'no_customer' };
  if (customers.length > 1) return { outcome: 'ambiguous_customer' };
  const customer = customers[0];

  const registrations = await findReconcilableOmerRegistrations(customer.id);
  if (registrations.length === 0) return linkReceiptToRegistration(doc, customer.id, amount, opts);
  if (registrations.length > 1) return { outcome: 'ambiguous_registrations' };
  const registrationId = registrations[0].id;

  // Guard against double-recording a payment that already reached the CRM through
  // another channel (payment link, Woo, manual) but could not be reconciled.
  const docDate = doc.documentDate ? new Date(doc.documentDate) : new Date();
  const windowMs = DUPLICATE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const similar = await prisma.payment.findFirst({
    where: {
      customerId: customer.id,
      amount,
      paidAt: {
        gte: new Date(docDate.getTime() - windowMs),
        lte: new Date(docDate.getTime() + windowMs),
      },
    },
    select: { id: true },
  });
  if (similar) return { outcome: 'similar_payment_exists', registrationId };

  if (opts.dryRun) return { outcome: 'would_create', registrationId };

  const incomeDesc = (doc.income || []).map(i => i.description).filter(Boolean).join(', ');
  const payment = await prisma.payment.create({
    data: {
      customerId: customer.id,
      customerName: customer.name || doc.client?.name || 'לקוח',
      customerPhone: customer.phone || null,
      customerEmail: doc.client?.emails?.[0] || null,
      description: `${incomeDesc || 'קבלה ממורנינג'} #${doc.number} ${marker}`,
      amount,
      currency: 'ILS',
      status: 'paid',
      paymentMethod: PAYMENT_METHOD,
      paidAt: docDate,
      invoiceNumber: String(doc.number),
      invoiceUrl: doc.url?.he || doc.url?.origin || null,
    },
  });

  const reconciliation = await reconcileOmerRegistrationPayment(payment.id);
  await autoConvertLeadsForPayment(payment.id);
  console.log(
    `[MorningReceiptSync] doc #${doc.number} → payment ${payment.id}, reconciliation=${reconciliation.status}` +
      (reconciliation.reason ? ` (${reconciliation.reason})` : ''),
  );

  return { outcome: 'created', registrationId: reconciliation.registrationId ?? registrationId };
}

export async function syncRecentMorningReceipts(
  days = 2,
  opts: { dryRun?: boolean; now?: Date } = {},
): Promise<ReceiptSyncResult> {
  const result: ReceiptSyncResult = { days, dryRun: !!opts.dryRun, total: 0, counts: {}, details: [] };
  if (!isMorningConfigured()) {
    console.log('[MorningReceiptSync] Morning API not configured; skipped');
    return result;
  }

  const now = opts.now ?? new Date();
  const fromDate = isoDate(new Date(now.getTime() - days * 24 * 60 * 60 * 1000));
  const toDate = isoDate(now);

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { items } = await searchMorningDocuments({
      type: RECEIPT_DOC_TYPES,
      fromDate,
      toDate,
      page,
      pageSize: PAGE_SIZE,
    });

    for (const doc of items) {
      result.total++;
      try {
        const { outcome, registrationId } = await processMorningReceipt(doc, opts);
        result.counts[outcome] = (result.counts[outcome] || 0) + 1;
        result.details.push({ docNumber: doc.number, outcome, registrationId });
      } catch (err) {
        console.error(`[MorningReceiptSync] doc #${doc.number} failed:`, err);
      }
    }

    if (items.length < PAGE_SIZE) break;
  }

  return result;
}
