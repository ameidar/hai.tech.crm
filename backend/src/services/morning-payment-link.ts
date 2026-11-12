/**
 * Direct Morning (GreenInvoice) payment links — replaces the WooCommerce order +
 * "Morning for WooCommerce" plugin flow that lived on haitechdigitalcourses.hai.tech.
 *
 * Flow (PAYMENTS_PROVIDER=morning, the default):
 *  1. create-link → a pending `payments` row with a public `payToken` (no Woo order).
 *  2. Customer opens /pay/<token>, picks installments → we create a Morning hosted
 *     payment form (POST /api/v1/payments/form) and redirect to its URL. Morning
 *     issues the receipt document itself once the card is charged.
 *  3. Morning POSTs our `notifyUrl`; the customer also lands back on `successUrl`.
 *     Neither is trusted: the payload of notifyUrl is not documented, so every
 *     trigger re-reads the issued document from the Morning API and only accepts it
 *     when its description carries our per-payment ref and the amount matches.
 *
 * Docs: https://developers.morning.co/api (getPaymentForm, getDocument, searchDocuments)
 *
 * No schema change: provider = "row has payToken but no wooOrderId"; the Morning
 * document id is stored as the `[morning-doc:<id>]` marker in `description` (same
 * marker morning-receipt-sync uses for de-duplication) plus invoiceUrl/invoiceNumber.
 */

import { randomUUID } from 'crypto';
import { prisma } from '../utils/prisma.js';
import { createPaymentForm } from './morning/payment-forms.js';
import { getMorningDocument, searchMorningDocuments, type MorningDocument } from './morning/documents.js';
import { createMorningClient, findClientForCustomer } from './morning/clients.js';
import { reconcileOmerRegistrationPayment } from './omer-payment-reconciliation.js';
import { autoConvertLeadsForPayment } from './lead-payment-evidence.js';
import { handlePostPaymentPlacement } from './trial-placement.js';

export type PaymentsProvider = 'morning' | 'woocommerce';

/** Feature flag — `PAYMENTS_PROVIDER=woocommerce` switches back to the legacy Woo flow. */
export function getPaymentsProvider(): PaymentsProvider {
  return String(process.env.PAYMENTS_PROVIDER || 'morning').trim().toLowerCase() === 'woocommerce'
    ? 'woocommerce'
    : 'morning';
}

export const MORNING_PAYMENT_METHOD = 'morning_payment_form';

/** Morning document types we accept as proof of payment: 305 חשבונית מס, 320 חשבונית מס/קבלה, 400 קבלה. */
export const ACCEPTED_DOC_TYPES = [305, 320, 400];
const CANCELLED_DOC_STATUSES = [3, 4]; // 3 מסמך מבטל, 4 מסמך שבוטל
const AMOUNT_TOLERANCE = 1; // ₪

/** Document type Morning issues after payment — 320 = חשבונית מס / קבלה (payments/form spec). */
export function morningPaymentDocType(): number {
  const n = Number(process.env.MORNING_PAYMENT_DOC_TYPE || 320);
  return [320, 400, 405, 600].includes(n) ? n : 320;
}

export function morningDocMarker(docId: string): string {
  return `[morning-doc:${docId}]`;
}

// CRM refs are 10 hex chars (from the pay token); the website / LMS worker use 10
// base32 chars (A-Z, 2-9). Both share the `HT-` prefix.
const REF_RE = /HT-([0-9A-Z]{10})\b/i;
const CRM_REF_RE = /^HT-([0-9A-F]{10})$/i;

/** Short human-safe reference derived from the pay token — printed on the Morning document. */
export function morningRefForToken(payToken: string): string {
  const hex = payToken.replace(/-/g, '').slice(0, 10).toUpperCase();
  return `HT-${hex}`;
}

export function extractMorningRef(...texts: Array<string | null | undefined>): string | null {
  for (const t of texts) {
    const m = String(t || '').match(REF_RE);
    if (m) return `HT-${m[1].toUpperCase()}`;
  }
  return null;
}

/** Inverse of morningRefForToken → payToken prefix (`xxxxxxxx-xx`). */
function tokenPrefixForRef(ref: string): string | null {
  const m = ref.match(CRM_REF_RE);
  if (!m) return null;
  const hex = m[1].toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 10)}`;
}

export function isMorningPayment(p: { wooOrderId?: number | null; payToken?: string | null }): boolean {
  return !p.wooOrderId && !!p.payToken;
}

function publicBaseUrl(baseUrl?: string): string {
  return (baseUrl || process.env.BASE_URL || 'https://crm.orma-ai.com').replace(/\/+$/, '');
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function digits(v: string | null | undefined): string {
  return String(v || '').replace(/\D/g, '');
}

// ─── 1. create-link ─────────────────────────────────────────────────────────

export interface CreateMorningPaymentLinkInput {
  customerId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  amount: number;
  description: string;
  installments?: number | null;
  baseUrl?: string;
}

export async function createMorningPaymentLink(input: CreateMorningPaymentLinkInput) {
  const amount = Number(input.amount);
  if (!amount || isNaN(amount) || amount <= 0) throw new Error('סכום לא תקין');
  const description = input.description?.trim();
  if (!description) throw new Error('נדרש תיאור');
  const maxInstallments = input.installments && Number(input.installments) > 1
    ? Math.min(36, Math.floor(Number(input.installments)))
    : 1;

  let customerId = input.customerId || null;
  const phoneDigits = digits(input.customerPhone);
  if (!customerId && phoneDigits.length >= 9) {
    const found = await prisma.customer.findFirst({
      where: { phone: { contains: phoneDigits.slice(-9) } },
      select: { id: true },
    });
    if (found) customerId = found.id;
  }

  const payToken = randomUUID();
  const payment = await prisma.payment.create({
    data: {
      customerId,
      customerName: input.customerName || 'לקוח',
      customerEmail: input.customerEmail || null,
      customerPhone: input.customerPhone || null,
      description,
      amount,
      currency: 'ILS',
      status: 'pending',
      payToken,
      paymentMethod: MORNING_PAYMENT_METHOD,
      maxInstallments: maxInstallments > 1 ? maxInstallments : null,
    },
  });

  const payUrl = `${publicBaseUrl(input.baseUrl)}/pay/${payToken}`;
  return {
    provider: 'morning' as const,
    paymentId: payment.id,
    // The CRM UI polls /order-status/:orderId — for Morning links that's the payment id.
    orderId: payment.id,
    ref: morningRefForToken(payToken),
    paymentUrl: payUrl,
    directPaymentUrl: payUrl,
    amount,
    description,
    maxInstallments,
    wooProductId: null,
  };
}

// ─── 2. hosted checkout ─────────────────────────────────────────────────────

async function resolveMorningClientId(customerId: string | null | undefined): Promise<string | undefined> {
  if (!customerId) return undefined;
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, name: true, email: true, phone: true, address: true, city: true, morningClientId: true },
  });
  if (!customer) return undefined;
  if (customer.morningClientId) return customer.morningClientId;
  try {
    const existing = await findClientForCustomer({ name: customer.name, email: customer.email, phone: customer.phone });
    const client = existing ?? await createMorningClient({
      name: customer.name,
      emails: customer.email ? [customer.email] : undefined,
      phone: customer.phone ?? undefined,
      address: customer.address ?? undefined,
      city: customer.city ?? undefined,
    });
    await prisma.customer.update({ where: { id: customer.id }, data: { morningClientId: client.id } });
    return client.id;
  } catch (err) {
    console.warn(`[MorningPay] could not resolve Morning client for customer ${customerId}; using inline client`, err);
    return undefined;
  }
}

export interface MorningCheckoutPayment {
  id: string;
  payToken: string | null;
  customerId: string | null;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  description: string;
  amount: number;
  maxInstallments: number | null;
}

/** Create the Morning hosted payment form for a pending CRM payment and return its URL. */
export async function createMorningCheckout(
  payment: MorningCheckoutPayment,
  installments: number,
  opts: { baseUrl?: string } = {},
): Promise<{ checkoutUrl: string; installments: number; ref: string }> {
  if (!payment.payToken) throw new Error('payment has no pay token');
  const max = Math.max(1, payment.maxInstallments || 1);
  const chosen = Math.min(max, Math.max(1, Math.floor(Number(installments) || 1)));
  const ref = morningRefForToken(payment.payToken);
  const base = publicBaseUrl(opts.baseUrl);
  const token = encodeURIComponent(payment.payToken);
  const amount = Number(payment.amount);

  const morningClientId = await resolveMorningClientId(payment.customerId);
  const result = await createPaymentForm({
    description: `${payment.description} · הזמנה ${ref}`,
    amount,
    maxPayments: chosen,
    vatType: 0,
    type: morningPaymentDocType(),
    income: [{ description: payment.description, quantity: 1, price: amount, currency: 'ILS', vatType: 1 }],
    remarks: `הזמנה ${ref}`,
    custom: ref,
    client: {
      id: morningClientId,
      name: payment.customerName || 'לקוח',
      emails: payment.customerEmail ? [payment.customerEmail] : undefined,
      phone: payment.customerPhone || undefined,
    },
    successUrl: `${base}/pay/${token}?paid=1`,
    failureUrl: `${base}/pay/${token}?failed=1`,
    notifyUrl: `${base}/api/payments/morning-notify/${token}`,
  });

  if (!result?.url || result.success === false || (result.errorCode && result.errorCode !== 0)) {
    throw new Error(`Morning payment form failed: ${result?.errorDescription || result?.errorCode || 'no url'}`);
  }
  return { checkoutUrl: result.url, installments: chosen, ref };
}

// ─── 3. verification ────────────────────────────────────────────────────────

function docAmount(doc: MorningDocument): number {
  return Number((doc as any).amount ?? (doc as any).total ?? 0);
}

export function isAcceptableMorningDoc(doc: MorningDocument | null | undefined, ref: string, expectedAmount: number): boolean {
  if (!doc?.id) return false;
  if (!ACCEPTED_DOC_TYPES.includes(Number(doc.type))) return false;
  if (CANCELLED_DOC_STATUSES.includes(Number(doc.status))) return false;
  if (Math.abs(docAmount(doc) - Number(expectedAmount)) >= AMOUNT_TOLERANCE) return false;
  return extractMorningRef(doc.description, doc.remarks) === ref;
}

/** Pull plausible Morning document ids out of an (undocumented) notify body. */
export function candidateDocIds(body: any): string[] {
  const ids = [
    body?.documentId,
    body?.document?.id,
    body?.data?.documentId,
    body?.data?.document?.id,
    body?.data?.id,
    body?.id,
  ];
  const out: string[] = [];
  for (const v of ids) {
    const s = typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
    if (s && /^[A-Za-z0-9-]{6,64}$/.test(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * Find the Morning document that proves payment for `ref`. Trusts nothing from the
 * caller except as a hint: candidate ids are fetched from the Morning API; otherwise
 * we search recent receipt documents for the ref printed in the description.
 */
export async function findMorningDocForRef(params: {
  ref: string;
  expectedAmount: number;
  since?: Date | null;
  candidateIds?: string[];
  now?: Date;
}): Promise<MorningDocument | null> {
  const { ref, expectedAmount } = params;
  for (const id of params.candidateIds || []) {
    try {
      const doc = await getMorningDocument(id);
      if (isAcceptableMorningDoc(doc, ref, expectedAmount)) return doc;
    } catch {
      // not a document id (could be a payment/transaction id) — fall through to search
    }
  }

  const now = params.now ?? new Date();
  const since = params.since ?? new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const query = {
    type: ACCEPTED_DOC_TYPES,
    fromDate: isoDate(new Date(since.getTime() - 24 * 3600 * 1000)),
    toDate: isoDate(new Date(now.getTime() + 24 * 3600 * 1000)),
    pageSize: 50,
  };

  // Narrow by description first; if Morning's description filter is not a substring
  // match, fall back to scanning the date window locally.
  const attempts: Array<typeof query & { description?: string; page: number }> = [{ ...query, description: ref, page: 1 }, { ...query, page: 1 }, { ...query, page: 2 }, { ...query, page: 3 }];
  for (const q of attempts) {
    try {
      const { items } = await searchMorningDocuments(q);
      const match = (items || []).find(d => isAcceptableMorningDoc(d, ref, expectedAmount));
      if (match) return match;
      if (!q.description && (items || []).length < q.pageSize) break;
    } catch (err) {
      console.warn('[MorningPay] document search failed', err);
      break;
    }
  }
  return null;
}

// ─── 4. settle ──────────────────────────────────────────────────────────────

export type SettleOutcome =
  | 'paid'
  | 'already_paid'
  | 'not_found'
  | 'not_morning'
  | 'no_document'
  | 'document_used_elsewhere';

export interface SettleResult {
  outcome: SettleOutcome;
  paymentId?: string;
  documentId?: string;
  invoiceUrl?: string | null;
  invoiceNumber?: string | null;
}

export function morningDocUrl(doc: MorningDocument): string {
  return doc.url?.he || doc.url?.origin || doc.url?.en || `https://app.greeninvoice.co.il/incomes/documents/${doc.id}`;
}

async function resolveCustomerForPayment(p: {
  customerId: string | null;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
}, doc: MorningDocument): Promise<string> {
  if (p.customerId) return p.customerId;
  const email = (p.customerEmail || doc.client?.emails?.find(Boolean) || '').trim().toLowerCase() || undefined;
  const phone = digits(p.customerPhone || doc.client?.mobile || doc.client?.phone);
  if (email) {
    const byEmail = await prisma.customer.findFirst({ where: { deletedAt: null, email: { equals: email, mode: 'insensitive' } }, select: { id: true } });
    if (byEmail) return byEmail.id;
  }
  if (phone.length >= 9) {
    const byPhone = await prisma.customer.findFirst({ where: { deletedAt: null, phone: { contains: phone.slice(-9) } }, select: { id: true } });
    if (byPhone) return byPhone.id;
  }
  const created = await prisma.customer.create({
    data: {
      name: p.customerName && p.customerName !== 'לקוח' ? p.customerName : (doc.client?.name || p.customerName || 'לקוח חדש'),
      email: email || undefined,
      phone: phone || undefined,
      source: 'payment_link',
    },
    select: { id: true },
  });
  return created.id;
}

async function runPostPaymentAutomations(paymentId: string) {
  for (const [name, fn] of [
    ['omer-reconcile', reconcileOmerRegistrationPayment],
    ['lead-convert', autoConvertLeadsForPayment],
    ['placement', handlePostPaymentPlacement],
  ] as const) {
    try {
      await (fn as (id: string) => Promise<unknown>)(paymentId);
    } catch (err) {
      console.error(`[MorningPay] post-payment ${name} failed for ${paymentId}`, err);
    }
  }
}

/**
 * Verify with Morning and mark a pending CRM payment paid. Idempotent and safe to
 * call from notifyUrl, the success redirect, status polling and the receipt sync.
 */
export async function settleMorningPayment(
  payToken: string,
  opts: { candidateIds?: string[] } = {},
): Promise<SettleResult> {
  const payment = await prisma.payment.findUnique({ where: { payToken } });
  if (!payment) return { outcome: 'not_found' };
  if (!isMorningPayment(payment)) return { outcome: 'not_morning', paymentId: payment.id };
  if (payment.status === 'paid') {
    return { outcome: 'already_paid', paymentId: payment.id, invoiceUrl: payment.invoiceUrl, invoiceNumber: payment.invoiceNumber };
  }

  const ref = morningRefForToken(payToken);
  const amount = Number(payment.amount);
  // Hints (notify body, webhook payload) only contribute candidate ids — the document
  // itself is always re-read from the Morning API.
  const doc = await findMorningDocForRef({ ref, expectedAmount: amount, since: payment.createdAt, candidateIds: opts.candidateIds });
  if (!doc) return { outcome: 'no_document', paymentId: payment.id };

  const marker = morningDocMarker(doc.id);
  const other = await prisma.payment.findFirst({
    where: { id: { not: payment.id }, OR: [{ description: { contains: marker } }, { description: { contains: `[${doc.id}]` } }] },
    select: { id: true },
  });
  if (other) {
    console.warn(`[MorningPay] doc ${doc.id} already recorded on payment ${other.id}; not settling ${payment.id}`);
    return { outcome: 'document_used_elsewhere', paymentId: payment.id, documentId: doc.id };
  }

  const customerId = await resolveCustomerForPayment(payment, doc);
  const invoiceUrl = morningDocUrl(doc);
  const invoiceNumber = doc.number != null ? String(doc.number) : null;
  const updated = await prisma.payment.updateMany({
    where: { id: payment.id, status: { not: 'paid' } },
    data: {
      status: 'paid',
      paidAt: new Date(),
      customerId,
      paymentMethod: MORNING_PAYMENT_METHOD,
      invoiceUrl,
      invoiceNumber,
      description: payment.description.includes(marker) ? payment.description : `${payment.description} ${marker}`,
    },
  });
  if (updated.count === 0) {
    return { outcome: 'already_paid', paymentId: payment.id, documentId: doc.id, invoiceUrl, invoiceNumber };
  }

  console.log(`[MorningPay] payment ${payment.id} paid via Morning doc #${doc.number} (${doc.id})`);
  await runPostPaymentAutomations(payment.id);
  return { outcome: 'paid', paymentId: payment.id, documentId: doc.id, invoiceUrl, invoiceNumber };
}

/** Settle by the `HT-…` ref printed on a Morning document (receipt webhook / sync hook). */
export async function settleMorningPaymentByRef(ref: string, docId?: string | null): Promise<SettleResult> {
  const prefix = tokenPrefixForRef(ref);
  if (!prefix) return { outcome: 'not_found' };
  const matches = await prisma.payment.findMany({
    where: { payToken: { startsWith: prefix }, wooOrderId: null },
    select: { payToken: true },
    take: 2,
  });
  if (matches.length !== 1 || !matches[0].payToken) return { outcome: 'not_found' };
  return settleMorningPayment(matches[0].payToken, { candidateIds: docId ? [docId] : [] });
}

// ─── 5. external (website / LMS) payments ───────────────────────────────────

export interface ExternalMorningPaymentInput {
  documentId?: string;
  ref: string;
  expectedAmount: number;
  source: string;
  description?: string;
  cycleId?: string;
  customer?: { name?: string; email?: string; phone?: string };
}

/**
 * Record a payment collected by another HaiTech surface (LMS worker, /buy pages)
 * through its own Morning payment form. The caller is API-key authenticated, but we
 * still re-read the document from Morning before writing anything.
 */
export async function recordExternalMorningPayment(input: ExternalMorningPaymentInput): Promise<{
  outcome: 'created' | 'duplicate' | 'no_document';
  paymentId?: string;
  documentId?: string;
}> {
  const ref = extractMorningRef(input.ref);
  if (!ref) return { outcome: 'no_document' };
  const doc = await findMorningDocForRef({
    ref,
    expectedAmount: input.expectedAmount,
    candidateIds: input.documentId ? [input.documentId] : [],
    since: new Date(Date.now() - 7 * 24 * 3600 * 1000),
  });
  if (!doc) return { outcome: 'no_document' };

  const marker = morningDocMarker(doc.id);
  const existing = await prisma.payment.findFirst({
    where: { OR: [{ description: { contains: marker } }, { description: { contains: `[${doc.id}]` } }] },
    select: { id: true },
  });
  if (existing) return { outcome: 'duplicate', paymentId: existing.id, documentId: doc.id };

  const name = input.customer?.name?.trim() || doc.client?.name || 'לקוח';
  const email = input.customer?.email?.trim() || doc.client?.emails?.find(Boolean) || null;
  const phone = input.customer?.phone?.trim() || doc.client?.mobile || doc.client?.phone || null;
  const customerId = await resolveCustomerForPayment(
    { customerId: null, customerName: name, customerEmail: email, customerPhone: phone },
    doc,
  );
  const baseDescription = (input.description?.trim() || doc.description || 'תשלום אתר').replace(REF_RE, ref);
  const cycleMarker = input.cycleId ? ` [cycle:${input.cycleId}]` : '';
  const payment = await prisma.payment.create({
    data: {
      customerId,
      customerName: name,
      customerEmail: email,
      customerPhone: phone,
      description: `${baseDescription}${cycleMarker} [source:${input.source}] ${marker}`,
      amount: docAmount(doc),
      currency: 'ILS',
      status: 'paid',
      paidAt: new Date(),
      paymentMethod: MORNING_PAYMENT_METHOD,
      invoiceUrl: morningDocUrl(doc),
      invoiceNumber: doc.number != null ? String(doc.number) : null,
    },
  });
  console.log(`[MorningPay] external ${input.source} payment ${payment.id} from Morning doc #${doc.number}`);
  await runPostPaymentAutomations(payment.id);
  return { outcome: 'created', paymentId: payment.id, documentId: doc.id };
}
