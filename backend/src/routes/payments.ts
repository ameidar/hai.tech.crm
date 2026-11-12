import { Router } from 'express';
import { createHmac } from 'crypto';
import { authenticate } from '../middleware/auth.js';
import { config } from '../config.js';
import { prisma } from '../utils/prisma.js';
import { handlePostPaymentPlacement } from '../services/trial-placement.js';
import { reconcileOmerRegistrationPayment } from '../services/omer-payment-reconciliation.js';
import { autoConvertLeadsForPayment } from '../services/lead-payment-evidence.js';
import { extractGreenInvoice, syncRecentWooPayments, upsertWooOrderPayment } from '../services/woo-sync.js';
import { createWooPaymentLink, inferDigitalCourseProductId } from '../services/woo-payment-link.js';
import {
  candidateDocIds,
  createMorningCheckout,
  createMorningPaymentLink,
  getPaymentsProvider,
  isMorningPayment,
  recordExternalMorningPayment,
  settleMorningPayment,
} from '../services/morning-payment-link.js';

// Shared secret for WP auto-login tokens (must match WP snippet constant)
const HAITECH_PAY_SECRET = process.env.HAITECH_PAY_SECRET || 'haitech-pay-secret-2026-xK9mP3qL7';

export { inferDigitalCourseProductId };

/** Generate a time-limited HMAC token for legacy order payment */
function generatePayToken(orderId: number): { token: string; ts: number } {
  const ts = Math.floor(Date.now() / 1000);
  const token = createHmac('sha256', HAITECH_PAY_SECRET)
    .update(`${orderId}:${ts}`)
    .digest('hex');
  return { token, ts };
}

const router = Router();

// ─── Authenticated routes ─────────────────────────────────────────────────────

router.use('/create-link', authenticate);
router.use('/order-status', authenticate);
router.use('/customer', authenticate);
router.use('/sync-woo', authenticate);

/**
 * POST /api/payments/create-link
 * Creates a pending CRM payment + public pay page. Provider is chosen by
 * PAYMENTS_PROVIDER (default `morning` → direct Morning hosted payment form;
 * `woocommerce` → legacy Woo order on haitechdigitalcourses.hai.tech).
 */
router.post('/create-link', async (req, res) => {
  const { customerId, customerName, customerPhone, customerEmail, amount, description, installments, wooProductId } = req.body;

  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    return res.status(400).json({ error: 'סכום לא תקין' });
  }
  if (!description?.trim()) {
    return res.status(400).json({ error: 'נדרש תיאור' });
  }

  const baseUrl = process.env.BASE_URL || 'https://crm.orma-ai.com';

  if (getPaymentsProvider() === 'morning') {
    try {
      const result = await createMorningPaymentLink({
        customerId,
        customerName,
        customerPhone,
        customerEmail,
        amount: Number(amount),
        description: description.trim(),
        installments,
        baseUrl,
      });
      return res.json(result);
    } catch (e: any) {
      return res.status(500).json({ error: e?.message || 'שגיאה ביצירת לינק תשלום' });
    }
  }

  try {
    const result = await createWooPaymentLink({
      customerId,
      customerName,
      customerPhone,
      customerEmail,
      amount: Number(amount),
      description: description.trim(),
      installments,
      wooProductId,
      baseUrl,
    });
    const { token, ts } = generatePayToken(result.orderId);
    return res.json({
      provider: 'woocommerce',
      ...result,
      legacyPaymentUrl: `${config.woo.siteUrl}/?haitech_pay=1&order_id=${result.orderId}&ts=${ts}&token=${token}`,
    });
  } catch (e: any) {
    if (String(e?.message || '').startsWith('שגיאה ביצירת הזמנה ב-WooCommerce')) {
      return res.status(502).json({ error: 'שגיאה ביצירת הזמנה ב-WooCommerce', details: e.message });
    }
    return res.status(500).json({ error: e?.message || 'שגיאה ביצירת לינק תשלום' });
  }
});

// ─── Public pay-page routes (no auth) ────────────────────────────────────────

/**
 * GET /api/payments/pay-page/:token
 * Public — returns order info for the CRM pay page (installment selection).
 */
router.get('/pay-page/:token', async (req, res) => {
  const { token } = req.params;
  // ?check=1 (sent by the pay page after Morning's success redirect) re-verifies the
  // payment against the Morning API — the redirect itself proves nothing.
  if (req.query.check === '1') {
    try {
      await settleMorningPayment(token);
    } catch (e) {
      console.error('[pay-page] Morning verification failed:', e);
    }
  }
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
      payToken: true,
      status: true,
    },
  });
  if (!payment) return res.status(404).json({ error: 'לינק לא קיים' });
  const { wooOrderKey: _key, payToken: _token, ...publicInfo } = payment;
  const info = { ...publicInfo, provider: isMorningPayment(payment) ? 'morning' : 'woocommerce' };
  if (payment.status === 'paid') return res.json({ ...info, alreadyPaid: true });
  res.json(info);
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
  if (payment.status === 'cancelled' || payment.status === 'refunded') {
    return res.status(400).json({ error: 'הלינק אינו פעיל' });
  }

  // Morning rows (no Woo order) always go to Morning, whatever the current flag —
  // the flag only decides how NEW links are created.
  if (isMorningPayment(payment)) {
    try {
      const result = await createMorningCheckout(payment, chosenInstallments, {
        baseUrl: process.env.BASE_URL || 'https://crm.orma-ai.com',
      });
      return res.json({ checkoutUrl: result.checkoutUrl, installments: result.installments });
    } catch (e: any) {
      console.error('[pay-page] Morning payment form error:', e);
      return res.status(502).json({ error: 'שגיאה ביצירת דף התשלום, נסו שוב בעוד רגע' });
    }
  }

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

  // Morning links: orderId is the CRM payment id (non-numeric UUID).
  if (!/^\d+$/.test(orderId)) {
    const payment = await prisma.payment.findUnique({ where: { id: orderId } });
    if (!payment) return res.status(404).json({ error: 'תשלום לא נמצא' });
    let current = payment;
    if (payment.status !== 'paid' && isMorningPayment(payment) && payment.payToken) {
      try {
        const r = await settleMorningPayment(payment.payToken);
        if (r.outcome === 'paid') current = (await prisma.payment.findUnique({ where: { id: orderId } })) || payment;
      } catch (e) {
        console.error('[order-status] Morning verification failed:', e);
      }
    }
    return res.json({
      orderId: current.id,
      status: current.status,
      total: current.amount,
      paid: current.status === 'paid',
      invoiceUrl: current.invoiceUrl,
      invoiceNumber: current.invoiceNumber,
      customerName: current.customerName,
      provider: 'morning',
    });
  }

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
 * POST /api/payments/morning-notify/:token
 * Morning payment-form notifyUrl (server-to-server, no auth). The body format is not
 * documented, so it is only used for candidate document ids; the payment is marked
 * paid only after the document is re-read from the Morning API (ref + amount match).
 * Always answers 2xx — Morning deactivates endpoints after repeated failures.
 */
router.post('/morning-notify/:token', async (req, res) => {
  const { token } = req.params;
  try {
    const result = await settleMorningPayment(token, { candidateIds: candidateDocIds(req.body) });
    console.log(`[Morning notify] ${token.slice(0, 8)}… → ${result.outcome}`);
    return res.json({ ok: true, outcome: result.outcome });
  } catch (e) {
    console.error('[Morning notify] Error:', e);
    return res.json({ ok: false });
  }
});

/**
 * POST /api/payments/morning/external
 * Server-to-server (x-api-key = API_KEY): the LMS worker / website /buy pages report a
 * payment they collected through their own Morning payment form. The CRM re-verifies
 * the document with Morning and records an idempotent paid payment.
 */
router.post('/morning/external', async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== config.apiKey) return res.status(401).json({ error: 'Invalid API key' });

  const { documentId, ref, expectedAmount, source, description, cycleId, customer } = req.body || {};
  if (!ref || typeof ref !== 'string') return res.status(400).json({ error: 'ref required' });
  if (!(Number(expectedAmount) > 0)) return res.status(400).json({ error: 'expectedAmount required' });
  if (!source || typeof source !== 'string' || !/^[a-z0-9_-]{1,64}$/i.test(source)) {
    return res.status(400).json({ error: 'source required' });
  }
  if (cycleId != null && (typeof cycleId !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(cycleId))) {
    return res.status(400).json({ error: 'invalid cycleId' });
  }

  try {
    const result = await recordExternalMorningPayment({
      documentId: typeof documentId === 'string' ? documentId : undefined,
      ref,
      expectedAmount: Number(expectedAmount),
      source,
      description: typeof description === 'string' ? description.slice(0, 300) : undefined,
      cycleId: cycleId || undefined,
      customer: customer && typeof customer === 'object' ? {
        name: typeof customer.name === 'string' ? customer.name.slice(0, 200) : undefined,
        email: typeof customer.email === 'string' ? customer.email.slice(0, 200) : undefined,
        phone: typeof customer.phone === 'string' ? customer.phone.slice(0, 40) : undefined,
      } : undefined,
    });
    if (result.outcome === 'no_document') return res.status(404).json({ ok: false, ...result });
    return res.json({ ok: true, ...result });
  } catch (e: any) {
    console.error('[Morning external] Error:', e);
    return res.status(500).json({ ok: false, error: e?.message || 'error' });
  }
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
  await autoConvertLeadsForPayment(payment.id);

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
    if (status === 'paid') await autoConvertLeadsForPayment(updated.id);
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
