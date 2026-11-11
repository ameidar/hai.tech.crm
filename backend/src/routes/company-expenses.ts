import { Prisma } from '@prisma/client';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import path from 'path';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { authenticate, adminOnly } from '../middleware/auth.js';
import { logAudit } from '../utils/audit.js';
import {
  EXPENSE_STATUS_PENDING,
  buildExpenseSummary,
  isCompanyExpenseDraftSyncRunning,
  isCompanyExpenseSyncRunning,
  israelToday,
  monthRangeWhere,
  serializeCompanyExpense,
  shiftMonth,
  syncCompanyExpensesAndDrafts,
  type ExpenseRowLike,
} from '../services/company-expenses.js';
import { isMorningConfigured } from '../services/morning/client.js';
import { sha256, uploadExpenseFileToMorning } from '../services/morning/expense-upload.js';
import {
  CADENCES,
  INVOICE_SOURCES,
  getMissingRecurring,
  getSupplierGrid,
  runRecurringDetection,
} from '../services/recurring-expenses.js';
import { scheduleDraftSyncAfterUpload } from '../services/company-expenses-scheduler.js';

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
      syncRunning: isCompanyExpenseSyncRunning() || isCompanyExpenseDraftSyncRunning(),
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

// POST /api/company-expenses/sync — "רענן עכשיו" (drafts + expenses). Body { full?: boolean } for a 13-month resync.
companyExpensesRouter.post('/sync', async (req, res, next) => {
  try {
    const { full } = z.object({ full: z.boolean().optional() }).parse(req.body ?? {});
    if (!isMorningConfigured()) return res.status(503).json({ error: 'Morning לא מוגדר בשרת' });
    if (isCompanyExpenseSyncRunning() || isCompanyExpenseDraftSyncRunning()) return res.status(409).json({ error: 'סנכרון כבר רץ, נסה שוב בעוד רגע' });
    const result = await syncCompanyExpensesAndDrafts({ full });
    const detection = await runRecurringDetection();
    res.json({ ...result, newRecurringSuggestions: detection.created });
  } catch (error) {
    next(error);
  }
});

// ─── Recurring expenses ───────────────────────────────────────────────────────

const optText = z.string().trim().max(2000).nullable().optional()
  .transform((v) => (v === undefined ? undefined : v || null));

const recurringFields = {
  supplierName: z.string().trim().min(1, 'חובה לציין ספק'),
  supplierId: z.string().trim().min(1).nullable().optional(),
  label: z.string().trim().min(1).optional(),
  expectedDayOfMonth: z.number().int().min(1).max(31),
  expectedAmount: z.number().positive().nullable().optional(),
  tolerancePct: z.number().int().min(0).max(100).nullable().optional(),
  categoryTitle: z.string().trim().nullable().optional(),
  status: z.enum(['suggested', 'active', 'ignored']).optional(),
  notes: z.string().trim().nullable().optional(),
  cadence: z.enum(CADENCES).optional(),
  expectedMonth: z.number().int().min(1).max(12).nullable().optional(),
  aliases: z.array(z.string().trim().min(1).max(200)).max(30).optional()
    .transform((v) => (v === undefined ? undefined : [...new Set(v)])),
  invoiceSource: z.enum(INVOICE_SOURCES).optional(),
  portalUrl: z.string().trim().url('כתובת פורטל לא תקינה').max(1000).nullable().optional()
    .or(z.literal('').transform(() => null)),
  instructions: optText,
  owner: z.string().trim().max(100).nullable().optional().transform((v) => (v === undefined ? undefined : v || null)),
  emailMailbox: optText,
  emailFrom: optText,
  emailSubject: optText,
};
const yearlyNeedsMonth = (d: { cadence?: string; expectedMonth?: number | null }) =>
  d.cadence !== 'yearly' || !!d.expectedMonth;
const recurringBaseSchema = z.object(recurringFields)
  .refine(yearlyNeedsMonth, { message: 'בחיוב שנתי יש לבחור חודש צפוי', path: ['expectedMonth'] });
const recurringUpdateSchema = z.object(recurringFields).partial()
  .refine(yearlyNeedsMonth, { message: 'בחיוב שנתי יש לבחור חודש צפוי', path: ['expectedMonth'] });

// Optional registry fields shared by create + update (undefined = leave as is).
function registryData(data: z.infer<typeof recurringUpdateSchema>) {
  return {
    ...(data.cadence !== undefined && { cadence: data.cadence }),
    ...(data.expectedMonth !== undefined && { expectedMonth: data.expectedMonth }),
    ...(data.aliases !== undefined && { aliases: data.aliases }),
    ...(data.invoiceSource !== undefined && { invoiceSource: data.invoiceSource }),
    ...(data.portalUrl !== undefined && { portalUrl: data.portalUrl }),
    ...(data.instructions !== undefined && { instructions: data.instructions }),
    ...(data.owner !== undefined && { owner: data.owner }),
    ...(data.emailMailbox !== undefined && { emailMailbox: data.emailMailbox }),
    ...(data.emailFrom !== undefined && { emailFrom: data.emailFrom }),
    ...(data.emailSubject !== undefined && { emailSubject: data.emailSubject }),
  };
}

export function serializeRecurring(r: any) {
  return {
    id: r.id,
    supplierId: r.supplierId,
    supplierName: r.supplierName,
    label: r.label,
    expectedDayOfMonth: r.expectedDayOfMonth,
    expectedAmount: r.expectedAmount === null || r.expectedAmount === undefined ? null : Number(r.expectedAmount.toString()),
    tolerancePct: r.tolerancePct,
    cadence: r.cadence,
    expectedMonth: r.expectedMonth ?? null,
    aliases: r.aliases ?? [],
    invoiceSource: r.invoiceSource ?? 'portal',
    portalUrl: r.portalUrl ?? null,
    instructions: r.instructions ?? null,
    owner: r.owner ?? null,
    emailMailbox: r.emailMailbox ?? null,
    emailFrom: r.emailFrom ?? null,
    emailSubject: r.emailSubject ?? null,
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
        ...registryData(data),
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
        ...registryData(data),
      },
    });
    await logAudit({ action: 'UPDATE', entity: 'RecurringExpense', entityId: row.id, oldValue: serializeRecurring(existing), newValue: serializeRecurring(row), req });
    res.json(serializeRecurring(row));
  } catch (error) {
    next(error);
  }
});

// ─── Supplier grid ────────────────────────────────────────────────────────────

// GET /api/company-expenses/suppliers/grid?months=6&includeSuggested=true
companyExpensesRouter.get('/suppliers/grid', async (req, res, next) => {
  try {
    const q = z.object({
      months: z.coerce.number().int().min(3).max(12).default(6),
      includeSuggested: z.enum(['true', 'false']).optional(),
    }).parse(req.query);
    const grid = await getSupplierGrid({ months: q.months, includeSuggested: q.includeSuggested === 'true' });
    res.json({
      months: grid.months,
      suppliers: grid.suppliers.map(({ rec, cells }) => ({ ...serializeRecurring(rec), cells })),
    });
  } catch (error) {
    next(error);
  }
});

// ─── Manual invoice upload → Morning drafts ───────────────────────────────────

export const UPLOAD_MAX_FILES = 20;
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const UPLOAD_MIMES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const EXT_MIME: Record<string, string> = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };

/** Effective MIME: the declared one when allowed, else by extension for generic uploads. */
function resolveMime(file: Express.Multer.File): string | null {
  if (UPLOAD_MIMES.has(file.mimetype)) return file.mimetype;
  if (['application/octet-stream', 'binary/octet-stream', ''].includes(file.mimetype)) {
    return EXT_MIME[path.extname(file.originalname || '').toLowerCase()] ?? null;
  }
  return null;
}

const invoiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_MAX_BYTES, files: UPLOAD_MAX_FILES },
  fileFilter: (_req, file, cb) => {
    if (resolveMime(file)) cb(null, true);
    else cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', `unsupported:${file.originalname}`));
  },
}).array('files', UPLOAD_MAX_FILES);

function runInvoiceUpload(req: Request, res: Response, next: NextFunction) {
  invoiceUpload(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'קובץ גדול מדי — עד 10MB לקובץ'
        : err.code === 'LIMIT_FILE_COUNT' || (err.code === 'LIMIT_UNEXPECTED_FILE' && !err.field?.startsWith('unsupported:'))
          ? `ניתן להעלות עד ${UPLOAD_MAX_FILES} קבצים בשדה files`
          : err.field?.startsWith('unsupported:') ? `סוג קובץ לא נתמך (PDF / JPG / PNG בלבד): ${err.field.slice(12)}`
            : `שגיאה בהעלאת הקבצים: ${err.message}`;
      return res.status(400).json({ error: msg, message: msg });
    }
    next(err);
  });
}

export type UploadResultStatus = 'uploaded' | 'duplicate' | 'failed';

// POST /api/company-expenses/upload — multipart `files` (≤20 × 10MB, PDF/JPG/PNG),
// optional `recurringExpenseId`. Each file → Morning draft; duplicates (same sha256 already
// uploaded) are skipped. A drafts sync runs ~45s later so the new drafts show in the grid.
companyExpensesRouter.post('/upload', runInvoiceUpload, async (req, res, next) => {
  try {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) return res.status(400).json({ error: 'לא נבחרו קבצים' });
    if (!isMorningConfigured()) return res.status(503).json({ error: 'Morning לא מוגדר בשרת' });

    const recurringExpenseId = z.string().trim().max(100).optional()
      .transform((v) => v || undefined).parse(req.body?.recurringExpenseId);
    if (recurringExpenseId) {
      const rec = await prisma.recurringExpense.findUnique({ where: { id: recurringExpenseId }, select: { id: true } });
      if (!rec) return res.status(400).json({ error: 'ספק לא נמצא' });
    }
    const userId: string | null = (req as any).user?.userId ?? null;

    const results: Array<{ fileName: string; size: number; status: UploadResultStatus; error?: string; uploadId?: string }> = [];
    for (const file of files) {
      // multer delivers originalname as latin1 — restore Hebrew/Unicode names.
      const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const mime = resolveMime(file)!;
      const hash = sha256(file.buffer);
      const existing = await prisma.expenseUpload.findUnique({ where: { fileSha256: hash } });
      if (existing && existing.status !== 'failed') {
        results.push({ fileName, size: file.size, status: 'duplicate', uploadId: existing.id });
        continue;
      }
      let error: string | null = null;
      try {
        await uploadExpenseFileToMorning(file.buffer, fileName, mime);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      const data = {
        fileName, size: file.size, mime, uploadedBy: userId, source: 'manual',
        status: error ? 'failed' : 'uploaded', error, recurringExpenseId: recurringExpenseId ?? null,
      };
      try {
        const row = existing
          ? await prisma.expenseUpload.update({ where: { id: existing.id }, data })
          : await prisma.expenseUpload.create({ data: { fileSha256: hash, ...data } });
        results.push({ fileName, size: file.size, status: error ? 'failed' : 'uploaded', ...(error && { error }), uploadId: row.id });
      } catch (e) {
        // Concurrent upload of the same file won the unique hash.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          results.push({ fileName, size: file.size, status: 'duplicate' });
        } else throw e;
      }
    }

    const uploaded = results.filter((r) => r.status === 'uploaded').length;
    if (uploaded) scheduleDraftSyncAfterUpload();
    const summary = {
      uploaded,
      duplicate: results.filter((r) => r.status === 'duplicate').length,
      failed: results.filter((r) => r.status === 'failed').length,
    };
    await logAudit({
      action: 'CREATE', entity: 'ExpenseUpload', entityId: results.find((r) => r.uploadId)?.uploadId ?? 'batch',
      newValue: { ...summary, recurringExpenseId: recurringExpenseId ?? null, files: results.map(({ fileName, status }) => ({ fileName, status })) },
      req,
    });
    res.json({ results, summary, syncScheduled: uploaded > 0 });
  } catch (error) {
    next(error);
  }
});
