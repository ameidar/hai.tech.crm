import { Router } from 'express';
import { createHmac, randomUUID } from 'crypto';
import { authenticate } from '../middleware/auth.js';
import { config } from '../config.js';
import { prisma } from '../utils/prisma.js';
import { handlePostPaymentPlacement } from '../services/trial-placement.js';
import { reconcileOmerRegistrationPayment } from '../services/omer-payment-reconciliation.js';
import { extractGreenInvoice, syncRecentWooPayments, upsertWooOrderPayment } from '../services/woo-sync.js';

// Shared secret for WP auto-login tokens (must match WP snippet constant)
const HAITECH_PAY_SECRET = process.env.HAITECH_PAY_SECRET || 'haitech-pay-secret-2026-xK9mP3qL7';

type WooAuth = { siteUrl: string; auth: string };
type WooCustomer = { id: number; email?: string; first_name?: string; last_name?: string };

const DIGITAL_COURSE_PRODUCT_ALIASES: Array<{ productId: number; aliases: string[] }> = [
  { productId: 30688, aliases: ['קורס בניית עולמות במיינקראפט', 'קורס למידה עצמית בניית עולמות minecraft באמצעות תכנות', 'minecraft worlds', 'minecraft-worlds'] },
  { productId: 30772, aliases: ['קורס רובלוקס - פיתוח משחקים עם lua', 'משחקי roblox ב-lua', 'רובלוקס lua', 'roblox lua'] },
  { productId: 30857, aliases: ["קורס תכנות בסקראץ'", 'קורס תכנות בסקראץ׳', 'scratch', 'סקראץ'] },
  { productId: 30680, aliases: ['קורס פיתוח משחקים בשפת python', 'קורס למידה עצמית – פיתוח משחקים בשפת python', 'python'] },
  { productId: 30853, aliases: ['קורס מיינקראפט + javascript', 'מיינקראפט javascript גילאי 10+', 'minecraft javascript'] },
  { productId: 30855, aliases: ['minecraft java plugins- לגילאי 12+', 'minecraft java plugins', 'java plugins'] },
  { productId: 39850, aliases: ['קורס מידול תלת מימד - tinkercad', 'tinkercad', 'מידול תלת מימד'] },
  { productId: 39737, aliases: ['קורס קנבה עם בינה מלאכותית', 'קנבה עם בינה מלאכותית', 'canva'] },
  { productId: 35988, aliases: ['קורס פיתוח אתרים ומשחקים בשילוב בינה מלאכותית', 'פיתוח אתרים ומשחקים בשילוב בינה מלאכותית'] },
  { productId: 30770, aliases: ['פיתוח בוטים לשרת דיסקורד node.js - גילאי 12+', 'discord node.js', 'דיסקורד node'] },
  { productId: 30677, aliases: ['קורס למידה עצמית תכנות לבניית מודים במיינקראפט', 'בניית מודים במיינקראפט'] },
];

function normalizeCourseText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[׳']/g, '')
    .replace(/[״"]/g, '')
    .replace(/[־–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function inferDigitalCourseProductId(description: string, amount?: number): number | null {
  const normalized = normalizeCourseText(description);
  if (!normalized) return null;
  for (const item of DIGITAL_COURSE_PRODUCT_ALIASES) {
    if (item.aliases.some((alias) => normalized.includes(normalizeCourseText(alias)))) {
      return item.productId;
    }
  }
  if (Number(amount) === 297 && normalized.includes('מחנה') && normalized.includes('מיינקראפט')) return 39309;
  return null;
}

function buildWooOrderLinePayload(description: string, amount: number, wooProductId?: number | null) {
  if (wooProductId) {
    return {
      line_items: [{
        product_id: wooProductId,
        quantity: 1,
        total: String(Number(amount).toFixed(2)),
      }],
    };
  }

  return {
    fee_lines: [{
      name: description.trim(),
      total: String(Number(amount).toFixed(2)),
    }],
  };
}

/** Generate a time-limited HMAC token for order payment */
function generatePayToken(orderId: number): { token: string; ts: number } {
  const ts = Math.floor(Date.now() / 1000);
  const token = createHmac('sha256', HAITECH_PAY_SECRET)
    .update(`${orderId}:${ts}`)
    .digest('hex');
  return { token, ts };
}

async function wooFetchJson<T>(
  { siteUrl, auth }: WooAuth,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${siteUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const bodyText = await res.text();
  let body: any = null;
  try { body = bodyText ? JSON.parse(bodyText) : null; } catch { body = bodyText; }
  if (!res.ok) {
    const message = typeof body === 'string' ? body : body?.message || bodyText;
    throw new Error(`WooCommerce API error (${res.status}): ${message}`);
  }
  return body as T;
}

async function ensureWooCustomerId(
  woo: WooAuth,
  email: string,
  firstName: string,
  lastName: string,
  phone?: string
): Promise<number | null> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return null;

  try {
    const existing = await wooFetchJson<WooCustomer[]>(
      woo,
      `/wp-json/wc/v3/customers?email=${encodeURIComponent(normalizedEmail)}`
    );
    if (existing[0]?.id) return existing[0].id;

    const created = await wooFetchJson<WooCustomer>(woo, '/wp-json/wc/v3/customers', {
      method: 'POST',
      body: JSON.stringify({
        email: normalizedEmail,
        first_name: firstName,
        last_name: lastName,
        billing: {
          first_name: firstName,
          last_name: lastName,
          email: normalizedEmail,
          phone: phone || '',
        },
      }),
    });
    return created.id || null;
  } catch (error) {
    console.warn('[payments/create-link] Could not resolve Woo customer, creating guest order:', error);
    return null;
  }
}

const router = Router();

// ─── Authenticated routes ─────────────────────────────────────────────────────

router.use('/create-link', authenticate);
router.use('/order-status', authenticate);
router.use('/customer', authenticate);
router.use('/sync-woo', authenticate);

/**
 * POST /api/payments/create-link
 * Creates a WooCommerce order and returns a payment URL. Saves to DB.
 */
router.post('/create-link', async (req, res) => {
  const { customerId, customerName, customerPhone, customerEmail, amount, description, installments, wooProductId } = req.body;
  // maxInstallments = customer can choose from 1 up to this number on the CRM pay page
  const maxInstallments = installments && Number(installments) > 1 ? Number(installments) : 1;

  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    return res.status(400).json({ error: 'סכום לא תקין' });
  }
  if (!description?.trim()) {
    return res.status(400).json({ error: 'נדרש תיאור' });
  }

  const { siteUrl, consumerKey, consumerSecret } = config.woo;
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const woo = { siteUrl, auth };

  const nameParts = (customerName || 'לקוח').trim().split(' ');
  const firstName = nameParts[0] || 'לקוח';
  const lastName = nameParts.slice(1).join(' ') || '';
  const normalizedEmail = String(customerEmail || '').trim().toLowerCase();
  const resolvedWooCustomerId = normalizedEmail
    ? await ensureWooCustomerId(woo, normalizedEmail, firstName, lastName, customerPhone)
    : null;
  const requestedProductId = Number(wooProductId);
  const productId = Number.isInteger(requestedProductId) && requestedProductId > 0
    ? requestedProductId
    : inferDigitalCourseProductId(description.trim(), Number(amount));

  // Create WC order WITHOUT installments — customer picks on CRM pay page.
  // Digital course payments should use real Woo products so LearnDash grants
  // access to the buyer. Generic/manual payments remain fee lines.
  const orderPayload: any = {
    payment_method: 'greeninvoice-creditcard',
    payment_method_title: 'כרטיס אשראי / ביט',
    status: 'pending',
    ...(resolvedWooCustomerId ? { customer_id: resolvedWooCustomerId } : {}),
    billing: {
      first_name: firstName,
      last_name: lastName,
      email: normalizedEmail || 'noreply@haitech.co.il',
      phone: customerPhone || '',
    },
    meta_data: productId ? [{ key: 'haitech_crm_digital_product_id', value: String(productId) }] : [],
    ...buildWooOrderLinePayload(description.trim(), Number(amount), productId),
  };

  const wooRes = await fetch(`${siteUrl}/wp-json/wc/v3/orders`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(orderPayload),
  });

  if (!wooRes.ok) {
    const errText = await wooRes.text();
    console.error('WooCommerce order error:', errText);
    return res.status(502).json({ error: 'שגיאה ביצירת הזמנה ב-WooCommerce', details: errText });
  }

  const order = (await wooRes.json()) as { id: number; order_key: string };

  // Auto-link to customer by phone if customerId not provided
  let resolvedCustomerId = customerId || null;
  if (!resolvedCustomerId && customerPhone) {
    const normalizedPhone = customerPhone.replace(/\D/g, '');
    const found = await prisma.customer.findFirst({
      where: {
        phone: { contains: normalizedPhone.slice(-9) }, // match last 9 digits
      },
      select: { id: true },
    });
    if (found) resolvedCustomerId = found.id;
  }

  // Generate CRM pay page token
  const payToken = randomUUID();
  const baseUrl = process.env.BASE_URL || 'https://crm.orma-ai.com';

  // Save to CRM DB
  const payment = await prisma.payment.create({
    data: {
      customerId: resolvedCustomerId,
      customerName: customerName || 'לקוח',
      customerEmail: customerEmail || null,
      customerPhone: customerPhone || null,
      description: description.trim(),
      amount: Number(amount),
      currency: 'ILS',
      wooOrderId: order.id,
      wooOrderKey: order.order_key,
      status: 'pending',
      payToken,
      maxInstallments: maxInstallments > 1 ? maxInstallments : null,
    },
  });

  // CRM pay page — customer picks installments here
  const crmPayUrl = `${baseUrl}/pay/${payToken}`;

  // Legacy WC URL (used after installment selection)
  const { token, ts } = generatePayToken(order.id);
  const paymentUrl = `${siteUrl}/?haitech_pay=1&order_id=${order.id}&ts=${ts}&token=${token}`;
  const directPaymentUrl = `${siteUrl}/checkout/order-pay/${order.id}/?pay_for_order=true&key=${order.order_key}`;

  return res.json({
    paymentId: payment.id,
    orderId: order.id,
    orderKey: order.order_key,
    paymentUrl: crmPayUrl,        // ← CRM pay page with installment picker
    directPaymentUrl,
    legacyPaymentUrl: paymentUrl, // ← direct WC URL (for fallback)
    amount: Number(amount),
    description: description.trim(),
    maxInstallments,
    wooProductId: productId,
    wooCustomerId: resolvedWooCustomerId,
  });
});

// ─── Public pay-page routes (no auth) ────────────────────────────────────────

/**
 * GET /api/payments/pay-page/:token
 * Public — returns order info for the CRM pay page (installment selection).
 */
router.get('/pay-page/:token', async (req, res) => {
  const { token } = req.params;
  const payment = await prisma.payment.findUnique({
    where: { payToken: token },
    select: {
      id: true,
      customerName: true,
      description: true,
      amount: true,
      currency: true,
      maxInstallments: true,
      wooOrderId: true,
      wooOrderKey: true,
      status: true,
    },
  });
  if (!payment) return res.status(404).json({ error: 'לינק לא קיים' });
  if (payment.status === 'paid') return res.json({ ...payment, alreadyPaid: true });
  res.json(payment);
});

/**
 * POST /api/payments/pay-page/:token/confirm
 * Public — customer confirms installments, WC order is updated, returns checkout URL.
 */
router.post('/pay-page/:token/confirm', async (req, res) => {
  const { token } = req.params;
  const { installments } = req.body;
  const chosenInstallments = installments && Number(installments) > 0 ? Number(installments) : 1;

  const payment = await prisma.payment.findUnique({
    where: { payToken: token },
  });
  if (!payment) return res.status(404).json({ error: 'לינק לא קיים' });
  if (payment.status === 'paid') return res.status(400).json({ error: 'התשלום כבר בוצע' });
  if (!payment.wooOrderId || !payment.wooOrderKey) {
    return res.status(500).json({ error: 'הזמנה לא מקושרת ל-WooCommerce' });
  }

  const { siteUrl, consumerKey, consumerSecret } = config.woo;
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

  // Update WC order with chosen installments
  const updatePayload: any = {
    payment_method_title: chosenInstallments > 1
      ? `כרטיס אשראי — ${chosenInstallments} תשלומים`
      : 'כרטיס אשראי / ביט',
    meta_data: chosenInstallments > 1 ? [
      { key: 'num_payments', value: String(chosenInstallments) },
      { key: '_greeninvoice_number_of_payments', value: String(chosenInstallments) },
      { key: 'installments', value: String(chosenInstallments) },
    ] : [],
  };

  // Also update fee line name to reflect installments
  const descWithInstallments = chosenInstallments > 1
    ? `${payment.description} — ${chosenInstallments} תשלומים`
    : payment.description;

  // Fetch current fee lines to get their IDs for update
  const wooFetch = await fetch(`${siteUrl}/wp-json/wc/v3/orders/${payment.wooOrderId}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (wooFetch.ok) {
    const wooOrder = await wooFetch.json() as any;
    const feeLineId = wooOrder.fee_lines?.[0]?.id;
    if (feeLineId) {
      updatePayload.fee_lines = [{ id: feeLineId, name: descWithInstallments }];
    }
  }

  await fetch(`${siteUrl}/wp-json/wc/v3/orders/${payment.wooOrderId}`, {
    method: 'PUT',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(updatePayload),
  });

  // Return direct order-pay URL. The WordPress site has a signed order-key
  // capability snippet, so we do not need the crm-payments auto-login that
  // rewrites the Woo customer and breaks buyer-specific LearnDash access.
  const checkoutUrl = `${siteUrl}/checkout/order-pay/${payment.wooOrderId}/?pay_for_order=true&key=${payment.wooOrderKey}`;

  res.json({ checkoutUrl, installments: chosenInstallments });
});

// ─── Authenticated routes ─────────────────────────────────────────────────────

/**
 * GET /api/payments/order-status/:orderId
 * Checks WooCommerce order payment status and updates DB.
 */
router.get('/order-status/:orderId', async (req, res) => {
  const { orderId } = req.params;
  const { siteUrl, consumerKey, consumerSecret } = config.woo;
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

  const wooRes = await fetch(`${siteUrl}/wp-json/wc/v3/orders/${orderId}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!wooRes.ok) return res.status(502).json({ error: 'Failed to fetch order' });

  const order = (await wooRes.json()) as any;
  const paid = ['processing', 'completed', 'on-hold'].includes(order.status);

  // Extract Morning invoice URL from order meta
  let { invoiceUrl, invoiceNumber } = extractGreenInvoice(order.meta_data || []);

  // Update DB if paid
  if (paid) {
    try {
      const result = await upsertWooOrderPayment(order, { source: 'manual' });
      invoiceUrl = result.invoiceUrl || invoiceUrl;
      invoiceNumber = result.invoiceNumber || invoiceNumber;
    } catch (e) {
      console.error('Failed to update payment in DB:', e);
    }
  }

  res.json({
    orderId: order.id,
    status: order.status,
    total: order.total,
    paid,
    invoiceUrl,
    invoiceNumber,
    customerName: order.billing
      ? `${order.billing.first_name || ''} ${order.billing.last_name || ''}`.trim()
      : '',
  });
});

/**
 * GET /api/payments/customer/:customerId
 * List all payments for a specific customer.
 */
router.get('/customer/:customerId', async (req, res) => {
  const { customerId } = req.params;
  const payments = await prisma.payment.findMany({
    where: { customerId },
    orderBy: { createdAt: 'desc' },
  });
  res.json(payments);
});

/**
 * POST /api/payments/wc-webhook
 * Receives WooCommerce order status webhooks.
 * No auth — secured by WC webhook secret header.
 */
router.post('/wc-webhook', async (req, res) => {
  res.status(200).json({ ok: true }); // Acknowledge immediately

  try {
    const order = req.body as any;
    if (!order?.id) return;
    const result = await upsertWooOrderPayment(order, { runPlacementAutomation: true, source: 'webhook' });
    console.log(`[WC Webhook] ${result.action} order ${order.id} → ${order.status}`);
  } catch (e) {
    console.error('[WC Webhook] Error:', e);
  }
});

/**
 * POST /api/payments/sync-woo
 * Admin only — syncs recent paid WooCommerce orders into the CRM.
 * Fetches orders with status on-hold/processing/completed from the last N days.
 */
router.post('/sync-woo', async (req: any, res) => {
  if (!req.user || !['admin', 'manager'].includes(req.user.role)) {
    return res.status(403).json({ error: 'אין הרשאה' });
  }

  try {
    const days = Number(req.query.days) || 7;
    const result = await syncRecentWooPayments(days);
    console.log(`[sync-woo] Synced ${result.created} new, updated ${result.updated}, skipped ${result.skipped}, failed ${result.failed}`);
    res.json(result);
  } catch (err: any) {
    console.error('[sync-woo] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/payments/manual
 * Admin/manager — manually record a received payment (no WooCommerce order).
 * Body: { customerId?, customerName?, customerEmail?, customerPhone?,
 *         amount, description, paidAt?, paymentMethod? }
 */
router.post('/manual', authenticate, async (req: any, res) => {
  if (!req.user || !['admin', 'manager'].includes(req.user.role)) {
    return res.status(403).json({ error: 'אין הרשאה' });
  }

  const { customerId, customerName, customerEmail, customerPhone, amount, description, paidAt, paymentMethod } = req.body;

  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    return res.status(400).json({ error: 'סכום לא תקין' });
  }
  if (!description?.trim()) {
    return res.status(400).json({ error: 'נדרש תיאור' });
  }

  // Resolve customer name if only ID was provided
  let resolvedName = customerName || 'לקוח';
  let resolvedEmail = customerEmail || undefined;
  let resolvedPhone = customerPhone || undefined;

  if (customerId && !customerName) {
    try {
      const cust = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { name: true, email: true, phone: true },
      });
      if (cust) {
        resolvedName = cust.name || resolvedName;
        resolvedEmail = resolvedEmail || cust.email || undefined;
        resolvedPhone = resolvedPhone || cust.phone || undefined;
      }
    } catch { /* ignore */ }
  }

  const payment = await prisma.payment.create({
    data: {
      customerId: customerId || null,
      customerName: resolvedName,
      customerEmail: resolvedEmail || null,
      customerPhone: resolvedPhone || null,
      description: description.trim(),
      amount: Number(amount),
      currency: 'ILS',
      status: 'paid',
      paidAt: paidAt ? new Date(paidAt) : new Date(),
      paymentMethod: paymentMethod || null,
      // wooOrderId intentionally left null — manual entry
    },
  });

  // Trial-lesson placement automation (non-digital payments → flag + notify).
  await reconcileOmerRegistrationPayment(payment.id);
  await handlePostPaymentPlacement(payment.id);

  return res.status(201).json(payment);
});

/**
 * GET /api/payments/today
 * Returns all payments with paidAt = today (Israel time) + total sum.
 */
router.get('/today', authenticate, async (req: any, res) => {
  if (!req.user || !['admin', 'manager'].includes(req.user.role)) {
    return res.status(403).json({ error: 'אין הרשאה' });
  }

  // Prevent Cloudflare / any proxy from caching this dynamic endpoint
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Surrogate-Control', 'no-store');

  // Israel time — UTC+2 (or UTC+3 DST, but safe to use fixed +2 for day boundaries)
  const now = new Date();
  const israelOffset = 2 * 60 * 60 * 1000; // UTC+2
  const israelNow = new Date(now.getTime() + israelOffset);
  const todayStr = israelNow.toISOString().slice(0, 10); // YYYY-MM-DD

  const dayStart = new Date(`${todayStr}T00:00:00.000+02:00`);
  const dayEnd = new Date(`${todayStr}T23:59:59.999+02:00`);

  const payments = await prisma.payment.findMany({
    where: {
      status: 'paid',
      paidAt: { gte: dayStart, lte: dayEnd },
    },
    orderBy: { paidAt: 'desc' },
  });

  const total = payments.reduce((sum, p) => sum + Number(p.amount), 0);

  return res.json({ date: todayStr, total, count: payments.length, payments });
});

/**
 * PATCH /api/payments/:id
 * Update payment fields (invoiceUrl, invoiceNumber, status). Admin/manager only.
 */
router.patch('/:id', authenticate, async (req, res) => {
  const user = (req as any).user;
  if (!['admin', 'manager'].includes(user?.role)) {
    return res.status(403).json({ error: 'אין הרשאה' });
  }
  const { id } = req.params;
  const { invoiceUrl, invoiceNumber, status } = req.body;

  const updateData: any = { updatedAt: new Date() };
  if (invoiceUrl !== undefined) updateData.invoiceUrl = invoiceUrl || null;
  if (invoiceNumber !== undefined) updateData.invoiceNumber = invoiceNumber || null;
  if (status !== undefined) updateData.status = status;

  try {
    const updated = await prisma.payment.update({ where: { id }, data: updateData });
    return res.json(updated);
  } catch (e: any) {
    if (e?.code === 'P2025') return res.status(404).json({ error: 'לא נמצא' });
    throw e;
  }
});

// DELETE /api/payments/:id — admin/manager only, cannot delete already-paid payments
router.delete('/:id', authenticate, async (req, res) => {
  const user = (req as any).user;
  if (!['admin', 'manager'].includes(user?.role)) {
    return res.status(403).json({ error: 'אין הרשאה' });
  }
  const { id } = req.params;
  try {
    const payment = await prisma.payment.findUnique({ where: { id } });
    if (!payment) return res.status(404).json({ error: 'תשלום לא נמצא' });
    if (payment.status === 'paid') {
      return res.status(409).json({ error: 'לא ניתן למחוק תשלום ששולם. שנה סטטוס ל"מבוטל" תחילה.' });
    }
    await prisma.payment.delete({ where: { id } });
    return res.status(204).send();
  } catch (e: any) {
    if (e?.code === 'P2025') return res.status(404).json({ error: 'לא נמצא' });
    throw e;
  }
});

export const paymentsRouter = router;
