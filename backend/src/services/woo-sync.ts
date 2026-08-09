import { config } from '../config.js';
import { prisma } from '../utils/prisma.js';
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
  const { invoiceUrl, invoiceNumber } = extractGreenInvoice(order.meta_data || []);
  const existing = await prisma.payment.findFirst({ where: { wooOrderId: orderId } });

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
    await prisma.payment.update({ where: { id: existing.id }, data: updateData });
    if (paid) await reconcileOmerRegistrationPayment(existing.id);
    return { action: 'updated', orderId, paymentId: existing.id };
  }

  if (!paid) {
    return { action: 'skipped_pending', orderId };
  }

  const email = order.billing?.email || undefined;
  const phone = (order.billing?.phone || '').replace(/\D/g, '');
  const firstName = order.billing?.first_name || '';
  const lastName = order.billing?.last_name || '';
  const fullName = `${firstName} ${lastName}`.trim();
  const customerId = await resolveOrCreateCustomer(email, phone, fullName);

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

  return { action: 'created', orderId, paymentId: createdPayment.id };
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
