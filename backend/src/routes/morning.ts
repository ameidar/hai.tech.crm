import { Router } from 'express';
import { z } from 'zod';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { logAudit } from '../utils/audit.js';
import { createDocument, previewDocument, DOCUMENT_TYPES } from '../services/morning/documents.js';
import { isMorningConfigured, morningRequest } from '../services/morning/client.js';
import { prisma } from '../utils/prisma.js';

// Fixed monthly salaries for global employees (not paid via Morning or per-meeting).
// `monthOverrides` lets specific months override the default (e.g. partial month,
// reduced pay, unpaid leave = 0).
const GLOBAL_MONTHLY_SALARIES: { name: string; amount: number; monthOverrides?: Record<string, number> }[] = [
  { name: 'הילה', amount: 13000, monthOverrides: { '2026-03': 8000, '2026-04': 3000 } },
  { name: 'אור', amount: 13000, monthOverrides: { '2026-03': 8000, '2026-04': 8000 } },
];

function salaryForMonth(emp: typeof GLOBAL_MONTHLY_SALARIES[number], month: string): number {
  return emp.monthOverrides?.[month] ?? emp.amount;
}

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

    // Sum instructor payments for past meetings.
    // Include both `completed` and past `scheduled` meetings — in dev/prod the
    // status often isn't auto-updated to completed after the date passes, so
    // past scheduled meetings still represent real instructor cost.
    // Compute payment from rate × duration when stored instructorPayment is 0
    // (which happens for scheduled meetings that haven't been finalized).
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const meetingsForPayments = await prisma.meeting.findMany({
      where: {
        scheduledDate: { gte: fromDate, lte: toDate },
        OR: [
          { status: 'completed' },
          { status: 'scheduled', scheduledDate: { lte: todayMidnight } },
        ],
      },
      select: {
        scheduledDate: true,
        startTime: true,
        endTime: true,
        instructorPayment: true,
        activityType: true,
        cycle: {
          select: {
            activityType: true,
            isOnline: true,
            type: true,
            durationMinutes: true,
          },
        },
        instructor: {
          select: { rateFrontal: true, rateOnline: true, ratePrivate: true, employmentType: true },
        },
      },
    });

    function computeInstructorPayment(m: typeof meetingsForPayments[number]): number {
      const stored = Number(m.instructorPayment ?? 0);
      if (stored > 0) return stored;
      // Fall back to live calculation: rate × duration (× 1.3 for employees).
      const instr = m.instructor;
      if (!instr) return 0;
      const cycle = m.cycle;
      const actType = m.activityType ?? cycle?.activityType ?? (cycle?.isOnline ? 'online' : cycle?.type === 'private' ? 'private_lesson' : 'frontal');
      let hourlyRate = 0;
      switch (actType) {
        case 'online': hourlyRate = Number(instr.rateOnline ?? instr.rateFrontal ?? 0); break;
        case 'private_lesson': hourlyRate = Number(instr.ratePrivate ?? instr.rateFrontal ?? 0); break;
        default: hourlyRate = Number(instr.rateFrontal ?? 0);
      }
      let durationMinutes = Number(cycle?.durationMinutes ?? 60);
      if (m.startTime && m.endTime) {
        const calc = (m.endTime.getTime() - m.startTime.getTime()) / 60000;
        if (calc > 0 && calc < 1440) durationMinutes = calc;
      }
      let payment = Math.round(hourlyRate * (durationMinutes / 60));
      if (instr.employmentType === 'employee') payment = Math.round(payment * 1.3);
      return payment;
    }

    // Build month map (last N months) — also tracks instructor payments + salaries
    const HEBREW_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
    const monthMap = new Map<string, { income: number; morningExpenses: number; instructorPayments: number; docCount: number }>();
    for (let i = 0; i < months; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - months + 1 + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthMap.set(key, { income: 0, morningExpenses: 0, instructorPayments: 0, docCount: 0 });
    }

    for (const m of meetingsForPayments) {
      const d = m.scheduledDate;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const entry = monthMap.get(key);
      if (entry) entry.instructorPayments += computeInstructorPayment(m);
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
    // Use deductibleAmount: this is the recognized expense in ILS, excluding any
    // recoverable Israeli VAT. The DB stores it pre-converted from the document's
    // original currency. amountExcludeVat is in the document's own currency, so
    // summing it across mixed currencies (ILS/USD/EUR) produces wrong totals.
    for (const item of allExpenses) {
      const key = docDateToKey(item.reportingDate ?? item.date);
      const entry = key ? monthMap.get(key) : null;
      if (entry) {
        entry.morningExpenses += Number(item.deductibleAmount ?? 0);
      }
    }

    const result = Array.from(monthMap.entries()).map(([key, data]) => {
      const [year, month] = key.split('-').map(Number);
      const morningExp = Math.round(data.morningExpenses);
      const instructorPay = Math.round(data.instructorPayments);
      // Sum global salaries for this month, applying any per-month overrides.
      const globalSalariesMonthly = GLOBAL_MONTHLY_SALARIES.reduce(
        (s, e) => s + salaryForMonth(e, key),
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

// GET /api/morning/financials/details?month=YYYY-MM&category=income|morningExpenses|instructorPayments|globalSalaries
// Returns the line items that compose a single chart cell.
morningRouter.get('/financials/details', managerOrAdmin, async (req, res, next) => {
  try {
    if (!isMorningConfigured()) throw new AppError(503, 'Morning API is not configured on this server');
    const month = String(req.query.month || '');
    const category = String(req.query.category || '');
    if (!/^\d{4}-\d{2}$/.test(month)) throw new AppError(400, 'month must be YYYY-MM');

    const [yearStr, monthStr] = month.split('-');
    const yearN = Number(yearStr);
    const monthN = Number(monthStr);
    const monthStart = new Date(yearN, monthN - 1, 1);
    const monthEnd = new Date(yearN, monthN, 0);
    const fromStr = monthStart.toISOString().split('T')[0];
    const toStr = monthEnd.toISOString().split('T')[0];

    async function fetchAllDocs(type: number[]): Promise<any[]> {
      const all: any[] = [];
      let page = 1;
      while (true) {
        const r = await morningRequest<any>('POST', '/api/v1/documents/search', {
          pageSize: 500, page, fromDate: fromStr, toDate: toStr, type,
        });
        const items: any[] = r.items || [];
        all.push(...items);
        if (items.length < 500 || all.length >= (r.total ?? all.length)) break;
        page++;
        if (page > 20) break;
      }
      return all;
    }

    if (category === 'income') {
      const inc = (await fetchAllDocs([305, 320, 400])).filter((d: any) => d.status !== 2);
      const credits = (await fetchAllDocs([330])).filter((d: any) => d.status !== 2);
      const items = [
        ...inc.map((d: any) => ({
          date: d.documentDate, type: d.type, number: String(d.number ?? ''),
          name: d.client?.name ?? '—',
          amount: Math.round(Number(d.amountExcludeVat ?? 0)),
          url: d.url?.he ?? d.url?.origin ?? null,
        })),
        ...credits.map((d: any) => ({
          date: d.documentDate, type: d.type, number: String(d.number ?? ''),
          name: `${d.client?.name ?? '—'} (זיכוי)`,
          amount: -Math.round(Number(d.amountExcludeVat ?? 0)),
          url: d.url?.he ?? d.url?.origin ?? null,
        })),
      ].sort((a, b) => String(a.date).localeCompare(String(b.date)));
      return res.json({ items });
    }

    if (category === 'morningExpenses') {
      // Search 12 months wider then filter by reportingDate.
      const wider = new Date(yearN - 1, monthN - 1, 1).toISOString().split('T')[0];
      const all: any[] = [];
      let page = 1;
      while (true) {
        const r = await morningRequest<any>('POST', '/api/v1/expenses/search', {
          pageSize: 500, page, fromDate: wider, toDate: toStr,
        });
        const items: any[] = r.items || [];
        all.push(...items);
        if (items.length < 500 || all.length >= (r.total ?? all.length)) break;
        page++;
        if (page > 20) break;
      }
      const items = all
        .filter((e: any) => String(e.reportingDate ?? e.date).startsWith(month))
        .map((e: any) => ({
          date: e.date,
          reportingDate: e.reportingDate,
          name: e.supplier?.name ?? e.data?.supplier?.name ?? '—',
          description: e.description ?? e.data?.description ?? '',
          amount: Math.round(Number(e.deductibleAmount ?? 0)),
          url: e.url ?? null,
        }))
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
      return res.json({ items });
    }

    if (category === 'instructorPayments') {
      const now = new Date();
      const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const meetings = await prisma.meeting.findMany({
        where: {
          scheduledDate: { gte: monthStart, lte: monthEnd },
          OR: [
            { status: 'completed' },
            { status: 'scheduled', scheduledDate: { lte: todayMid } },
          ],
        },
        select: {
          id: true, scheduledDate: true, startTime: true, endTime: true, status: true,
          instructorPayment: true, activityType: true,
          cycle: { select: { name: true, activityType: true, isOnline: true, type: true, durationMinutes: true } },
          instructor: { select: { name: true, rateFrontal: true, rateOnline: true, ratePrivate: true, employmentType: true } },
        },
        orderBy: { scheduledDate: 'asc' },
      });

      function compute(m: typeof meetings[number]): number {
        const stored = Number(m.instructorPayment ?? 0);
        if (stored > 0) return stored;
        const instr = m.instructor;
        if (!instr) return 0;
        const cycle = m.cycle;
        const actType = m.activityType ?? cycle?.activityType ?? (cycle?.isOnline ? 'online' : cycle?.type === 'private' ? 'private_lesson' : 'frontal');
        let hourlyRate = 0;
        switch (actType) {
          case 'online': hourlyRate = Number(instr.rateOnline ?? instr.rateFrontal ?? 0); break;
          case 'private_lesson': hourlyRate = Number(instr.ratePrivate ?? instr.rateFrontal ?? 0); break;
          default: hourlyRate = Number(instr.rateFrontal ?? 0);
        }
        let durationMinutes = Number(cycle?.durationMinutes ?? 60);
        if (m.startTime && m.endTime) {
          const calc = (m.endTime.getTime() - m.startTime.getTime()) / 60000;
          if (calc > 0 && calc < 1440) durationMinutes = calc;
        }
        let p = Math.round(hourlyRate * (durationMinutes / 60));
        if (instr.employmentType === 'employee') p = Math.round(p * 1.3);
        return p;
      }

      const items = meetings.map((m) => ({
        date: m.scheduledDate.toISOString().split('T')[0],
        instructorName: m.instructor?.name ?? '—',
        cycleName: m.cycle?.name ?? '—',
        status: m.status,
        amount: compute(m),
      }));
      return res.json({ items });
    }

    if (category === 'globalSalaries') {
      const items = GLOBAL_MONTHLY_SALARIES
        .map((e) => ({ name: e.name, amount: salaryForMonth(e, month) }))
        .filter((i) => i.amount > 0);
      return res.json({ items });
    }

    throw new AppError(400, 'unknown category');
  } catch (err: any) {
    if (err.body) {
      return res.status(err.status || 500).json({ error: 'Morning API error', details: err.body });
    }
    next(err);
  }
});

// GET /api/morning/branch-reconciliation?mode=ytd|months=N
// Per-branch monthly comparison: CRM revenue (from meetings) vs Morning invoices
// (305 + 320, ex-VAT). Helps spot mismatches between recognized revenue and
// actual billing.
morningRouter.get('/branch-reconciliation', managerOrAdmin, async (req, res, next) => {
  try {
    if (!isMorningConfigured()) throw new AppError(503, 'Morning API is not configured');

    const mode = String(req.query.mode || '');
    const now = new Date();
    let fromDate: Date;
    let toDate: Date;
    let monthCount: number;
    if (mode === 'ytd') {
      fromDate = new Date(now.getFullYear(), 0, 1);
      toDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      monthCount = now.getMonth() + 1;
    } else {
      monthCount = Math.min(24, Math.max(1, Number(req.query.months) || 12));
      fromDate = new Date(now.getFullYear(), now.getMonth() - monthCount + 1, 1);
      toDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    }
    const fromStr = fromDate.toISOString().split('T')[0];
    const toStr = toDate.toISOString().split('T')[0];

    const monthKeys: string[] = [];
    for (let i = 0; i < monthCount; i++) {
      const d = new Date(fromDate.getFullYear(), fromDate.getMonth() + i, 1);
      monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    // CRM side: per-branch, per-month revenue from past meetings
    const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const meetings = await prisma.meeting.findMany({
      where: {
        scheduledDate: { gte: fromDate, lte: toDate },
        OR: [
          { status: 'completed' },
          { status: 'scheduled', scheduledDate: { lte: todayMid } },
        ],
      },
      select: {
        scheduledDate: true,
        revenue: true,
        cycle: { select: { branchId: true, branch: { select: { id: true, name: true } } } },
      },
    });

    type BranchAcc = { id: string; name: string; crmByMonth: Record<string, number> };
    const branches = new Map<string, BranchAcc>();
    for (const m of meetings) {
      const b = m.cycle?.branch;
      if (!b) continue;
      const key = `${m.scheduledDate.getFullYear()}-${String(m.scheduledDate.getMonth() + 1).padStart(2, '0')}`;
      if (!branches.has(b.id)) branches.set(b.id, { id: b.id, name: b.name, crmByMonth: {} });
      const acc = branches.get(b.id)!;
      acc.crmByMonth[key] = (acc.crmByMonth[key] ?? 0) + Number(m.revenue ?? 0);
    }

    // Morning side: invoices in window
    async function fetchAllDocs(type: number[]): Promise<any[]> {
      const all: any[] = [];
      let page = 1;
      while (true) {
        const r = await morningRequest<any>('POST', '/api/v1/documents/search', {
          pageSize: 500, page, fromDate: fromStr, toDate: toStr, type,
        });
        const items: any[] = r.items || [];
        all.push(...items);
        if (items.length < 500 || all.length >= (r.total ?? all.length)) break;
        page++;
        if (page > 30) break;
      }
      return all;
    }
    const invoices = (await fetchAllDocs([305, 320])).filter((d: any) => d.status !== 2);
    const credits = (await fetchAllDocs([330])).filter((d: any) => d.status !== 2);

    // Group Morning invoices by client name + month. Capture client.id for deep-linking.
    type ClientAcc = { name: string; clientId: string | null; byMonth: Record<string, number>; docCount: number };
    const clientMap = new Map<string, ClientAcc>();
    function addInvoice(d: any, sign: 1 | -1) {
      const name = d.client?.name ?? '—';
      const cid = d.client?.id ?? null;
      const date = d.documentDate;
      if (!date || typeof date !== 'string') return;
      const key = date.slice(0, 7);
      if (!clientMap.has(name)) clientMap.set(name, { name, clientId: cid, byMonth: {}, docCount: 0 });
      const acc = clientMap.get(name)!;
      if (!acc.clientId && cid) acc.clientId = cid;
      acc.byMonth[key] = (acc.byMonth[key] ?? 0) + sign * Number(d.amountExcludeVat ?? 0);
      acc.docCount++;
    }
    for (const d of invoices) addInvoice(d, 1);
    for (const d of credits) addInvoice(d, -1);

    // Match branches to Morning clients by name similarity
    function matchScore(a: string, b: string): number {
      const na = norm(a);
      const nb = norm(b);
      if (!na || !nb) return 0;
      if (na === nb) return 100;
      if (na.includes(nb) || nb.includes(na)) return 80;
      const wA = na.split(' ').filter((w) => w.length >= 3);
      const wB = nb.split(' ').filter((w) => w.length >= 3);
      if (wA.length === 0 || wB.length === 0) return 0;
      const common = wA.filter((w) => wB.includes(w)).length;
      return Math.round((common / Math.max(wA.length, wB.length)) * 60);
    }

    type BranchOut = {
      branchId: string;
      branchName: string;
      matchedClients: { name: string; clientId: string | null }[];
      crmTotal: number;
      morningTotal: number;
      diff: number;
      monthly: { month: string; crm: number; morning: number; diff: number }[];
    };

    const usedClients = new Set<string>();
    const result: BranchOut[] = [];

    // Branches to exclude from the reconciliation view (one-off / non-billable
    // buckets that don't have a single Morning client to reconcile against).
    const EXCLUDED_BRANCHES = ['כללי', 'אונליין b2c', 'עומר פרונטלי', 'אונליין'];
    const isExcluded = (name: string) =>
      EXCLUDED_BRANCHES.some((ex) => name.toLowerCase().trim() === ex);

    // Manual mapping for branches whose name doesn't fuzzy-match the Morning
    // client name. Keys = CRM branch name (normalized), values = Morning client
    // name (normalized) — both lower-cased & quote-stripped via the normalize() fn.
    function norm(s: string): string {
      return s.toLowerCase().replace(/['"״׳`]/g, '').replace(/\s+/g, ' ').trim();
    }
    const BRANCH_TO_MORNING: Record<string, string> = {
      [norm('מרכז סקו״פ חולון')]: norm('רשת קהילה ופנאי - המרכז להעשרה חינוכית'),
      [norm('כיוונים - חוגים')]: norm('כיוונים באר שבע'),
      [norm('בית ספר רימון רעננה')]: norm('חט"ב רימון רעננה'),
    };

    // Iterate branches with revenue, find best client match
    const branchList = Array.from(branches.values()).filter(
      (b) => Object.values(b.crmByMonth).some((v) => v > 0) && !isExcluded(b.name),
    );
    branchList.sort((a, b) => {
      const sa = Object.values(a.crmByMonth).reduce((s, v) => s + v, 0);
      const sb = Object.values(b.crmByMonth).reduce((s, v) => s + v, 0);
      return sb - sa;
    });

    for (const b of branchList) {
      const matched: { name: string; clientId: string | null }[] = [];
      // First, prefer manual override mapping if present.
      const overrideTarget = BRANCH_TO_MORNING[norm(b.name)];
      if (overrideTarget) {
        for (const [cn, acc] of clientMap) {
          if (norm(cn) === overrideTarget) {
            matched.push({ name: cn, clientId: acc.clientId });
            usedClients.add(cn);
            break;
          }
        }
      }
      // Fall back to fuzzy match if no override (or override missed).
      if (matched.length === 0) {
        const candidates: { name: string; score: number }[] = [];
        for (const [cn] of clientMap) {
          if (usedClients.has(cn)) continue;
          const s = matchScore(b.name, cn);
          if (s >= 50) candidates.push({ name: cn, score: s });
        }
        candidates.sort((a, b) => b.score - a.score);
        for (const c of candidates.slice(0, 1)) {
          const acc = clientMap.get(c.name);
          matched.push({ name: c.name, clientId: acc?.clientId ?? null });
          usedClients.add(c.name);
        }
      }

      const morningByMonth: Record<string, number> = {};
      for (const m of matched) {
        const acc = clientMap.get(m.name);
        if (!acc) continue;
        for (const [k, v] of Object.entries(acc.byMonth)) {
          morningByMonth[k] = (morningByMonth[k] ?? 0) + v;
        }
      }

      const monthly = monthKeys.map((k) => {
        const crm = Math.round(b.crmByMonth[k] ?? 0);
        const morning = Math.round(morningByMonth[k] ?? 0);
        return { month: k, crm, morning, diff: crm - morning };
      });
      const crmTotal = monthly.reduce((s, m) => s + m.crm, 0);
      const morningTotal = monthly.reduce((s, m) => s + m.morning, 0);
      result.push({
        branchId: b.id,
        branchName: b.name,
        matchedClients: matched,
        crmTotal,
        morningTotal,
        diff: crmTotal - morningTotal,
        monthly,
      });
    }

    // Also list unmatched Morning clients (Morning income with no matching CRM branch)
    const unmatchedClients: { name: string; total: number; monthly: Record<string, number> }[] = [];
    for (const [name, acc] of clientMap) {
      if (usedClients.has(name)) continue;
      const total = Object.values(acc.byMonth).reduce((s, v) => s + v, 0);
      if (total > 0) unmatchedClients.push({ name, total: Math.round(total), monthly: acc.byMonth });
    }
    unmatchedClients.sort((a, b) => b.total - a.total);

    res.json({
      months: monthKeys,
      branches: result,
      unmatchedClients,
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
