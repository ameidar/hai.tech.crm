import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { config } from '../config.js';

const router = Router();

// All payment routes require auth
router.use(authenticate);

/**
 * POST /api/payments/create-link
 * Creates a WooCommerce order and returns a payment URL.
 */
router.post('/create-link', async (req, res) => {
  const { customerName, customerPhone, customerEmail, amount, description } = req.body;

  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    return res.status(400).json({ error: 'סכום לא תקין' });
  }
  if (!description?.trim()) {
    return res.status(400).json({ error: 'נדרש תיאור' });
  }

  const { siteUrl, consumerKey, consumerSecret } = config.woo;
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

  // Build billing from customer details
  const nameParts = (customerName || 'לקוח').trim().split(' ');
  const firstName = nameParts[0] || 'לקוח';
  const lastName = nameParts.slice(1).join(' ') || '';

  const orderPayload = {
    payment_method: 'greeninvoice-creditcard',
    payment_method_title: 'כרטיס אשראי / ביט',
    status: 'pending',
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
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(orderPayload),
  });

  if (!wooRes.ok) {
    const errText = await wooRes.text();
    console.error('WooCommerce order error:', errText);
    return res.status(502).json({ error: 'שגיאה ביצירת הזמנה ב-WooCommerce', details: errText });
  }

  const order = (await wooRes.json()) as { id: number; order_key: string };
  const paymentUrl = `${siteUrl}/checkout/order-pay/${order.id}/?pay_for_order=true&key=${order.order_key}`;

  return res.json({
    orderId: order.id,
    orderKey: order.order_key,
    paymentUrl,
    amount: Number(amount),
    description: description.trim(),
  });
});

export const paymentsRouter = router;
