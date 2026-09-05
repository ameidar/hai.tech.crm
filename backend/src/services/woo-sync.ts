import { config } from '../config.js';
import { prisma } from '../utils/prisma.js';
import { createMorningClient, findClientForCustomer } from './morning/clients.js';
import { DOCUMENT_TYPES, searchMorningDocuments, type MorningDocument } from './morning/documents.js';
import { reconcileOmerRegistrationPayment } from './omer-payment-reconciliation.js';
import { handlePostPaymentPlacement } from './trial-placement.js';

type WooMeta = { key?: string; value?: any };

export type WooOrder = {
  id?: number | string;
  status?: string;
  total?: string | number;
  date_paid?: string | null;
  date_modified?: string | null;
  payment_method?: string | null;
  billing?: {
    email?: string | null;
    phone?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  };
  line_items?: Array<{ name?: string | null }>;
  fee_lines?: Array<{ name?: string | null }>;
  meta_data?: WooMeta[];
};

export type WooPaymentSyncAction =
  | 'created'
  | 'updated'
  | 'skipped_pending'
  | 'skipped_invalid';

export type WooPaymentSyncResult = {
  action: WooPaymentSyncAction;
  orderId?: number;
  paymentId?: string;
  invoiceUrl?: string | null;
  invoiceNumber?: string | null;
  invoiceSource?: 'woo' | 'morning-search' | null;
};

export type WooRecentSyncResult = {
  ok: true;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  total: number;
  days: number;
};

const PAID_WOO_STATUSES = new Set(['processing', 'completed', 'on-hold']);
const MORNING_WOO_DOCUMENT_TYPES = [
  DOCUMENT_TYPES.TAX_INVOICE_RECEIPT,
  DOCUMENT_TYPES.RECEIPT,
  DOCUMENT_TYPES.TAX_INVOICE,
];

export function isPaidWooStatus(status: string | undefined | null): boolean {
  return PAID_WOO_STATUSES.has(String(status || ''));
}

/** Extract Morning/GreenInvoice invoice URL and number from WC order meta_data. */
export function extractGreenInvoice(metaData: WooMeta[] = []): { invoiceUrl: string | null; invoiceNumber: string | null } {
  const giData = metaData.find((m) => m.key === 'greeninvoice_data');
  if (giData?.value) {
    let gd = giData.value;
    if (typeof gd === 'string') {
      try { gd = JSON.parse(gd); } catch { gd = null; }
    }
    if (gd && typeof gd === 'object' && gd.id) {
      return {
        invoiceUrl: `https://app.greeninvoice.co.il/incomes/documents/${gd.id}`,
        invoiceNumber: String(gd.number || gd.document_id || ''),
      };
    }
  }

  const urlMeta = metaData.find((m) => m.key === '_greeninvoice_document_url' || m.key === 'greeninvoice_document_url');
  const numMeta = metaData.find((m) => m.key === '_greeninvoice_document_number' || m.key === 'greeninvoice_document_number');
  return {
    invoiceUrl: urlMeta?.value || null,
    invoiceNumber: numMeta?.value || null,
  };
}

function normalizeText(value: string | null | undefined): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@.]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function digitsOnly(value: string | null | undefined): string {
  return String(value || '').replace(/\D/g, '');
}

function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const aTime = new Date(`${a}T00:00:00.000Z`).getTime();
  const bTime = new Date(`${b}T00:00:00.000Z`).getTime();
  if (Number.isNaN(aTime) || Number.isNaN(bTime)) return null;
  return Math.abs(aTime - bTime) / (24 * 60 * 60 * 1000);
}

function getWooBillingCustomer(order: WooOrder): { email: string | undefined; phone: string; fullName: string } {
  const email = order.billing?.email?.trim().toLowerCase() || undefined;
  const phone = digitsOnly(order.billing?.phone);
  const firstName = order.billing?.first_name || '';
  const lastName = order.billing?.last_name || '';
  const fullName = `${firstName} ${lastName}`.trim();
  return { email, phone, fullName };
}

function morningDocumentUrl(doc: MorningDocument): string | null {
  return doc.url?.he || doc.url?.origin || doc.url?.en || (doc.id ? `https://app.greeninvoice.co.il/incomes/documents/${doc.id}` : null);
}

function isClearMorningWooInvoiceMatch(order: WooOrder, doc: MorningDocument): boolean {
  const orderAmount = Number(order.total || 0);
  const docAmount = Number(doc.amount || 0);
  if (!Number.isFinite(orderAmount) || !Number.isFinite(docAmount)) return false;
  if (Math.abs(orderAmount - docAmount) > 0.05) return false;

  const paidDate = dateOnly(order.date_paid || order.date_modified || null);
  const docDate = dateOnly(doc.documentDate);
  const dateDiff = daysBetween(paidDate, docDate);
  if (dateDiff === null || dateDiff > 3) return false;

  const { email, phone, fullName } = getWooBillingCustomer(order);
  const client = doc.client || {};
  const clientText = normalizeText([
    client.name,
    ...(Array.isArray(client.emails) ? client.emails : []),
    client.phone,
    client.mobile,
  ].filter(Boolean).join(' '));

  const emailMatch = !!email && clientText.includes(normalizeText(email));
  const phoneTail = phone.length >= 7 ? phone.slice(-7) : '';
  const clientDigits = digitsOnly(`${client.phone || ''} ${client.mobile || ''}`);
  const phoneMatch = !!phoneTail && clientDigits.includes(phoneTail);
  const nameParts = normalizeText(fullName).split(' ').filter((part) => part.length > 1);
  const nameMatch = nameParts.length > 0 && nameParts.every((part) => clientText.includes(part));

  return emailMatch || phoneMatch || nameMatch;
}

export async function findMorningInvoiceForWooOrder(order: WooOrder): Promise<{ invoiceUrl: string; invoiceNumber: string } | null> {
  const paidDate = dateOnly(order.date_paid || order.date_modified || null);
  const orderAmount = Number(order.total || 0);
  if (!paidDate || !Number.isFinite(orderAmount) || orderAmount <= 0) return null;

  try {
    const matches: MorningDocument[] = [];
    const { items } = await searchMorningDocuments({ type: MORNING_WOO_DOCUMENT_TYPES, page: 1, pageSize: 100 });
    for (const doc of items || []) {
      if (isClearMorningWooInvoiceMatch(order, doc) && morningDocumentUrl(doc)) matches.push(doc);
    }

    const unique = new Map(matches.map((doc) => [doc.id, doc]));
    if (unique.size !== 1) {
      if (unique.size > 1) {
        console.warn(`[WooSync] Morning invoice fallback found ${unique.size} possible documents for Woo order ${order.id}; leaving invoice empty`);
      }
      return null;
    }

    const doc = [...unique.values()][0];
    return {
      invoiceUrl: morningDocumentUrl(doc)!,
      invoiceNumber: String(doc.number || ''),
    };
  } catch (error) {
    console.warn(`[WooSync] Morning invoice fallback failed for Woo order ${order.id}:`, error);
    return null;
  }
}

/**
 * Resolve or auto-create a CRM customer from WooCommerce billing info.
 * Search order: email → phone → create new.
 */
async function resolveOrCreateCustomer(
  email: string | undefined,
  phone: string,
  fullName: string
): Promise<string> {
  if (email) {
    const byEmail = await prisma.customer.findFirst({ where: { email } });
    if (byEmail) return byEmail.id;
  }

  if (phone.length >= 9) {
    const byPhone = await prisma.customer.findFirst({
      where: { phone: { contains: phone.slice(-9) } },
    });
    if (byPhone) return byPhone.id;
  }

  const newCustomer = await prisma.customer.create({
    data: {
      name: fullName || email || 'לקוח חדש',
      email: email || undefined,
      phone: phone || undefined,
      source: 'website',
    },
  });
  console.log(`[Payments] Auto-created customer "${newCustomer.name}" (${newCustomer.id}) from WC order`);
  return newCustomer.id;
}

async function ensureMorningClientForCustomer(customerId: string): Promise<string | null> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      address: true,
      city: true,
      morningClientId: true,
    },
  });
  if (!customer) return null;
  if (customer.morningClientId) return customer.morningClientId;

  try {
    const existing = await findClientForCustomer({
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
    });
    const morningClient = existing ?? await createMorningClient({
      name: customer.name,
      emails: customer.email ? [customer.email] : undefined,
      phone: customer.phone ?? undefined,
      address: customer.address ?? undefined,
      city: customer.city ?? undefined,
    });

    await prisma.customer.update({
      where: { id: customer.id },
      data: { morningClientId: morningClient.id },
    });
    console.log(`[WooSync] Linked CRM customer ${customer.id} -> Morning client ${morningClient.id}`);
    return morningClient.id;
  } catch (error) {
    console.error(`[WooSync] Failed to ensure Morning client for CRM customer ${customer.id}:`, error);
    return null;
  }
}

function getWooOrderDescription(order: WooOrder): string {
  const items: string[] = [];
  for (const li of order.line_items || []) if (li.name) items.push(li.name);
  for (const fl of order.fee_lines || []) if (fl.name) items.push(fl.name);
  return items.join(', ') || 'קורס דיגיטלי';
}

export async function upsertWooOrderPayment(
  order: WooOrder,
  options: { runPlacementAutomation?: boolean; source?: 'webhook' | 'sync' | 'manual' } = {}
): Promise<WooPaymentSyncResult> {
  const orderId = Number(order.id);
  if (!Number.isFinite(orderId) || orderId <= 0) {
    return { action: 'skipped_invalid' };
  }

  const paid = isPaidWooStatus(order.status);
  let invoiceSource: WooPaymentSyncResult['invoiceSource'] = null;
  let { invoiceUrl, invoiceNumber } = extractGreenInvoice(order.meta_data || []);
  if (invoiceUrl) invoiceSource = 'woo';
  const existing = await prisma.payment.findFirst({ where: { wooOrderId: orderId } });

  if (paid && !invoiceUrl && !existing?.invoiceUrl) {
    const morningInvoice = await findMorningInvoiceForWooOrder(order);
    if (morningInvoice) {
      invoiceUrl = morningInvoice.invoiceUrl;
      invoiceNumber = morningInvoice.invoiceNumber;
      invoiceSource = 'morning-search';
    }
  }

  const updateData: any = {
    status: paid ? 'paid' : order.status === 'cancelled' ? 'cancelled' : 'pending',
    paymentMethod: order.payment_method || undefined,
    updatedAt: new Date(),
  };
  if (paid) {
    updateData.paidAt = new Date(order.date_paid || order.date_modified || Date.now());
  }
  if (invoiceUrl) updateData.invoiceUrl = invoiceUrl;
  if (invoiceNumber) updateData.invoiceNumber = invoiceNumber;

  if (existing) {
    const customerPatch: any = {};
    if (paid && !existing.customerId) {
      const { email, phone, fullName } = getWooBillingCustomer(order);
      const customerId = await resolveOrCreateCustomer(email, phone, fullName);

      customerPatch.customerId = customerId;
      if (fullName) customerPatch.customerName = fullName;
      customerPatch.customerEmail = email || null;
      customerPatch.customerPhone = phone || null;
    }

    await prisma.payment.update({ where: { id: existing.id }, data: { ...updateData, ...customerPatch } });
    if (paid) {
      const linkedCustomerId = customerPatch.customerId || existing.customerId;
      if (linkedCustomerId) await ensureMorningClientForCustomer(linkedCustomerId);
      await reconcileOmerRegistrationPayment(existing.id);
    }
    return {
      action: 'updated',
      orderId,
      paymentId: existing.id,
      invoiceUrl: invoiceUrl || existing.invoiceUrl || null,
      invoiceNumber: invoiceNumber || existing.invoiceNumber || null,
      invoiceSource,
    };
  }

  if (!paid) {
    return { action: 'skipped_pending', orderId };
  }

  const { email, phone, fullName } = getWooBillingCustomer(order);
  const customerId = await resolveOrCreateCustomer(email, phone, fullName);
  await ensureMorningClientForCustomer(customerId);

  const createdPayment = await prisma.payment.create({
    data: {
      wooOrderId: orderId,
      amount: parseFloat(String(order.total || '0')),
      description: getWooOrderDescription(order),
      status: 'paid',
      paidAt: new Date(order.date_paid || order.date_modified || Date.now()),
      paymentMethod: order.payment_method || undefined,
      customerName: fullName || email || `הזמנה #${orderId}`,
      customerEmail: email || undefined,
      customerPhone: phone || undefined,
      invoiceUrl: invoiceUrl || undefined,
      invoiceNumber: invoiceNumber || undefined,
      customerId,
    },
  });

  if (options.runPlacementAutomation) {
    await handlePostPaymentPlacement(createdPayment.id);
  }

  await reconcileOmerRegistrationPayment(createdPayment.id);

  return { action: 'created', orderId, paymentId: createdPayment.id, invoiceUrl: invoiceUrl || null, invoiceNumber: invoiceNumber || null, invoiceSource };
}

export async function syncRecentWooPayments(days = 1): Promise<WooRecentSyncResult> {
  const safeDays = Number.isFinite(days) && days > 0 ? Math.min(Math.ceil(days), 30) : 1;
  const after = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString();

  const wooRes = await fetch(
    `${config.woo.siteUrl}/wp-json/wc/v3/orders?per_page=50&status=on-hold,processing,completed&after=${encodeURIComponent(after)}`,
    { headers: { Authorization: 'Basic ' + Buffer.from(`${config.woo.consumerKey}:${config.woo.consumerSecret}`).toString('base64') } }
  );
  if (!wooRes.ok) throw new Error(`WooCommerce API error (${wooRes.status})`);

  const orders = await wooRes.json() as WooOrder[];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const order of orders) {
    try {
      const result = await upsertWooOrderPayment(order, { source: 'sync' });
      if (result.action === 'created') created++;
      else if (result.action === 'updated') updated++;
      else skipped++;
    } catch (error) {
      failed++;
      console.error(`[WooSync] Failed to sync Woo order ${order?.id || 'unknown'}:`, error);
    }
  }

  return { ok: true, created, updated, skipped, failed, total: orders.length, days: safeDays };
}
