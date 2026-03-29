import { Router } from 'express';
import { createHmac, randomUUID } from 'crypto';
import { authenticate } from '../middleware/auth.js';
import { config } from '../config.js';
import { prisma } from '../utils/prisma.js';

// Shared secret for WP auto-login tokens (must match WP snippet constant)
const HAITECH_PAY_SECRET = process.env.HAITECH_PAY_SECRET || 'haitech-pay-secret-2026-xK9mP3qL7';
// WordPress user ID for crm-payments (created 01/03/2026)
const CRM_PAYMENTS_WP_USER_ID = 354;

/** Generate a time-limited HMAC token for order payment */
function generatePayToken(orderId: number): { token: string; ts: number } {
  const ts = Math.floor(Date.now() / 1000);
  const token = createHmac('sha256', HAITECH_PAY_SECRET)
    .update(`${orderId}:${ts}`)
    .digest('hex');
  return { token, ts };
}

/**
 * Resolve or auto-create a CRM customer from WooCommerce billing info.
 * Search order: email → phone → create new.
 * Returns the customer ID (always).
 */
async function resolveOrCreateCustomer(
  email: string | undefined,
  phone: string,
  fullName: string
): Promise<string> {
  // 1. Try by email
  if (email) {
    const byEmail = await prisma.customer.findFirst({ where: { email } });
    if (byEmail) return byEmail.id;
  }
  // 2. Try by phone (last 9 digits)
  if (phone.length >= 9) {
    const byPhone = await prisma.customer.findFirst({
      where: { phone: { contains: phone.slice(-9) } },
    });
    if (byPhone) return byPhone.id;
  }
  // 3. Create new customer — will appear in CRM for follow-up
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

/** Extract Morning/GreenInvoice invoice URL and number from WC order meta_data */
function extractGreenInvoice(metaData: any[]): { invoiceUrl: string | null; invoiceNumber: string | null } {
  // Primary: greeninvoice_data JSON object (contains id → view URL)
  const giData = metaData?.find((m: any) => m.key === 'greeninvoice_data');
  if (giData?.value) {
    let gd = giData.value;
    // WooCommerce REST API may return it as a string — parse if needed
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
  // Fallback: _greeninvoice_document_url (older format)
  const urlMeta = metaData?.find((m: any) => m.key === '_greeninvoice_document_url' || m.key === 'greeninvoice_document_url');
  const numMeta = metaData?.find((m: any) => m.key === '_greeninvoice_document_number' || m.key === 'greeninvoice_document_number');
  return {
    invoiceUrl: urlMeta?.value || null,
    invoiceNumber: numMeta?.value || null,
  };
}

/** Fetch WooCommerce order details */
async function getWooOrder(orderId: number) {
  const { siteUrl, consumerKey, consumerSecret } = config.woo;
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const res = await fetch(`${siteUrl}/wp-json/wc/v3/orders/${orderId}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) return null;
  return res.json() as Promise<any>;
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
  const { customerId, customerName, customerPhone, customerEmail, amount, description, installments } = req.body;
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

  const nameParts = (customerName || 'לקוח').trim().split(' ');
  const firstName = nameParts[0] || 'לקוח';
  const lastName = nameParts.slice(1).join(' ') || '';

  // Create WC order WITHOUT installments — customer picks on CRM pay page
  const orderPayload: any = {
    payment_method: 'greeninvoice-creditcard',
    payment_method_title: 'כרטיס אשראי / ביט',
    status: 'pending',
    customer_id: CRM_PAYMENTS_WP_USER_ID,
    billing: {
      first_name: firstName,
      last_name: lastName,
      email: customerEmail || 'noreply@haitech.co.il',
      phone: customerPhone || '',
    },
    fee_lines: [
      {
        name: description.trim(),
        total: String(Number(amount).toFixed(2)),
      },
    ],
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

  // Return checkout URL
  const { token: payToken, ts } = generatePayToken(payment.wooOrderId);
  const checkoutUrl = `${siteUrl}/?haitech_pay=1&order_id=${payment.wooOrderId}&ts=${ts}&token=${payToken}`;

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
  const { invoiceUrl, invoiceNumber } = extractGreenInvoice(order.meta_data || []);

  // Update DB if paid
  if (paid) {
    try {
      await prisma.payment.updateMany({
        where: { wooOrderId: Number(orderId) },
        data: {
          status: 'paid',
          paymentMethod: order.payment_method || null,
          invoiceUrl: invoiceUrl || undefined,
          invoiceNumber: invoiceNumber || undefined,
          paidAt: new Date(order.date_paid || order.date_modified),
          updatedAt: new Date(),
        },
      });
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

    const paid = ['processing', 'completed', 'on-hold'].includes(order.status);

    // Extract Morning invoice URL
    const { invoiceUrl: wh_invoiceUrl, invoiceNumber: wh_invoiceNumber } = extractGreenInvoice(order.meta_data || []);

    const updateData: any = {
      status: paid ? 'paid' : order.status === 'cancelled' ? 'cancelled' : 'pending',
      paymentMethod: order.payment_method || undefined,
      updatedAt: new Date(),
    };
    if (paid) {
      updateData.paidAt = new Date(order.date_paid || order.date_modified || Date.now());
    }
    if (wh_invoiceUrl) updateData.invoiceUrl = wh_invoiceUrl;
    if (wh_invoiceNumber) updateData.invoiceNumber = wh_invoiceNumber;

    // Try to update existing payment record
    const existing = await prisma.payment.findFirst({ where: { wooOrderId: Number(order.id) } });

    if (existing) {
      await prisma.payment.update({ where: { id: existing.id }, data: updateData });
      console.log(`[WC Webhook] Updated order ${order.id} → ${order.status}`);
    } else if (paid) {
      // New order from website (not initiated from CRM) — create record + link to customer
      const email = order.billing?.email;
      const phone = (order.billing?.phone || '').replace(/\D/g, '');
      const firstName = order.billing?.first_name || '';
      const lastName = order.billing?.last_name || '';
      const fullName = `${firstName} ${lastName}`.trim();

      // Always resolve (or auto-create) a CRM customer — no orphan payments
      const customerId = await resolveOrCreateCustomer(email, phone, fullName);

      // Build description from line items or fee lines
      const items: string[] = [];
      for (const li of order.line_items || []) items.push(li.name);
      for (const fl of order.fee_lines || []) items.push(fl.name);
      const description = items.join(', ') || 'קורס דיגיטלי';

      await prisma.payment.create({
        data: {
          wooOrderId: Number(order.id),
          amount: parseFloat(order.total || '0'),
          description,
          status: 'paid',
          paidAt: new Date(order.date_paid || order.date_modified || Date.now()),
          paymentMethod: order.payment_method || undefined,
          customerName: fullName || email || `הזמנה #${order.id}`,
          customerEmail: email || undefined,
          customerPhone: phone || undefined,
          invoiceUrl: wh_invoiceUrl || undefined,
          invoiceNumber: wh_invoiceNumber || undefined,
          customerId,
        },
      });
      console.log(`[WC Webhook] Created new payment for order ${order.id} (${fullName}, ${email}) → customer ${customerId}`);
    }
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

  const days = Number(req.query.days) || 7;
  const after = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  try {
    const wooRes = await fetch(
      `${config.woo.siteUrl}/wp-json/wc/v3/orders?per_page=50&status=on-hold,processing,completed&after=${after}`,
      { headers: { Authorization: 'Basic ' + Buffer.from(`${config.woo.consumerKey}:${config.woo.consumerSecret}`).toString('base64') } }
    );
    if (!wooRes.ok) throw new Error('WooCommerce API error');
    const orders = await wooRes.json() as any[];

    let created = 0;
    let skipped = 0;

    let updated = 0;

    for (const order of orders) {
      const existing = await prisma.payment.findFirst({ where: { wooOrderId: Number(order.id) } });

      // If exists but missing invoice URL — update it
      if (existing) {
        const { invoiceUrl: ex_invUrl, invoiceNumber: ex_invNum } = extractGreenInvoice(order.meta_data || []);
        if (ex_invUrl && !existing.invoiceUrl) {
          await prisma.payment.update({
            where: { id: existing.id },
            data: { invoiceUrl: ex_invUrl, invoiceNumber: ex_invNum || undefined },
          });
          updated++;
        } else {
          skipped++;
        }
        continue;
      }

      const email = order.billing?.email;
      const phone = (order.billing?.phone || '').replace(/\D/g, '');
      const firstName = order.billing?.first_name || '';
      const lastName = order.billing?.last_name || '';
      const fullName = `${firstName} ${lastName}`.trim();

      // Always resolve (or auto-create) a CRM customer — no orphan payments
      const customerId = await resolveOrCreateCustomer(email, phone, fullName);

      const items: string[] = [];
      for (const li of order.line_items || []) items.push(li.name);
      for (const fl of order.fee_lines || []) items.push(fl.name);

      const { invoiceUrl: sync_invoiceUrl, invoiceNumber: sync_invoiceNumber } = extractGreenInvoice(order.meta_data || []);

      await prisma.payment.create({
        data: {
          wooOrderId: Number(order.id),
          amount: parseFloat(order.total || '0'),
          description: items.join(', ') || 'קורס דיגיטלי',
          status: 'paid',
          paidAt: new Date(order.date_paid || order.date_modified || Date.now()),
          paymentMethod: order.payment_method || undefined,
          customerName: fullName || email || `הזמנה #${order.id}`,
          customerEmail: email || undefined,
          customerPhone: phone || undefined,
          invoiceUrl: sync_invoiceUrl || undefined,
          invoiceNumber: sync_invoiceNumber || undefined,
          customerId,
        },
      });
      created++;
    }

    console.log(`[sync-woo] Synced ${created} new, updated ${updated} invoices, skipped ${skipped}`);
    res.json({ ok: true, created, updated, skipped, total: orders.length, days });
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
