/**
 * Morning (GreenInvoice) Webhook Handler
 * POST /api/morning-webhook
 *
 * Morning sends a POST when a document is created (receipt/invoice/etc.)
 * We: match or create customer → create payment record → WhatsApp to Ami
 */

import { Router } from 'express';
import { prisma } from '../utils/prisma.js';
import { sendWhatsAppMessage } from '../services/notifications.js';

export const morningWebhookRouter = Router();

const AMI_PHONE = process.env.AMI_PHONE || '972528746137';

// Morning document types
const DOC_TYPES: Record<number, string> = {
  100: 'הצעת מחיר',
  200: 'הזמנה',
  300: 'חשבונית עסקה',
  305: 'חשבונית עסקה + קבלה',
  310: 'חשבון עסקה',
  315: 'חשבון עסקה + קבלה',
  320: 'קבלה',
  330: 'קבלה על תרומה',
  400: 'חשבונית זיכוי',
  405: 'חשבונית זיכוי + קבלה',
  420: 'זיכוי',
  430: 'מסמך אחר',
};

// Normalize Israeli phone number to 97XXXXXXXXX format
function normalizePhone(phone: string): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('972')) return digits;
  if (digits.startsWith('0')) return '972' + digits.slice(1);
  return '972' + digits;
}

function firstText(...values: Array<unknown>): string {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

morningWebhookRouter.post('/', async (req, res) => {
  try {
    const payload = req.body;
    console.log('[Morning Webhook] Received:', JSON.stringify(payload, null, 2));

    const event: string = payload.event || payload.type || '';
    const data = payload.data || payload;

    // Events we handle
    const HANDLED_EVENTS = [
      'payment/received',
      'document/created',
      'sale-pages/order-paid',
      // legacy names just in case
      'paymentCreate',
      'documentCreate',
    ];

    if (!HANDLED_EVENTS.includes(event)) {
      console.log('[Morning Webhook] Ignoring event:', event);
      return res.json({ ok: true, ignored: true });
    }

    const paymentLinkCode = String(req.query.paymentLinkCode || '').trim().toLowerCase();
    const paymentLink = paymentLinkCode
      ? await prisma.paymentLink.findUnique({ where: { code: paymentLinkCode } })
      : null;

    // Morning uses "client" object (not "customer")
    const client = data.client || data.customer || {};
    const customerName: string =
      firstText(client.name, client.fullName, data.clientName, paymentLink?.clientName, 'לקוח לא ידוע');
    const customerPhone: string = normalizePhone(
      firstText(client.mobile, client.phone, paymentLink?.clientPhone)
    );
    const customerEmail: string = firstText(client.email, paymentLink?.clientEmail);

    // Amount: Morning uses different fields per event type
    const amount: number = Number(
      data.amount || data.total || data.price || data.sum || 0
    );

    // Description
    const docType: number = Number(data.type || 0);
    const docTypeLabel: string = DOC_TYPES[docType] || 'תשלום';
    const incomeDesc: string = Array.isArray(data.income)
      ? data.income.map((i: any) => i.description).filter(Boolean).join(', ')
      : '';
    const description: string =
      incomeDesc || data.description || data.title || docTypeLabel || 'תשלום מורנינג';

    const morningDocId: string = String(data.id || data.documentId || data.orderId || '');
    const paidAt = data.date ? new Date(data.date) : (data.paymentDate ? new Date(data.paymentDate) : new Date());

    // Skip zero-amount events
    if (amount <= 0) {
      console.log('[Morning Webhook] Skipping zero-amount event');
      return res.json({ ok: true, ignored: true, reason: 'zero amount' });
    }

    // ─── Match or create customer ─────────────────────────────────────────────

    let crmCustomer = null;

    // Payment links are the strongest signal: if sales selected a CRM customer
    // while creating the link, attach the received payment to that exact record.
    if (paymentLink?.customerId) {
      crmCustomer = await prisma.customer.findUnique({ where: { id: paymentLink.customerId } });
    }

    // Try phone match first (last 9 digits)
    if (!crmCustomer && customerPhone) {
      const last9 = customerPhone.slice(-9);
      crmCustomer = await prisma.customer.findFirst({
        where: { deletedAt: null, phone: { contains: last9 } },
      });
    }

    // Try email match if phone didn't match
    if (!crmCustomer && customerEmail) {
      crmCustomer = await prisma.customer.findFirst({
        where: { deletedAt: null, email: customerEmail },
      });
    }

    let isNew = false;

    if (!crmCustomer) {
      // Create new customer
      isNew = true;
      crmCustomer = await prisma.customer.create({
        data: {
          name: customerName,
          phone: customerPhone || null,
          email: customerEmail || null,
          source: paymentLink ? 'payment_link' : 'website',
        },
      });
      console.log('[Morning Webhook] Created new customer:', crmCustomer.id);
    } else {
      console.log('[Morning Webhook] Matched customer:', crmCustomer.id);

      const customerPatch: Record<string, string> = {};
      if (!crmCustomer.phone && customerPhone) customerPatch.phone = customerPhone;
      if (!crmCustomer.email && customerEmail) customerPatch.email = customerEmail;
      if (Object.keys(customerPatch).length > 0) {
        crmCustomer = await prisma.customer.update({
          where: { id: crmCustomer.id },
          data: customerPatch,
        });
      }
    }

    if (paymentLink && !paymentLink.customerId) {
      await prisma.paymentLink.update({
        where: { id: paymentLink.id },
        data: { customerId: crmCustomer.id },
      });
    }

    // ─── Create payment record ────────────────────────────────────────────────

    // Check for duplicate (same morningDocId)
    const paymentLinkMarker = paymentLink ? `[payment-link:${paymentLink.code}]` : '';
    if (morningDocId || paymentLinkMarker) {
      const existing = await prisma.payment.findFirst({
        where: {
          OR: [
            ...(morningDocId ? [{ description: { contains: morningDocId } }] : []),
            ...(paymentLinkMarker ? [{ description: { contains: paymentLinkMarker } }] : []),
          ],
        },
      });
      if (existing) {
        console.log('[Morning Webhook] Duplicate, skipping:', morningDocId || paymentLinkMarker);
        return res.json({ ok: true, ignored: true, reason: 'duplicate' });
      }
    }

    const payment = await prisma.payment.create({
      data: {
        customerId: crmCustomer.id,
        customerName: crmCustomer.name || customerName,
        customerPhone: customerPhone || null,
        customerEmail: customerEmail || null,
        description: morningDocId
          ? `${description} [${morningDocId}]${paymentLinkMarker ? ` ${paymentLinkMarker}` : ''}`
          : `${description}${paymentLinkMarker ? ` ${paymentLinkMarker}` : ''}`,
        amount,
        currency: data.currency || 'ILS',
        status: 'paid',
        paymentMethod: 'morning_webhook',
        paidAt,
      },
    });

    console.log('[Morning Webhook] Created payment:', payment.id);

    // ─── WhatsApp notification to Ami ─────────────────────────────────────────

    const newCustomerNote = isNew
      ? `\n🆕 לקוח חדש נוצר אוטומטית`
      : `\n👤 לקוח קיים: ${crmCustomer.name}`;

    const waMsg =
      `💳 תשלום חדש ממורנינג!\n` +
      `👤 ${customerName}\n` +
      `💰 ₪${amount.toLocaleString()} — ${docTypeLabel}\n` +
      (customerPhone ? `📱 ${customerPhone}\n` : '') +
      newCustomerNote +
      `\n🔗 crm.orma-ai.com/customers/${crmCustomer.id}`;

    await sendWhatsAppMessage(AMI_PHONE, waMsg);

    return res.json({
      ok: true,
      customerId: crmCustomer.id,
      paymentId: payment.id,
      isNewCustomer: isNew,
    });
  } catch (err) {
    console.error('[Morning Webhook] Error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
});
