import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    instructor: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    $queryRaw: vi.fn(),
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
import { errorHandler } from '../../middleware/errorHandler.js';

const mockPrisma = vi.mocked(prisma);

const app = express();
app.use(express.json());
app.use('/api/instructors', instructorsRouter);
app.use(errorHandler);

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.instructor.findMany.mockResolvedValue([]);
  mockPrisma.instructor.count.mockResolvedValue(0);
  mockPrisma.$queryRaw.mockResolvedValue([]);
});

describe('GET /api/instructors', () => {
  it('includes linked operations_control users in the default instructor list', async () => {
    await request(app).get('/api/instructors');

    const expectedDefaultFilter = {
      OR: [
        { kind: 'instructor' },
        {
          kind: 'operations',
          user: {
            role: 'operations_control',
            isActive: true,
          },
        },
      ],
    };
    expect(mockPrisma.instructor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedDefaultFilter })
    );
    expect(mockPrisma.instructor.count).toHaveBeenCalledWith({ where: expectedDefaultFilter });
  });

  it('keeps explicit kind filters unchanged', async () => {
    await request(app).get('/api/instructors?kind=operations');

    expect(mockPrisma.instructor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { kind: 'operations' } })
    );
    expect(mockPrisma.instructor.count).toHaveBeenCalledWith({ where: { kind: 'operations' } });
  });

  it('combines text search with the default instructor filter', async () => {
    await request(app).get('/api/instructors?search=kim');

    const call = mockPrisma.instructor.findMany.mock.calls[0][0] as any;
    expect(call.where.AND).toHaveLength(2);
    expect(call.where.AND[1]).toEqual({
      OR: [
        { kind: 'instructor' },
        {
          kind: 'operations',
          user: {
            role: 'operations_control',
            isActive: true,
          },
        },
      ],
    });
  });
});
