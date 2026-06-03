import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { authenticate, adminOnly, managerOrAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { logAudit } from '../utils/audit.js';
import { sendEmail } from '../services/email/sender.js';
import {
  generateBillingPeriod,
  generateAllBillingPeriodsForMonth,
  previewBillingPeriod,
  issueBillingPeriod,
  detectDrift,
  addPayment,
  deletePayment,
  markBillingSent,
  issueTaxInvoice,
  previewTaxInvoice,
  sendBillingPeriodAsDraft,
  markBillingPeriodIssuedManually,
  formatHebrewRange,
} from '../services/billing.js';
import { sendWhatsApp } from '../services/messaging.js';

export const billingRouter = Router();
billingRouter.use(authenticate);

const monthSchema = z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM');

function monthToDate(m: string): Date {
  const [y, mm] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mm - 1, 1));
}

billingRouter.get('/', async (req, res, next) => {
  try {
    const status = req.query.status as string | undefined;
    const paymentStatus = req.query.paymentStatus as string | undefined;
    const orderId = req.query.institutionalOrderId as string | undefined;
    const month = req.query.month as string | undefined;
    const overdue = req.query.overdue === 'true';

    const where: any = {};
    if (status) where.status = status;
    if (paymentStatus) where.paymentStatus = paymentStatus;
    if (orderId) where.institutionalOrderId = orderId;
    if (month) {
      // Match any range that contains the given month.
      const m = monthToDate(month);
      where.monthStart = { lte: m };
      where.monthEnd = { gte: m };
    }
    if (overdue) {
      where.status = 'issued';
      where.paymentStatus = { in: ['unpaid', 'partial'] };
      where.dueDate = { lt: new Date() };
    }

    const periods = await prisma.billingPeriod.findMany({
      where,
      include: {
        institutionalOrder: { select: { id: true, orderName: true, taxId: true } },
        _count: { select: { lines: true } },
      },
      orderBy: [{ monthStart: 'desc' }, { generatedAt: 'desc' }],
    });
    res.json(periods);
  } catch (err) { next(err); }
});

billingRouter.get('/:id', async (req, res, next) => {
  try {
    const period = await prisma.billingPeriod.findUnique({
      where: { id: req.params.id },
      include: {
        institutionalOrder: { include: { branch: true } },
        lines: {
          orderBy: { sortOrder: 'asc' },
          // Include `cycle.revenueIncludesVat` so the UI can show per-line VAT
          // inclusivity and warn when lines disagree.
          include: { cycle: { select: { revenueIncludesVat: true } } },
        },
        payments: { orderBy: { paidAt: 'desc' } },
        _count: { select: { meetings: true } },
      },
    });
    if (!period) throw new AppError(404, 'Billing period not found');
    res.json(period);
  } catch (err) { next(err); }
});

// Generate / regenerate a draft for one institution & month range.
// Accepts either { month } (single-month shortcut) or { monthStart, monthEnd }.
billingRouter.post('/generate', managerOrAdmin, async (req, res, next) => {
  try {
    const parsed = z.object({
      institutionalOrderId: z.string().uuid(),
      month: monthSchema.optional(),
      monthStart: monthSchema.optional(),
      monthEnd: monthSchema.optional(),
    }).refine(
      (v) => v.month || (v.monthStart && v.monthEnd),
      { message: 'either month or both monthStart and monthEnd are required' },
    ).parse(req.body);

    const monthStart = parsed.monthStart ?? parsed.month!;
    const monthEnd = parsed.monthEnd ?? parsed.month!;
    if (monthStart > monthEnd) {
      return res.status(400).json({ error: 'monthEnd must be >= monthStart' });
    }

    const period = await generateBillingPeriod(parsed.institutionalOrderId, monthStart, monthEnd, req.user?.userId);
    await logAudit({ req, action: 'CREATE', entity: 'BillingPeriod', entityId: period.id, newValue: { monthStart, monthEnd, totalAmount: period.totalAmount } });
    res.json(period);
  } catch (err: any) {
    if (err.code === 'BILLING_PERIOD_OVERLAP') {
      return res.status(409).json({ error: err.message, code: err.code });
    }
    if (err.message?.includes('cannot regenerate')) return res.status(409).json({ error: err.message });
    next(err);
  }
});

// Bulk-generate drafts for all institutions for a month (cron equivalent)
billingRouter.post('/generate-all', managerOrAdmin, async (req, res, next) => {
  try {
    const { month } = z.object({ month: monthSchema }).parse(req.body);
    const result = await generateAllBillingPeriodsForMonth(month, req.user?.userId);
    await logAudit({ req, action: 'CREATE', entity: 'BillingPeriod', entityId: 'bulk', newValue: { month, ...result } });
    res.json(result);
  } catch (err) { next(err); }
});

// Update top-level fields (documentTitle, notes, sendByEmail) on a draft
billingRouter.put('/:id', managerOrAdmin, async (req, res, next) => {
  try {
    const data = z.object({
      documentTitle: z.string().optional().nullable(),
      notes: z.string().optional().nullable(),
      sendByEmail: z.boolean().optional(),
    }).parse(req.body);

    const existing = await prisma.billingPeriod.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError(404, 'Not found');
    if (existing.status !== 'draft') throw new AppError(400, 'Only drafts can be edited');

    const period = await prisma.billingPeriod.update({
      where: { id: req.params.id },
      data,
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    });
    res.json(period);
  } catch (err) { next(err); }
});

// Add a manual line
billingRouter.post('/:id/lines', managerOrAdmin, async (req, res, next) => {
  try {
    const data = z.object({
      description: z.string().min(1),
      quantity: z.number().positive(),
      unitPrice: z.number().nonnegative(),
      cycleId: z.string().uuid().optional().nullable(),
    }).parse(req.body);

    const period = await prisma.billingPeriod.findUnique({ where: { id: req.params.id } });
    if (!period) throw new AppError(404, 'Not found');
    if (period.status !== 'draft') throw new AppError(400, 'Only drafts can be edited');

    const total = data.quantity * data.unitPrice;
    const maxSort = await prisma.billingPeriodLine.aggregate({
      where: { billingPeriodId: req.params.id }, _max: { sortOrder: true },
    });
    const line = await prisma.billingPeriodLine.create({
      data: { ...data, total, billingPeriodId: req.params.id, sortOrder: (maxSort._max.sortOrder ?? -1) + 1 },
    });
    await recomputeTotal(req.params.id);
    res.json(line);
  } catch (err) { next(err); }
});

// Update one line. Editing the description sets `descriptionCustomized = true` so a
// later `regenerate` keeps the admin's text and only refreshes quantity/unitPrice.
billingRouter.put('/:id/lines/:lineId', managerOrAdmin, async (req, res, next) => {
  try {
    const data = z.object({
      description: z.string().min(1).optional(),
      quantity: z.number().positive().optional(),
      unitPrice: z.number().nonnegative().optional(),
    }).parse(req.body);

    const period = await prisma.billingPeriod.findUnique({ where: { id: req.params.id } });
    if (!period) throw new AppError(404, 'Not found');
    if (period.status !== 'draft') throw new AppError(400, 'Only drafts can be edited');

    const line = await prisma.billingPeriodLine.findUnique({ where: { id: req.params.lineId } });
    if (!line || line.billingPeriodId !== req.params.id) throw new AppError(404, 'Line not found');

    const quantity = data.quantity ?? Number(line.quantity);
    const unitPrice = data.unitPrice ?? Number(line.unitPrice);
    const total = quantity * unitPrice;

    const descriptionChanged = data.description !== undefined && data.description !== line.description;

    const updated = await prisma.billingPeriodLine.update({
      where: { id: req.params.lineId },
      data: {
        ...data,
        quantity,
        unitPrice,
        total,
        ...(descriptionChanged ? { descriptionCustomized: true } : {}),
      },
    });
    await recomputeTotal(req.params.id);
    res.json(updated);
  } catch (err) { next(err); }
});

// Delete a line
billingRouter.delete('/:id/lines/:lineId', managerOrAdmin, async (req, res, next) => {
  try {
    const period = await prisma.billingPeriod.findUnique({ where: { id: req.params.id } });
    if (!period) throw new AppError(404, 'Not found');
    if (period.status !== 'draft') throw new AppError(400, 'Only drafts can be edited');
    await prisma.billingPeriodLine.delete({ where: { id: req.params.lineId } });
    await recomputeTotal(req.params.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// Cancel a draft (soft action — does NOT touch Morning)
billingRouter.post('/:id/cancel', managerOrAdmin, async (req, res, next) => {
  try {
    const existing = await prisma.billingPeriod.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError(404, 'Not found');
    if (existing.status === 'issued') throw new AppError(400, 'Already issued — use /unlock (admin) to release the lock');

    const period = await prisma.billingPeriod.update({
      where: { id: req.params.id },
      data: { status: 'cancelled' },
    });
    await logAudit({ req, action: 'UPDATE', entity: 'BillingPeriod', entityId: period.id, oldValue: { status: existing.status }, newValue: { status: 'cancelled' } });
    res.json(period);
  } catch (err) { next(err); }
});

// Admin-only: release the lock on an issued billing period. Flips status to 'cancelled'
// (which automatically removes the meeting-edit lock for that month) and emails info@hai.tech
// so the team knows to follow up on the Morning document — this endpoint does NOT cancel
// the Morning invoice itself.
const unlockSchema = z.object({ reason: z.string().min(1).max(500) });
billingRouter.post('/:id/unlock', adminOnly, async (req, res, next) => {
  try {
    const { reason } = unlockSchema.parse(req.body);
    const existing = await prisma.billingPeriod.findUnique({
      where: { id: req.params.id },
      include: { institutionalOrder: { select: { orderName: true } } },
    });
    if (!existing) throw new AppError(404, 'Not found');
    if (existing.status !== 'issued') {
      throw new AppError(400, `Cannot unlock — period status is ${existing.status}, not 'issued'`);
    }

    const period = await prisma.billingPeriod.update({
      where: { id: req.params.id },
      data: { status: 'cancelled' },
    });
    await logAudit({
      req,
      action: 'UPDATE',
      entity: 'BillingPeriod',
      entityId: period.id,
      oldValue: { status: existing.status },
      newValue: { status: 'cancelled', unlockReason: reason },
    });

    const monthLabel = formatHebrewRange(existing.monthStart, existing.monthEnd);
    const docLine = existing.morningDocNumber
      ? `מספר חשבונית במורנינג: <b>#${existing.morningDocNumber}</b>`
      : 'אין מספר חשבונית במורנינג רשום במערכת.';
    const orderName = existing.institutionalOrder?.orderName || '(ללא שם)';
    const userName = req.user?.name || 'משתמש לא ידוע';
    const userEmail = req.user?.email || '';

    sendEmail({
      to: 'info@hai.tech',
      subject: `⚠️ בוטלה נעילה של חיוב חודשי — ${orderName} ${monthLabel}`,
      html: `<div dir="rtl" style="font-family: Arial, sans-serif; line-height: 1.6;">
        <h2>בוטלה נעילת חיוב חודשי</h2>
        <p>אדמין שיחרר את הנעילה של חיוב חודשי שכבר הופק במורנינג. החיוב הועבר לסטטוס "בוטלה" במערכת ה-CRM, אך <b>החשבונית במורנינג עדיין קיימת</b> וצריך לטפל בה ידנית אם הסכום השתנה.</p>
        <hr>
        <p><b>מוסד:</b> ${orderName}<br>
        <b>חודש:</b> ${monthLabel}<br>
        ${docLine}<br>
        <b>סכום שהיה רשום:</b> ₪${Number(existing.totalAmount).toLocaleString('he-IL')}<br>
        <b>בוצע על-ידי:</b> ${userName} (${userEmail})<br>
        <b>זמן:</b> ${new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}<br>
        <b>סיבה:</b> ${reason}</p>
        <hr>
        <p style="color:#666;font-size:12px">הודעה אוטומטית מ-HaiTech CRM</p>
      </div>`,
    }).catch((err) => {
      console.error('[billing/unlock] failed to send info@ notification:', err);
    });

    res.json(period);
  } catch (err) { next(err); }
});

// Preview — returns base64 PDF without touching Morning
billingRouter.post('/:id/preview', managerOrAdmin, async (req, res, next) => {
  try {
    const result = await previewBillingPeriod(req.params.id);
    res.json({ success: true, fileBase64: result.file });
  } catch (err: any) {
    if (err.body) return res.status(err.status || 500).json({ error: 'Morning API error', details: err.body });
    next(err);
  }
});

// Issue — actually creates the document in Morning
billingRouter.post('/:id/issue', managerOrAdmin, async (req, res, next) => {
  try {
    const period = await issueBillingPeriod(req.params.id, req.user?.userId);
    await logAudit({ req, action: 'UPDATE', entity: 'BillingPeriod', entityId: period.id, newValue: { action: 'issued', morningDocNumber: period.morningDocNumber, totalAmount: period.totalAmount } });
    res.json(period);
  } catch (err: any) {
    if (err.body) return res.status(err.status || 500).json({ error: 'Morning API error', details: err.body });
    next(err);
  }
});

// Send to Morning as a *draft* — sits in Morning's drafts area, user finalizes from Morning UI.
// Use when backdating beyond Morning's strict API window for finalized docs.
billingRouter.post('/:id/send-as-draft', managerOrAdmin, async (req, res, next) => {
  try {
    const period = await sendBillingPeriodAsDraft(req.params.id);
    await logAudit({ req, action: 'UPDATE', entity: 'BillingPeriod', entityId: period.id, newValue: { action: 'sent-as-draft', morningDraftId: period.morningDraftId } });
    res.json(period);
  } catch (err: any) {
    if (err.body) return res.status(err.status || 500).json({ error: 'Morning API error', details: err.body });
    next(err);
  }
});

// Mark as issued manually — user finalized in Morning UI; sync the document number back here.
billingRouter.post('/:id/mark-issued-manually', managerOrAdmin, async (req, res, next) => {
  try {
    const data = z.object({
      morningDocNumber: z.number().int().positive(),
      morningDocId: z.string().optional().nullable(),
      morningDocUrl: z.string().url().optional().nullable(),
      morningDocType: z.number().int().optional().nullable(),
      issuedAt: z.string().optional().nullable(),
    }).parse(req.body);

    const period = await markBillingPeriodIssuedManually(req.params.id, {
      morningDocNumber: data.morningDocNumber,
      morningDocId: data.morningDocId ?? null,
      morningDocUrl: data.morningDocUrl ?? null,
      morningDocType: data.morningDocType ?? null,
      issuedAt: data.issuedAt ? new Date(data.issuedAt) : undefined,
    }, req.user?.userId);
    await logAudit({ req, action: 'UPDATE', entity: 'BillingPeriod', entityId: period.id, newValue: { action: 'mark-issued-manually', morningDocNumber: period.morningDocNumber, issuedAt: period.issuedAt } });
    res.json(period);
  } catch (err: any) {
    if (err.message?.includes('already issued') || err.message?.includes('cancelled')) {
      return res.status(409).json({ error: err.message });
    }
    next(err);
  }
});

// ─── Payment tracking ────────────────────────────────────────────────────────

billingRouter.post('/:id/payments', managerOrAdmin, async (req, res, next) => {
  try {
    const data = z.object({
      amount: z.number().positive(),
      method: z.string().optional().nullable(),
      notes: z.string().optional().nullable(),
      paidAt: z.string().optional().nullable(),
    }).parse(req.body);

    const period = await addPayment(req.params.id, { ...data, recordedById: req.user?.userId });
    await logAudit({ req, action: 'CREATE', entity: 'BillingPayment', entityId: period.id, newValue: { amount: data.amount, method: data.method, paymentStatus: period.paymentStatus, paidAmount: period.paidAmount } });
    res.json(period);
  } catch (err: any) {
    if (err.message === 'Billing period not found') return res.status(404).json({ error: err.message });
    next(err);
  }
});

billingRouter.delete('/:id/payments/:paymentId', managerOrAdmin, async (req, res, next) => {
  try {
    const period = await deletePayment(req.params.id, req.params.paymentId);
    await logAudit({ req, action: 'DELETE', entity: 'BillingPayment', entityId: req.params.paymentId, oldValue: { billingPeriodId: req.params.id } });
    res.json(period);
  } catch (err: any) {
    if (err.message?.includes('not found')) return res.status(404).json({ error: err.message });
    next(err);
  }
});

// Mark as sent — manual (e.g. after sending via WhatsApp / email outside the system)
billingRouter.post('/:id/mark-sent', managerOrAdmin, async (req, res, next) => {
  try {
    const data = z.object({
      channel: z.enum(['morning_email', 'whatsapp', 'manual', 'email']),
      toEmail: z.string().email().optional().nullable().or(z.literal('')),
      toPhone: z.string().optional().nullable(),
    }).parse(req.body);
    const period = await markBillingSent(req.params.id, {
      channel: data.channel,
      toEmail: data.toEmail || null,
      toPhone: data.toPhone || null,
    });
    await logAudit({ req, action: 'UPDATE', entity: 'BillingPeriod', entityId: period.id, newValue: { sentChannel: data.channel } });
    res.json(period);
  } catch (err) { next(err); }
});

// Send the proforma PDF link to the institution's contact phone via WhatsApp.
billingRouter.post('/:id/send-whatsapp', managerOrAdmin, async (req, res, next) => {
  try {
    const data = z.object({
      phone: z.string().optional(),
      message: z.string().optional(),
    }).parse(req.body);

    const period = await prisma.billingPeriod.findUnique({
      where: { id: req.params.id },
      include: { institutionalOrder: true },
    });
    if (!period) throw new AppError(404, 'Billing period not found');
    if (period.status !== 'issued') throw new AppError(400, 'Period must be issued before sending');
    if (!period.morningDocUrl) throw new AppError(400, 'Missing Morning document URL');

    const phone = data.phone || period.institutionalOrder.contactPhone;
    if (!phone) throw new AppError(400, 'No phone number — set institution contact phone or pass phone in body');

    const orderName = period.institutionalOrder.orderName || 'מוסד';
    const monthLabel = formatHebrewRange(period.monthStart, period.monthEnd);
    const totalGross = (Number(period.totalAmount) * 1.18).toFixed(2);
    const message = data.message || [
      `שלום,`,
      `מצורף חשבון עסקה מספר ${period.morningDocNumber} עבור ${orderName} — ${monthLabel}.`,
      `סכום לתשלום: ₪${totalGross} (כולל מע"מ).`,
      `קישור למסמך: ${period.morningDocUrl}`,
      ``,
      `דרך ההיי-טק בע"מ`,
    ].join('\n');

    const result = await sendWhatsApp({ phone, message });
    if (!result.success) throw new AppError(502, result.error || 'WhatsApp send failed');

    await markBillingSent(req.params.id, { channel: 'whatsapp', toPhone: phone });
    await logAudit({ req, action: 'UPDATE', entity: 'BillingPeriod', entityId: req.params.id, newValue: { sentChannel: 'whatsapp', sentToPhone: phone, messageId: result.messageId } });
    res.json({ success: true, messageId: result.messageId });
  } catch (err) { next(err); }
});

// Receipt lines for a tax invoice + receipt (Morning type 320). Optional — when omitted,
// the service seeds them from the payments already recorded on the period.
const taxReceiptPaymentsSchema = z
  .array(
    z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
      type: z.number().int(),
      amount: z.number().positive(),
    }),
  )
  .optional();

// Preview a tax invoice + receipt (type 320) — returns base64 PDF without touching Morning.
billingRouter.post('/:id/preview-tax-invoice', managerOrAdmin, async (req, res, next) => {
  try {
    const payments = taxReceiptPaymentsSchema.parse(req.body?.payments);
    const result = await previewTaxInvoice(req.params.id, payments);
    res.json({ success: true, fileBase64: result.file });
  } catch (err: any) {
    if (err.body) return res.status(err.status || 500).json({ error: 'Morning API error', details: err.body });
    if (err.message === 'Billing period not found') return res.status(404).json({ error: err.message });
    next(err);
  }
});

// Issue a binding tax invoice + receipt (Morning type 320) alongside the proforma.
billingRouter.post('/:id/issue-tax-invoice', managerOrAdmin, async (req, res, next) => {
  try {
    const payments = taxReceiptPaymentsSchema.parse(req.body?.payments);
    const period = await issueTaxInvoice(req.params.id, req.user?.userId, payments);
    await logAudit({ req, action: 'UPDATE', entity: 'BillingPeriod', entityId: period.id, newValue: { taxInvoiceNumber: period.taxInvoiceNumber } });
    res.json(period);
  } catch (err: any) {
    if (err.body) return res.status(err.status || 500).json({ error: 'Morning API error', details: err.body });
    if (err.message?.includes('already issued') || err.message?.includes('must be issued')) {
      return res.status(409).json({ error: err.message });
    }
    if (err.message === 'Billing period not found') return res.status(404).json({ error: err.message });
    next(err);
  }
});

// Drift: meetings completed in this institution+month that aren't in the issued snapshot.
billingRouter.get('/:id/drift', async (req, res, next) => {
  try {
    const drift = await detectDrift(req.params.id);
    res.json(drift);
  } catch (err: any) {
    if (err.message === 'Billing period not found') return res.status(404).json({ error: err.message });
    next(err);
  }
});

async function recomputeTotal(billingPeriodId: string) {
  const lines = await prisma.billingPeriodLine.findMany({
    where: { billingPeriodId },
    select: { total: true },
  });
  const totalAmount = lines.reduce((s, l) => s + Number(l.total), 0);
  await prisma.billingPeriod.update({
    where: { id: billingPeriodId },
    data: { totalAmount },
  });
}
