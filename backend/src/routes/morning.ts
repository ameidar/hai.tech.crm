import { Router } from 'express';
import { z } from 'zod';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { logAudit } from '../utils/audit.js';
import { createDocument, previewDocument, DOCUMENT_TYPES } from '../services/morning/documents.js';
import { isMorningConfigured, morningRequest } from '../services/morning/client.js';
import { prisma } from '../utils/prisma.js';

// Fixed monthly salaries for global employees (not paid via Morning or per-meeting).
// `excludeMonths` lists YYYY-MM strings where the employee should not be charged
// (e.g. unpaid leave / חל"ת).
const GLOBAL_MONTHLY_SALARIES: { name: string; amount: number; excludeMonths?: string[] }[] = [
  { name: 'הילה', amount: 13000, excludeMonths: ['2026-03'] },
  { name: 'אור', amount: 13000, excludeMonths: ['2026-03'] },
];

export const morningRouter = Router();
morningRouter.use(authenticate);

const incomeItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  price: z.number().nonnegative(),
  currency: z.string().optional(),
  vatType: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  catalogNum: z.string().optional(),
});

const createDocumentSchema = z.object({
  type: z.number().int().default(DOCUMENT_TYPES.PROFORMA),
  lang: z.enum(['he', 'en']).default('he'),
  currency: z.string().default('ILS'),
  vatType: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
  client: z.object({
    name: z.string().min(1),
    taxId: z.string().optional().nullable(),
    emails: z.array(z.string().email()).optional(),
    phone: z.string().optional().nullable(),
    mobile: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
    city: z.string().optional().nullable(),
    zip: z.string().optional().nullable(),
    add: z.boolean().optional(),
  }),
  income: z.array(incomeItemSchema).min(1),
  remarks: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
});

morningRouter.get('/status', (_req, res) => {
  res.json({ configured: isMorningConfigured() });
});

function buildPayload(data: ReturnType<typeof createDocumentSchema.parse>) {
  const cleanedClient = {
    ...data.client,
    taxId: data.client.taxId || undefined,
    phone: data.client.phone || undefined,
    mobile: data.client.mobile || undefined,
    address: data.client.address || undefined,
    city: data.client.city || undefined,
    zip: data.client.zip || undefined,
  };
  return {
    ...data,
    client: cleanedClient,
    remarks: data.remarks || undefined,
    description: data.description || undefined,
    dueDate: data.dueDate || undefined,
  };
}

morningRouter.post('/documents', managerOrAdmin, async (req, res, next) => {
  try {
    if (!isMorningConfigured()) {
      throw new AppError(503, 'Morning API is not configured on this server');
    }

    const data = createDocumentSchema.parse(req.body);
    const payload = buildPayload(data);
    const document = await createDocument(payload);

    await logAudit({
      req,
      action: 'CREATE',
      entity: 'MorningDocument',
      entityId: document.id,
      newValue: { type: data.type, number: document.number, clientName: data.client.name },
    });

    res.json({
      success: true,
      document: {
        id: document.id,
        number: document.number,
        type: document.type,
        documentDate: document.documentDate,
        status: document.status,
        urlHe: document.url?.he,
        urlEn: document.url?.en,
        urlOrigin: document.url?.origin,
      },
    });
  } catch (err: any) {
    if (err.body) {
      return res.status(err.status || 500).json({ error: 'Morning API error', details: err.body });
    }
    next(err);
  }
});

// GET /api/morning/financials?months=12
// Fetches real income + expenses from Morning and aggregates by month.
morningRouter.get('/financials', managerOrAdmin, async (req, res, next) => {
  try {
    if (!isMorningConfigured()) {
      throw new AppError(503, 'Morning API is not configured on this server');
    }

    const mode = String(req.query.mode || '');
    const now = new Date();
    let fromDate: Date;
    let toDate: Date;
    let months: number;

    if (mode === 'ytd') {
      // Year-to-date: Jan 1 of current year through today
      fromDate = new Date(now.getFullYear(), 0, 1);
      toDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      months = now.getMonth() + 1;
    } else {
      months = Math.min(24, Math.max(1, Number(req.query.months) || 12));
      fromDate = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
      toDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    }
    const fromDateStr = fromDate.toISOString().split('T')[0];
    const toDateStr = toDate.toISOString().split('T')[0];

    // Income = binding tax invoices (305 + 320) minus credit notes (330).
    // Exclude type 300 (proforma — not real income) and type 400 (would double-count with 305).
    // Exclude status 2 (cancelled).
    // Note: Morning API uses `page` (1-based), not `pageIndex` — passing pageIndex
    // makes the API ignore pagination and return the same first page repeatedly.
    async function fetchAllDocs(type: number[]): Promise<any[]> {
      const all: any[] = [];
      let page = 1;
      while (true) {
        const r = await morningRequest<any>('POST', '/api/v1/documents/search', {
          pageSize: 500, page, fromDate: fromDateStr, toDate: toDateStr, type,
        });
        const items: any[] = r.items || [];
        all.push(...items);
        if (items.length < 500 || all.length >= (r.total ?? all.length)) break;
        page++;
        if (page > 50) break;
      }
      return all;
    }

    // Match Morning's "תקבולים" report: types 305 + 320 + 400 minus 330 (credit notes).
    // Excludes 300 (proforma — not real income) and status 2 (cancelled).
    const allIncome = (await fetchAllDocs([305, 320, 400])).filter((d: any) => d.status !== 2);
    const allCreditNotes = (await fetchAllDocs([330])).filter((d: any) => d.status !== 2);

    // Expenses — also uses `page` (1-based). Search a wider window so we can match
    // by `reportingDate` (חודש דיווח) which Morning's reports group by — a doc may
    // have a document date earlier than its reporting period.
    const expFromDate = new Date(fromDate);
    expFromDate.setMonth(expFromDate.getMonth() - 12);
    const expFromStr = expFromDate.toISOString().split('T')[0];

    let allExpenses: any[] = [];
    try {
      let page = 1;
      while (true) {
        const result = await morningRequest<any>('POST', '/api/v1/expenses/search', {
          pageSize: 500, page, fromDate: expFromStr, toDate: toDateStr,
        });
        const items: any[] = result.items || [];
        allExpenses = allExpenses.concat(items);
        if (items.length < 500 || allExpenses.length >= (result.total ?? allExpenses.length)) break;
        page++;
        if (page > 50) break;
      }
    } catch {
      // expenses endpoint not available
    }

    // Sum instructor payments from completed past meetings, grouped by month.
    const completedMeetings = await prisma.meeting.findMany({
      where: {
        status: 'completed',
        scheduledDate: { gte: fromDate, lte: toDate },
      },
      select: { scheduledDate: true, instructorPayment: true },
    });

    // Build month map (last N months) — also tracks instructor payments + salaries
    const HEBREW_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
    const monthMap = new Map<string, { income: number; morningExpenses: number; instructorPayments: number; docCount: number }>();
    for (let i = 0; i < months; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - months + 1 + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthMap.set(key, { income: 0, morningExpenses: 0, instructorPayments: 0, docCount: 0 });
    }

    for (const m of completedMeetings) {
      const d = m.scheduledDate;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const entry = monthMap.get(key);
      if (entry) entry.instructorPayments += Number(m.instructorPayment ?? 0);
    }

    function docDateToKey(raw: any): string | null {
      let d: Date;
      if (typeof raw === 'number') {
        // Unix timestamp: Morning uses seconds
        d = new Date(raw < 1e12 ? raw * 1000 : raw);
      } else if (typeof raw === 'string') {
        d = new Date(raw);
      } else return null;
      if (isNaN(d.getTime())) return null;
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }

    // Use amountExcludeVat — net income/expense without VAT, matches Morning's
    // "הכנסות לא כולל מע״מ" report and the standard accountant view.
    for (const item of allIncome) {
      const key = docDateToKey(item.documentDate ?? item.date);
      const entry = key ? monthMap.get(key) : null;
      if (entry) {
        entry.income += Number(item.amountExcludeVat ?? 0);
        entry.docCount++;
      }
    }

    // Subtract credit notes from income (refunds/cancellations)
    for (const item of allCreditNotes) {
      const key = docDateToKey(item.documentDate ?? item.date);
      const entry = key ? monthMap.get(key) : null;
      if (entry) {
        entry.income -= Number(item.amountExcludeVat ?? 0);
      }
    }

    // Aggregate expenses by reportingDate (חודש דיווח) — matches Morning's report.
    // Docs outside the requested window's reporting months are filtered out here.
    for (const item of allExpenses) {
      const key = docDateToKey(item.reportingDate ?? item.date);
      const entry = key ? monthMap.get(key) : null;
      if (entry) {
        entry.morningExpenses += Number(item.amountExcludeVat ?? 0);
      }
    }

    const result = Array.from(monthMap.entries()).map(([key, data]) => {
      const [year, month] = key.split('-').map(Number);
      const morningExp = Math.round(data.morningExpenses);
      const instructorPay = Math.round(data.instructorPayments);
      // Sum global salaries for this month, excluding employees on leave (excludeMonths).
      const globalSalariesMonthly = GLOBAL_MONTHLY_SALARIES.reduce(
        (s, e) => s + (e.excludeMonths?.includes(key) ? 0 : e.amount),
        0,
      );
      const totalExpenses = morningExp + instructorPay + globalSalariesMonthly;
      const income = Math.round(data.income);
      return {
        month: key,
        monthName: `${HEBREW_MONTHS[month - 1]} ${year}`,
        income,
        morningExpenses: morningExp,
        instructorPayments: instructorPay,
        globalSalaries: globalSalariesMonthly,
        expenses: totalExpenses,
        profit: income - totalExpenses,
        docCount: data.docCount,
      };
    });

    res.json({
      months: result,
      hasExpenses: allExpenses.length > 0,
      globalEmployees: GLOBAL_MONTHLY_SALARIES,
    });
  } catch (err: any) {
    if (err.body) {
      return res.status(err.status || 500).json({ error: 'Morning API error', details: err.body });
    }
    next(err);
  }
});

// Preview — returns base64 PDF without creating any record in Morning.
// Use for safe end-to-end testing.
morningRouter.post('/documents/preview', managerOrAdmin, async (req, res, next) => {
  try {
    if (!isMorningConfigured()) {
      throw new AppError(503, 'Morning API is not configured on this server');
    }

    const data = createDocumentSchema.parse(req.body);
    const payload = buildPayload(data);
    const result = await previewDocument(payload);

    res.json({ success: true, fileBase64: result.file });
  } catch (err: any) {
    if (err.body) {
      return res.status(err.status || 500).json({ error: 'Morning API error', details: err.body });
    }
    next(err);
  }
});
