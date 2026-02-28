import { Router } from 'express';
import { createHmac } from 'crypto';
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

/**
 * POST /api/payments/create-link
 * Creates a WooCommerce order and returns a payment URL. Saves to DB.
 */
router.post('/create-link', async (req, res) => {
  const { customerId, customerName, customerPhone, customerEmail, amount, description } = req.body;

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

  const orderPayload = {
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
    },
  });

  // Generate auto-login URL (init-hook, more reliable than REST context)
  const { token, ts } = generatePayToken(order.id);
  const paymentUrl = `${siteUrl}/?haitech_pay=1&order_id=${order.id}&ts=${ts}&token=${token}`;
  const directPaymentUrl = `${siteUrl}/checkout/order-pay/${order.id}/?pay_for_order=true&key=${order.order_key}`;

  return res.json({
    paymentId: payment.id,
    orderId: order.id,
    orderKey: order.order_key,
    paymentUrl,
    directPaymentUrl,
    amount: Number(amount),
    description: description.trim(),
  });
});

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
  const paid = ['processing', 'completed'].includes(order.status);

  // Extract Morning invoice URL from order meta
  const invoiceMeta = order.meta_data?.find(
    (m: any) => m.key === '_greeninvoice_document_url' || m.key === 'greeninvoice_document_url'
  );
  const invoiceNumberMeta = order.meta_data?.find(
    (m: any) => m.key === '_greeninvoice_document_number' || m.key === 'greeninvoice_document_number'
  );
  const invoiceUrl = invoiceMeta?.value || null;
  const invoiceNumber = invoiceNumberMeta?.value || null;

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

    const paid = ['processing', 'completed'].includes(order.status);

    // Extract Morning invoice URL
    const invoiceMeta = order.meta_data?.find(
      (m: any) => m.key === '_greeninvoice_document_url' || m.key === 'greeninvoice_document_url'
    );
    const invoiceNumberMeta = order.meta_data?.find(
      (m: any) => m.key === '_greeninvoice_document_number' || m.key === 'greeninvoice_document_number'
    );

    const updateData: any = {
      status: paid ? 'paid' : order.status === 'cancelled' ? 'cancelled' : 'pending',
      paymentMethod: order.payment_method || undefined,
      updatedAt: new Date(),
    };
    if (paid) {
      updateData.paidAt = new Date(order.date_paid || order.date_modified || Date.now());
    }
    if (invoiceMeta?.value) updateData.invoiceUrl = invoiceMeta.value;
    if (invoiceNumberMeta?.value) updateData.invoiceNumber = invoiceNumberMeta.value;

    await prisma.payment.updateMany({
      where: { wooOrderId: Number(order.id) },
      data: updateData,
    });

    console.log(`[WC Webhook] Order ${order.id} → ${order.status}`, invoiceMeta?.value || '');
  } catch (e) {
    console.error('[WC Webhook] Error:', e);
  }
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

export const paymentsRouter = router;
