import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

let role = 'admin';

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    companyExpense: {
      findMany: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
    },
    recurringExpense: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    expenseUpload: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../../services/morning/expense-upload.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/morning/expense-upload.js')>();
  return { ...actual, uploadExpenseFileToMorning: vi.fn(async () => undefined) };
});

vi.mock('../../services/company-expenses-scheduler.js', () => ({ scheduleDraftSyncAfterUpload: vi.fn() }));

// Keep the real adminOnly guard; only stub token verification.
vi.mock('../../middleware/auth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/auth.js')>();
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = { userId: 'u1', role };
      next();
    },
  };
});

vi.mock('../../utils/audit.js', () => ({ logAudit: vi.fn() }));

vi.mock('../../services/morning/client.js', () => ({
  isMorningConfigured: vi.fn(() => true),
  morningRequest: vi.fn(),
}));

vi.mock('../../services/notifications.js', () => ({
  ADMIN_PHONE: '0528746137',
  sendWhatsAppMessage: vi.fn(),
}));

import { companyExpensesRouter } from '../company-expenses.js';
import { prisma } from '../../utils/prisma.js';
import { morningRequest } from '../../services/morning/client.js';
import { sha256, uploadExpenseFileToMorning } from '../../services/morning/expense-upload.js';
import { scheduleDraftSyncAfterUpload } from '../../services/company-expenses-scheduler.js';
import { logAudit } from '../../utils/audit.js';
import { errorHandler } from '../../middleware/errorHandler.js';

const mockPrisma = vi.mocked(prisma, true);
const app = express();
app.use(express.json());
app.use('/api/company-expenses', companyExpensesRouter);
app.use(errorHandler);

beforeEach(() => {
  vi.clearAllMocks();
  role = 'admin';
});

describe('company expenses — admin-only guard', () => {
  it.each(['manager', 'sales', 'instructor', 'operations_manager'])('blocks %s with 403', async (r) => {
    role = r;
    for (const [method, path] of [
      ['get', '/api/company-expenses'],
      ['get', '/api/company-expenses/summary'],
      ['post', '/api/company-expenses/sync'],
      ['get', '/api/company-expenses/recurring'],
      ['get', '/api/company-expenses/recurring/missing'],
      ['post', '/api/company-expenses/recurring'],
      ['get', '/api/company-expenses/suppliers/grid'],
      ['post', '/api/company-expenses/upload'],
    ] as const) {
      const res = await (request(app) as any)[method](path).send({});
      expect(res.status, `${method} ${path}`).toBe(403);
    }
    expect(mockPrisma.companyExpense.findMany).not.toHaveBeenCalled();
    expect(morningRequest).not.toHaveBeenCalled();
  });

  it('lets admins list expenses with pagination', async () => {
    mockPrisma.companyExpense.findMany.mockResolvedValue([{
      id: 'c1', morningId: 'm1', status: 20, documentType: '305', number: '12', date: new Date('2026-11-02T00:00:00Z'),
      reportingDate: null, amount: { toString: () => '117.00' }, amountExcludeVat: { toString: () => '100.00' },
      vat: { toString: () => '17.00' }, currency: 'ILS', description: null, supplierId: 's', supplierName: 'ספק',
      categoryId: null, categoryTitle: null, url: 'https://doc', active: true, syncedAt: new Date(),
    }] as never);
    mockPrisma.companyExpense.count.mockResolvedValue(1 as never);
    mockPrisma.companyExpense.aggregate.mockResolvedValue({ _sum: { amount: 117, amountExcludeVat: 100 } } as never);

    const res = await request(app).get('/api/company-expenses?from=2026-11&to=2026-11&status=20&page=1&limit=50');
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ morningId: 'm1', amount: 117, amountExcludeVat: 100, month: '2026-11', url: 'https://doc' });
    expect(res.body.pagination).toMatchObject({ total: 1, page: 1, totalPages: 1 });
    expect(res.body.totals).toEqual({ gross: 117, net: 100 });
  });

  it('rejects a malformed month filter', async () => {
    const res = await request(app).get('/api/company-expenses?from=2026-13');
    expect(res.status).toBe(400);
  });

  it('creates a manual recurring expense as active', async () => {
    mockPrisma.recurringExpense.create.mockImplementation((async ({ data }: any) => ({ id: 'r1', ...data })) as never);
    const res = await request(app).post('/api/company-expenses/recurring')
      .send({ supplierName: 'שכירות', expectedDayOfMonth: 1, expectedAmount: 5000, tolerancePct: null });
    expect(res.status).toBe(201);
    expect(mockPrisma.recurringExpense.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ supplierName: 'שכירות', label: 'שכירות', status: 'active', source: 'manual' }),
    });
  });
});

describe('supplier registry fields', () => {
  it('stores the new registry fields on update', async () => {
    mockPrisma.recurringExpense.findUnique.mockResolvedValue({ id: 'r1', status: 'active', cadence: 'monthly' } as never);
    mockPrisma.recurringExpense.update.mockImplementation((async ({ data }: any) => ({ id: 'r1', ...data })) as never);
    const res = await request(app).put('/api/company-expenses/recurring/r1').send({
      cadence: 'yearly', expectedMonth: 3, aliases: ['"twillio', 'twillio', 'twillio'], invoiceSource: 'email',
      portalUrl: '', instructions: 'בתפריט Billing', owner: 'אינה',
    });
    expect(res.status).toBe(200);
    expect(mockPrisma.recurringExpense.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: expect.objectContaining({
        cadence: 'yearly', expectedMonth: 3, aliases: ['"twillio', 'twillio'], invoiceSource: 'email',
        portalUrl: null, instructions: 'בתפריט Billing', owner: 'אינה',
      }),
    });
    expect(res.body).toMatchObject({ cadence: 'yearly', expectedMonth: 3, invoiceSource: 'email' });
  });

  it('requires an expected month for yearly cadence and validates enums', async () => {
    expect((await request(app).put('/api/company-expenses/recurring/r1').send({ cadence: 'yearly' })).status).toBe(400);
    expect((await request(app).put('/api/company-expenses/recurring/r1').send({ invoiceSource: 'fax' })).status).toBe(400);
    expect((await request(app).put('/api/company-expenses/recurring/r1').send({ portalUrl: 'not a url' })).status).toBe(400);
    expect(mockPrisma.recurringExpense.update).not.toHaveBeenCalled();
  });
});

describe('GET /suppliers/grid', () => {
  it('returns months and per-supplier cells for active rows', async () => {
    mockPrisma.recurringExpense.findMany.mockResolvedValue([{
      id: 'r1', supplierId: 'hz', supplierName: 'Hetzner', label: 'Hetzner', expectedDayOfMonth: 1,
      expectedAmount: null, tolerancePct: null, cadence: 'monthly', status: 'active', aliases: [], invoiceSource: 'email',
    }] as never);
    mockPrisma.companyExpense.findMany.mockResolvedValue([] as never);
    const res = await request(app).get('/api/company-expenses/suppliers/grid?months=3');
    expect(res.status).toBe(200);
    expect(res.body.months).toHaveLength(3);
    expect(res.body.suppliers[0]).toMatchObject({ id: 'r1', invoiceSource: 'email', aliases: [] });
    expect(Object.keys(res.body.suppliers[0].cells)).toEqual(res.body.months);
    expect(mockPrisma.recurringExpense.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: { in: ['active'] } } }));

    await request(app).get('/api/company-expenses/suppliers/grid?includeSuggested=true');
    expect(mockPrisma.recurringExpense.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { status: { in: ['active', 'suggested'] } } }));
  });

  it('rejects out-of-range months', async () => {
    expect((await request(app).get('/api/company-expenses/suppliers/grid?months=2')).status).toBe(400);
    expect((await request(app).get('/api/company-expenses/suppliers/grid?months=13')).status).toBe(400);
  });
});

describe('POST /upload', () => {
  const pdfA = Buffer.from('%PDF-1.4 invoice A');
  const pdfB = Buffer.from('%PDF-1.4 invoice B');
  const png = Buffer.from('\x89PNG fake');

  it('uploads new files, skips known hashes, retries failed ones and schedules a drafts sync', async () => {
    mockPrisma.expenseUpload.findUnique.mockImplementation((async ({ where }: any) => {
      if (where.fileSha256 === sha256(pdfB)) return { id: 'old-b', status: 'uploaded' };
      if (where.fileSha256 === sha256(png)) return { id: 'old-png', status: 'failed' };
      return null;
    }) as never);
    mockPrisma.expenseUpload.create.mockImplementation((async ({ data }: any) => ({ id: 'new-a', ...data })) as never);
    mockPrisma.expenseUpload.update.mockImplementation((async ({ where, data }: any) => ({ id: where.id, ...data })) as never);

    const res = await request(app).post('/api/company-expenses/upload')
      .attach('files', pdfA, { filename: 'a.pdf', contentType: 'application/pdf' })
      .attach('files', pdfB, { filename: 'b.pdf', contentType: 'application/pdf' })
      .attach('files', png, { filename: 'c.png', contentType: 'application/octet-stream' });

    expect(res.status).toBe(200);
    expect(res.body.results.map((r: any) => [r.fileName, r.status])).toEqual([
      ['a.pdf', 'uploaded'], ['b.pdf', 'duplicate'], ['c.png', 'uploaded'],
    ]);
    expect(res.body.summary).toEqual({ uploaded: 2, duplicate: 1, failed: 0 });
    expect(uploadExpenseFileToMorning).toHaveBeenCalledTimes(2);
    expect(vi.mocked(uploadExpenseFileToMorning).mock.calls[1].slice(1)).toEqual(['c.png', 'image/png']);
    expect(mockPrisma.expenseUpload.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ fileSha256: sha256(pdfA), status: 'uploaded', uploadedBy: 'u1', source: 'manual', mime: 'application/pdf' }),
    });
    expect(mockPrisma.expenseUpload.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'old-png' } }));
    expect(scheduleDraftSyncAfterUpload).toHaveBeenCalledTimes(1);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ entity: 'ExpenseUpload' }));
  });

  it('records Morning failures and does not schedule a sync when nothing uploaded', async () => {
    mockPrisma.expenseUpload.findUnique.mockResolvedValue(null as never);
    mockPrisma.expenseUpload.create.mockImplementation((async ({ data }: any) => ({ id: 'x', ...data })) as never);
    vi.mocked(uploadExpenseFileToMorning).mockRejectedValueOnce(new Error('Morning file upload failed: HTTP 403'));
    const res = await request(app).post('/api/company-expenses/upload')
      .attach('files', pdfA, { filename: 'a.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('403') });
    expect(mockPrisma.expenseUpload.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'failed' }) });
    expect(scheduleDraftSyncAfterUpload).not.toHaveBeenCalled();
  });

  it('tags uploads to a supplier and rejects unknown suppliers', async () => {
    mockPrisma.recurringExpense.findUnique.mockResolvedValueOnce(null as never);
    const bad = await request(app).post('/api/company-expenses/upload')
      .field('recurringExpenseId', 'nope')
      .attach('files', pdfA, { filename: 'a.pdf', contentType: 'application/pdf' });
    expect(bad.status).toBe(400);

    mockPrisma.recurringExpense.findUnique.mockResolvedValueOnce({ id: 'r1' } as never);
    mockPrisma.expenseUpload.findUnique.mockResolvedValue(null as never);
    mockPrisma.expenseUpload.create.mockImplementation((async ({ data }: any) => ({ id: 'x', ...data })) as never);
    const ok = await request(app).post('/api/company-expenses/upload')
      .field('recurringExpenseId', 'r1')
      .attach('files', pdfA, { filename: 'a.pdf', contentType: 'application/pdf' });
    expect(ok.status).toBe(200);
    expect(mockPrisma.expenseUpload.create).toHaveBeenCalledWith({ data: expect.objectContaining({ recurringExpenseId: 'r1' }) });
  });

  it('rejects unsupported types and empty requests', async () => {
    const txt = await request(app).post('/api/company-expenses/upload')
      .attach('files', Buffer.from('hi'), { filename: 'a.txt', contentType: 'text/plain' });
    expect(txt.status).toBe(400);
    expect(txt.body.error).toContain('סוג קובץ לא נתמך');
    expect((await request(app).post('/api/company-expenses/upload')).status).toBe(400);
    expect(uploadExpenseFileToMorning).not.toHaveBeenCalled();
  });
});
