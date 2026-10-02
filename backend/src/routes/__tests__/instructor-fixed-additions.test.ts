import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    instructor: { findUnique: vi.fn() },
    instructorFixedAddition: {
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
  operationsManagerOrAdmin: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../utils/audit.js', () => ({
  logAudit: vi.fn(),
  logUpdateAudit: vi.fn(),
}));

import { instructorsRouter } from '../instructors.js';
import { prisma } from '../../utils/prisma.js';
import { logAudit } from '../../utils/audit.js';
import { errorHandler } from '../../middleware/errorHandler.js';

const mockPrisma = vi.mocked(prisma, true);

const app = express();
app.use(express.json());
app.use('/api/instructors', instructorsRouter);
app.use(errorHandler);

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'add-1', instructorId: 'kim', description: 'ריכוז', amount: { toString: () => '2500.00' }, isNet: true,
  startMonth: day('2026-09-01'), endMonth: null, notes: null, createdById: 'admin-id',
  createdAt: new Date(), updatedAt: new Date(), deletedAt: null, deletedBy: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.instructor.findUnique.mockResolvedValue({ id: 'kim' } as never);
});

describe('POST /api/instructors/:id/fixed-additions', () => {
  it('creates an addition with months stored as the first of the month', async () => {
    mockPrisma.instructorFixedAddition.create.mockResolvedValue(row() as never);

    const res = await request(app).post('/api/instructors/kim/fixed-additions')
      .send({ description: 'ריכוז', amount: 2500, isNet: true, startMonth: '2026-09' });

    expect(res.status).toBe(201);
    expect(mockPrisma.instructorFixedAddition.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        instructorId: 'kim', description: 'ריכוז', amount: 2500, isNet: true,
        startMonth: day('2026-09-01'), endMonth: null, createdById: 'admin-id',
      }),
    });
    expect(res.body).toMatchObject({ amount: 2500, startMonth: '2026-09', endMonth: null, isNet: true });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE', entity: 'InstructorFixedAddition' }));
  });

  it('rejects malformed months, non-positive amounts and end < start', async () => {
    const bad = [
      { description: 'ריכוז', amount: 2500, startMonth: '2026-9' },
      { description: 'ריכוז', amount: 0, startMonth: '2026-09' },
      { description: '', amount: 100, startMonth: '2026-09' },
      { description: 'ריכוז', amount: 2500, startMonth: '2026-09', endMonth: '2026-08' },
    ];
    for (const body of bad) {
      const res = await request(app).post('/api/instructors/kim/fixed-additions').send(body);
      expect(res.status).toBe(400);
    }
    expect(mockPrisma.instructorFixedAddition.create).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown instructor', async () => {
    mockPrisma.instructor.findUnique.mockResolvedValue(null as never);
    const res = await request(app).post('/api/instructors/nope/fixed-additions')
      .send({ description: 'ריכוז', amount: 2500, startMonth: '2026-09' });
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/instructors/:id/fixed-additions/:additionId', () => {
  it('ends an addition by setting endMonth', async () => {
    mockPrisma.instructorFixedAddition.findFirst.mockResolvedValue(row() as never);
    mockPrisma.instructorFixedAddition.update.mockResolvedValue(row({ endMonth: day('2026-12-01') }) as never);

    const res = await request(app).put('/api/instructors/kim/fixed-additions/add-1').send({ endMonth: '2026-12' });

    expect(res.status).toBe(200);
    expect(mockPrisma.instructorFixedAddition.update).toHaveBeenCalledWith({
      where: { id: 'add-1' },
      data: { endMonth: day('2026-12-01') },
    });
    expect(res.body.endMonth).toBe('2026-12');
  });

  it('rejects an endMonth before the stored startMonth', async () => {
    mockPrisma.instructorFixedAddition.findFirst.mockResolvedValue(row() as never);
    const res = await request(app).put('/api/instructors/kim/fixed-additions/add-1').send({ endMonth: '2026-08' });
    expect(res.status).toBe(400);
    expect(mockPrisma.instructorFixedAddition.update).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/instructors/:id/fixed-additions/:additionId', () => {
  it('soft-deletes the addition', async () => {
    mockPrisma.instructorFixedAddition.findFirst.mockResolvedValue(row() as never);
    mockPrisma.instructorFixedAddition.update.mockResolvedValue(row() as never);

    const res = await request(app).delete('/api/instructors/kim/fixed-additions/add-1');

    expect(res.status).toBe(204);
    expect(mockPrisma.instructorFixedAddition.update).toHaveBeenCalledWith({
      where: { id: 'add-1' },
      data: { deletedAt: expect.any(Date), deletedBy: 'admin-id' },
    });
  });

  it('returns 404 for an addition of another instructor / already deleted', async () => {
    mockPrisma.instructorFixedAddition.findFirst.mockResolvedValue(null as never);
    const res = await request(app).delete('/api/instructors/kim/fixed-additions/add-1');
    expect(res.status).toBe(404);
  });
});
