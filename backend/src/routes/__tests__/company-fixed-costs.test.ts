import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    companyFixedCost: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../../middleware/auth.js', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { userId: 'admin-id', role: 'admin' };
    next();
  },
  managerOrAdmin: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../utils/audit.js', () => ({ logAudit: vi.fn() }));

import { companyFixedCostsRouter } from '../company-fixed-costs.js';
import { prisma } from '../../utils/prisma.js';
import { errorHandler } from '../../middleware/errorHandler.js';

const mockPrisma = vi.mocked(prisma, true);
const app = express();
app.use(express.json());
app.use('/api/company-fixed-costs', companyFixedCostsRouter);
app.use(errorHandler);

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'fc-1', name: 'הילה - משכורת', category: 'staff', amount: { toString: () => '13000.00' },
  startMonth: day('2026-09-01'), endMonth: null, notes: null,
  createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
  ...overrides,
});

beforeEach(() => vi.clearAllMocks());

describe('company fixed costs', () => {
  it('lists active costs with YYYY-MM months and numeric amounts', async () => {
    mockPrisma.companyFixedCost.findMany.mockResolvedValue([row()] as never);
    const res = await request(app).get('/api/company-fixed-costs');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 'fc-1', name: 'הילה - משכורת', category: 'staff', amount: 13000, startMonth: '2026-09', endMonth: null, monthOverrides: null, notes: null },
    ]);
  });

  it('creates a cost stored at the first day of the start month', async () => {
    mockPrisma.companyFixedCost.create.mockResolvedValue(row() as never);
    const res = await request(app).post('/api/company-fixed-costs')
      .send({ name: 'הילה - משכורת', amount: 13000, startMonth: '2026-09' });
    expect(res.status).toBe(201);
    expect(mockPrisma.companyFixedCost.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ amount: 13000, startMonth: day('2026-09-01'), endMonth: null, category: 'staff' }),
    });
  });

  it.each([
    { name: '', amount: 100, startMonth: '2026-09' },
    { name: 'x', amount: 0, startMonth: '2026-09' },
    { name: 'x', amount: 100, startMonth: '2026-9' },
    { name: 'x', amount: 100, startMonth: '2026-09', endMonth: '2026-08' },
  ])('rejects invalid input %o', async (body) => {
    const res = await request(app).post('/api/company-fixed-costs').send(body);
    expect(res.status).toBe(400);
    expect(mockPrisma.companyFixedCost.create).not.toHaveBeenCalled();
  });

  it('soft-deletes', async () => {
    mockPrisma.companyFixedCost.findFirst.mockResolvedValue(row() as never);
    mockPrisma.companyFixedCost.update.mockResolvedValue(row() as never);
    const res = await request(app).delete('/api/company-fixed-costs/fc-1');
    expect(res.status).toBe(204);
    expect(mockPrisma.companyFixedCost.update).toHaveBeenCalledWith({
      where: { id: 'fc-1' }, data: { deletedAt: expect.any(Date) },
    });
  });
});

import { companyFixedCostForMonth } from '../../services/company-fixed-costs.js';

describe('companyFixedCostForMonth', () => {
  const cost = {
    name: 'הילה', amount: 13000, startMonth: day('2026-01-01'), endMonth: day('2026-12-01'),
    monthOverrides: { '2026-03': 8000, '2026-04': 0 },
  };
  it.each([
    ['2025-12', 0],
    ['2026-01', 13000],
    ['2026-03', 8000],
    ['2026-04', 0],
    ['2026-12', 13000],
    ['2027-01', 0],
  ])('%s → %d', (month, expected) => {
    expect(companyFixedCostForMonth(cost, month)).toBe(expected);
  });
});
