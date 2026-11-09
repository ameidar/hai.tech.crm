import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { authenticate, adminOnly } from '../middleware/auth.js';
import { logAudit } from '../utils/audit.js';
import {
  EXPENSE_STATUS_PENDING,
  buildExpenseSummary,
  isCompanyExpenseSyncRunning,
  israelToday,
  monthRangeWhere,
  serializeCompanyExpense,
  shiftMonth,
  syncCompanyExpenses,
  type ExpenseRowLike,
} from '../services/company-expenses.js';
import { isMorningConfigured } from '../services/morning/client.js';
import { getMissingRecurring, runRecurringDetection } from '../services/recurring-expenses.js';

// Company expenses (הוצאות החברה) — Morning expense mirror + recurring-invoice tracking.
// Admin only.
export const companyExpensesRouter = Router();
companyExpensesRouter.use(authenticate, adminOnly);

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const listQuerySchema = z.object({
  from: z.string().regex(MONTH, 'חודש בפורמט YYYY-MM').optional(),
  to: z.string().regex(MONTH, 'חודש בפורמט YYYY-MM').optional(),
  supplier: z.string().trim().min(1).optional(),
  category: z.string().trim().min(1).optional(),
  status: z.coerce.number().int().optional(),
  search: z.string().trim().min(1).optional(),
  includeInactive: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

// GET /api/company-expenses — filterable, paginated list of mirrored expenses.
companyExpensesRouter.get('/', async (req, res, next) => {
  try {
    const q = listQuerySchema.parse(req.query);
    const and: Prisma.CompanyExpenseWhereInput[] = [];
    if (q.includeInactive !== 'true') and.push({ active: true });
    if (q.from || q.to) {
      const current = israelToday().iso.slice(0, 7);
      and.push(monthRangeWhere(q.from ?? '2000-01', q.to ?? shiftMonth(current, 120)));
    }
    if (q.supplier) and.push({ supplierName: q.supplier });
    if (q.category) and.push({ categoryTitle: q.category });
    if (q.status !== undefined) and.push({ status: q.status });
    if (q.search) {
      and.push({
        OR: [
          { supplierName: { contains: q.search, mode: 'insensitive' } },
          { description: { contains: q.search, mode: 'insensitive' } },
          { number: { contains: q.search, mode: 'insensitive' } },
          { categoryTitle: { contains: q.search, mode: 'insensitive' } },
        ],
      });
    }
    const where: Prisma.CompanyExpenseWhereInput = { AND: and };
    const [rows, total, agg] = await Promise.all([
      prisma.companyExpense.findMany({
        where,
        orderBy: [{ date: 'desc' }, { number: 'desc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      prisma.companyExpense.count({ where }),
      prisma.companyExpense.aggregate({ where, _sum: { amount: true, amountExcludeVat: true } }),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / q.limit));
    res.json({
      data: rows.map(serializeCompanyExpense),
      totals: {
        gross: Number(agg._sum.amount ?? 0),
        net: Number(agg._sum.amountExcludeVat ?? 0),
      },
      pagination: {
        page: q.page, limit: q.limit, total, totalPages,
        hasNext: q.page < totalPages, hasPrev: q.page > 1,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/company-expenses/summary — KPIs, monthly totals, categories, suppliers, pending.
companyExpensesRouter.get('/summary', async (req, res, next) => {
  try {
    const months = z.coerce.number().int().min(4).max(24).default(12).parse(req.query.months);
    const now = new Date();
    const current = israelToday(now).iso.slice(0, 7);
    const [rows, pendingRows, lastSync, filterOptions] = await Promise.all([
      prisma.companyExpense.findMany({
        where: { active: true, ...monthRangeWhere(shiftMonth(current, -(months - 1)), current) },
      }),
      // Pending approval regardless of month.
      prisma.companyExpense.findMany({
        where: { active: true, status: EXPENSE_STATUS_PENDING },
        orderBy: { date: 'desc' },
      }),
      prisma.companyExpense.aggregate({ _max: { syncedAt: true } }),
      prisma.companyExpense.findMany({
        where: { active: true },
        distinct: ['supplierName', 'categoryTitle'],
        select: { supplierName: true, categoryTitle: true },
      }),
    ]);
    const summary = buildExpenseSummary(rows as ExpenseRowLike[], now, months);
    const pendingGross = pendingRows.reduce((s, r) => s + Number(r.amount), 0);
    const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, 'he'));
    res.json({
      ...summary,
      kpis: { ...summary.kpis, pendingCount: pendingRows.length, pendingGross: Math.round(pendingGross * 100) / 100 },
      pending: pendingRows.map(serializeCompanyExpense),
      lastSyncedAt: lastSync._max.syncedAt ?? null,
      syncRunning: isCompanyExpenseSyncRunning(),
      morningConfigured: isMorningConfigured(),
      filters: {
        suppliers: uniq(filterOptions.map((r) => r.supplierName)),
        categories: uniq(filterOptions.map((r) => r.categoryTitle)),
      },
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/company-expenses/sync — "רענן עכשיו". Body { full?: boolean } for a 13-month resync.
companyExpensesRouter.post('/sync', async (req, res, next) => {
  try {
    const { full } = z.object({ full: z.boolean().optional() }).parse(req.body ?? {});
    if (!isMorningConfigured()) return res.status(503).json({ error: 'Morning לא מוגדר בשרת' });
    if (isCompanyExpenseSyncRunning()) return res.status(409).json({ error: 'סנכרון כבר רץ, נסה שוב בעוד רגע' });
    const result = await syncCompanyExpenses({ full });
    const detection = await runRecurringDetection();
    res.json({ ...result, newRecurringSuggestions: detection.created });
  } catch (error) {
    next(error);
  }
});

// ─── Recurring expenses ───────────────────────────────────────────────────────

const recurringBaseSchema = z.object({
  supplierName: z.string().trim().min(1, 'חובה לציין ספק'),
  supplierId: z.string().trim().min(1).nullable().optional(),
  label: z.string().trim().min(1).optional(),
  expectedDayOfMonth: z.number().int().min(1).max(31),
  expectedAmount: z.number().positive().nullable().optional(),
  tolerancePct: z.number().int().min(0).max(100).nullable().optional(),
  categoryTitle: z.string().trim().nullable().optional(),
  status: z.enum(['suggested', 'active', 'ignored']).optional(),
  notes: z.string().trim().nullable().optional(),
});
const recurringUpdateSchema = recurringBaseSchema.partial();

function serializeRecurring(r: any) {
  return {
    id: r.id,
    supplierId: r.supplierId,
    supplierName: r.supplierName,
    label: r.label,
    expectedDayOfMonth: r.expectedDayOfMonth,
    expectedAmount: r.expectedAmount === null || r.expectedAmount === undefined ? null : Number(r.expectedAmount.toString()),
    tolerancePct: r.tolerancePct,
    cadence: r.cadence,
    categoryTitle: r.categoryTitle,
    status: r.status,
    source: r.source,
    notes: r.notes,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

companyExpensesRouter.get('/recurring', async (_req, res, next) => {
  try {
    const rows = await prisma.recurringExpense.findMany({ orderBy: [{ status: 'asc' }, { label: 'asc' }] });
    res.json(rows.map(serializeRecurring));
  } catch (error) {
    next(error);
  }
});

companyExpensesRouter.get('/recurring/missing', async (_req, res, next) => {
  try {
    res.json(await getMissingRecurring());
  } catch (error) {
    next(error);
  }
});

companyExpensesRouter.post('/recurring/detect', async (_req, res, next) => {
  try {
    res.json(await runRecurringDetection());
  } catch (error) {
    next(error);
  }
});

companyExpensesRouter.post('/recurring', async (req, res, next) => {
  try {
    const data = recurringBaseSchema.parse(req.body);
    const row = await prisma.recurringExpense.create({
      data: {
        supplierName: data.supplierName,
        supplierId: data.supplierId ?? null,
        label: data.label || data.supplierName,
        expectedDayOfMonth: data.expectedDayOfMonth,
        expectedAmount: data.expectedAmount ?? null,
        tolerancePct: data.tolerancePct ?? null,
        categoryTitle: data.categoryTitle ?? null,
        status: data.status ?? 'active',
        source: 'manual',
        notes: data.notes ?? null,
      },
    });
    await logAudit({ action: 'CREATE', entity: 'RecurringExpense', entityId: row.id, newValue: serializeRecurring(row), req });
    res.status(201).json(serializeRecurring(row));
  } catch (error) {
    next(error);
  }
});

companyExpensesRouter.put('/recurring/:id', async (req, res, next) => {
  try {
    const data = recurringUpdateSchema.parse(req.body);
    const existing = await prisma.recurringExpense.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'הוצאה קבועה לא נמצאה' });
    const row = await prisma.recurringExpense.update({
      where: { id: existing.id },
      data: {
        ...(data.supplierName !== undefined && { supplierName: data.supplierName }),
        ...(data.supplierId !== undefined && { supplierId: data.supplierId }),
        ...(data.label !== undefined && { label: data.label }),
        ...(data.expectedDayOfMonth !== undefined && { expectedDayOfMonth: data.expectedDayOfMonth }),
        ...(data.expectedAmount !== undefined && { expectedAmount: data.expectedAmount }),
        ...(data.tolerancePct !== undefined && { tolerancePct: data.tolerancePct }),
        ...(data.categoryTitle !== undefined && { categoryTitle: data.categoryTitle }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.notes !== undefined && { notes: data.notes }),
      },
    });
    await logAudit({ action: 'UPDATE', entity: 'RecurringExpense', entityId: row.id, oldValue: serializeRecurring(existing), newValue: serializeRecurring(row), req });
    res.json(serializeRecurring(row));
  } catch (error) {
    next(error);
  }
});
