import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { logAudit } from '../utils/audit.js';
import {
  generateBillingPeriod,
  generateAllBillingPeriodsForMonth,
  previewBillingPeriod,
  issueBillingPeriod,
} from '../services/billing.js';

export const billingRouter = Router();
billingRouter.use(authenticate);

const monthSchema = z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM');

billingRouter.get('/', async (req, res, next) => {
  try {
    const status = req.query.status as string | undefined;
    const orderId = req.query.institutionalOrderId as string | undefined;
    const month = req.query.month as string | undefined;

    const where: any = {};
    if (status) where.status = status;
    if (orderId) where.institutionalOrderId = orderId;
    if (month) {
      const [y, m] = month.split('-').map(Number);
      where.month = new Date(Date.UTC(y, m - 1, 1));
    }

    const periods = await prisma.billingPeriod.findMany({
      where,
      include: {
        institutionalOrder: { select: { id: true, orderName: true, taxId: true } },
        _count: { select: { lines: true } },
      },
      orderBy: [{ month: 'desc' }, { generatedAt: 'desc' }],
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
        lines: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!period) throw new AppError(404, 'Billing period not found');
    res.json(period);
  } catch (err) { next(err); }
});

// Generate / regenerate a draft for one institution & month
billingRouter.post('/generate', managerOrAdmin, async (req, res, next) => {
  try {
    const { institutionalOrderId, month } = z.object({
      institutionalOrderId: z.string().uuid(),
      month: monthSchema,
    }).parse(req.body);

    const period = await generateBillingPeriod(institutionalOrderId, month, req.user?.userId);
    await logAudit({ req, action: 'CREATE', entity: 'BillingPeriod', entityId: period.id, newValue: { month, totalAmount: period.totalAmount } });
    res.json(period);
  } catch (err: any) {
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

// Update top-level fields (notes, sendByEmail) on a draft
billingRouter.put('/:id', managerOrAdmin, async (req, res, next) => {
  try {
    const data = z.object({
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

// Update one line
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

    const updated = await prisma.billingPeriodLine.update({
      where: { id: req.params.lineId },
      data: { ...data, quantity, unitPrice, total },
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
    if (existing.status === 'issued') throw new AppError(400, 'Already issued — cancel via Morning UI');

    const period = await prisma.billingPeriod.update({
      where: { id: req.params.id },
      data: { status: 'cancelled' },
    });
    await logAudit({ req, action: 'UPDATE', entity: 'BillingPeriod', entityId: period.id, oldValue: { status: existing.status }, newValue: { status: 'cancelled' } });
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
