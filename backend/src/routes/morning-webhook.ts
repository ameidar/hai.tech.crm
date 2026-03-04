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

morningWebhookRouter.post('/', async (req, res) => {
  try {
    const payload = req.body;
    console.log('[Morning Webhook] Received:', JSON.stringify(payload, null, 2));

    // Morning sends { event, data } — handle both formats
    const event: string = payload.event || payload.type || '';
    const data = payload.data || payload;

    // We only care about completed payments (receipt types or paymentCreate)
    // Morning event names: documentCreate, paymentCreate, etc.
    const isPayment =
      event.toLowerCase().includes('payment') ||
      event.toLowerCase().includes('document') ||
      event === 'documentCreate' ||
      event === 'paymentCreate';

    if (!isPayment) {
      console.log('[Morning Webhook] Ignoring event:', event);
      return res.json({ ok: true, ignored: true });
    }

    // Extract data from Morning payload
    const customer = data.customer || {};
    const customerName: string =
      customer.name || customer.fullName || data.customerName || 'לקוח לא ידוע';
    const customerPhone: string = normalizePhone(
      customer.mobile || customer.phone || data.customerPhone || ''
    );
    const customerEmail: string =
      customer.email || data.customerEmail || '';

    const amount: number =
      Number(data.price || data.amount || data.total || 0);
    const description: string =
      (data.description ||
        (data.income && data.income[0]?.description) ||
        DOC_TYPES[Number(data.type)] ||
        'תשלום מורנינג') as string;

    const docType: number = Number(data.type || 0);
    const docTypeLabel: string = DOC_TYPES[docType] || 'מסמך';
    const morningDocId: string = String(data.id || data.documentId || '');
    const paidAt = data.paymentDate ? new Date(data.paymentDate) : new Date();

    // Skip zero-amount events
    if (amount <= 0) {
      console.log('[Morning Webhook] Skipping zero-amount event');
      return res.json({ ok: true, ignored: true, reason: 'zero amount' });
    }

    // ─── Match or create customer ─────────────────────────────────────────────

    let crmCustomer = null;

    // Try phone match first (last 9 digits)
    if (customerPhone) {
      const last9 = customerPhone.slice(-9);
      crmCustomer = await prisma.customer.findFirst({
        where: { phone: { contains: last9 } },
      });
    }

    // Try email match if phone didn't match
    if (!crmCustomer && customerEmail) {
      crmCustomer = await prisma.customer.findFirst({
        where: { email: customerEmail },
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
          status: 'lead',
          source: 'morning_webhook',
        },
      });
      console.log('[Morning Webhook] Created new customer:', crmCustomer.id);
    } else {
      console.log('[Morning Webhook] Matched customer:', crmCustomer.id);
    }

    // ─── Create payment record ────────────────────────────────────────────────

    // Check for duplicate (same morningDocId)
    if (morningDocId) {
      const existing = await prisma.payment.findFirst({
        where: { description: { contains: morningDocId } },
      });
      if (existing) {
        console.log('[Morning Webhook] Duplicate, skipping:', morningDocId);
        return res.json({ ok: true, ignored: true, reason: 'duplicate' });
      }
    }

    const payment = await prisma.payment.create({
      data: {
        customerId: crmCustomer.id,
        customerName,
        customerPhone: customerPhone || null,
        customerEmail: customerEmail || null,
        description: morningDocId
          ? `${description} [${morningDocId}]`
          : description,
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
