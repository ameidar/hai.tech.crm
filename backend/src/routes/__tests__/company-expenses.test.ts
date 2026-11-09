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
  },
}));

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
