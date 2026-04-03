/**
 * Tests for customers lastPayment sort fix (03/04/2026)
 * BUG: sort by lastPayment was applied client-side after pagination
 *      Fix: ORDER BY moved to SQL before pagination
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    customer: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $queryRawUnsafe: vi.fn(),
    $transaction: vi.fn(),
  },
}));

vi.mock('../../middleware/auth.js', () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
  managerOrAdmin: (_req: any, _res: any, next: any) => next(),
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../utils/auditLog.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../../services/notifications.js', () => ({
  sendWelcomeNotifications: vi.fn(),
  notifyAdminNewLead: vi.fn(),
}));

import { customersRouter } from '../customers.js';
import { prisma } from '../../utils/prisma.js';
import { errorHandler } from '../../middleware/errorHandler.js';

const mockPrismaRaw = vi.mocked(prisma);

const mockPrisma = vi.mocked(prisma);
const app = express();
app.use(express.json());
app.use('/api/customers', customersRouter);
app.use(errorHandler);

// Helper: build mock customer with lastPayment
const makeCustomer = (id: string, lastPayment: string | null) => ({
  id,
  name: `לקוח ${id}`,
  phone: `050000000${id}`,
  email: null,
  leadStatus: 'new',
  lastPayment,
  _count: { students: 0 },
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('GET /api/customers — מיון לפי lastPayment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.customer.count.mockResolvedValue(3);
  });

  it('מחזיר לקוחות ממוינים לפי תשלום אחרון — יורד (החדש ביותר קודם)', async () => {
    // $queryRawUnsafe called twice: once for sorted IDs, once for count
    const rawSortedIds = [
      { id: '1', latest_payment: '2026-03-20' },
      { id: '2', latest_payment: '2026-02-15' },
    ];
    const rawCount = [{ count: 2 }];

    mockPrismaRaw.$queryRawUnsafe
      .mockResolvedValueOnce(rawSortedIds)  // sorted IDs query
      .mockResolvedValueOnce(rawCount);      // count query

    // findMany returns customers in same order as IDs
    mockPrisma.customer.findMany.mockResolvedValue([
      makeCustomer('1', '2026-03-20'),
      makeCustomer('2', '2026-02-15'),
    ] as any);

    const res = await request(app)
      .get('/api/customers')
      .query({ sortBy: 'lastPayment', sortOrder: 'desc' });

    expect(res.status).toBe(200);
    // Verify $queryRawUnsafe was called (ORDER BY in SQL)
    expect(mockPrismaRaw.$queryRawUnsafe).toHaveBeenCalled();
    const sqlCall = mockPrismaRaw.$queryRawUnsafe.mock.calls[0][0] as string;
    expect(sqlCall).toContain('ORDER BY latest_payment');
    expect(sqlCall).toContain('DESC');
  });

  it('מחזיר לקוחות ממוינים לפי תשלום אחרון — עולה (הישן ביותר קודם)', async () => {
    const rawSortedIds = [
      { id: '2', latest_payment: '2026-02-15' },
      { id: '1', latest_payment: '2026-03-20' },
    ];
    const rawCount = [{ count: 2 }];

    mockPrismaRaw.$queryRawUnsafe
      .mockResolvedValueOnce(rawSortedIds)
      .mockResolvedValueOnce(rawCount);

    mockPrisma.customer.findMany.mockResolvedValue([
      makeCustomer('2', '2026-02-15'),
      makeCustomer('1', '2026-03-20'),
    ] as any);

    const res = await request(app)
      .get('/api/customers')
      .query({ sortBy: 'lastPayment', sortOrder: 'asc' });

    expect(res.status).toBe(200);
    // Verify $queryRawUnsafe was called with ORDER BY
    expect(mockPrismaRaw.$queryRawUnsafe).toHaveBeenCalled();
  });

  it('מחזיר 200 גם ללא פרמטרי מיון (משתמש ב-findMany רגיל)', async () => {
    mockPrisma.customer.findMany.mockResolvedValue([makeCustomer('1', null)] as any);
    mockPrisma.customer.count.mockResolvedValue(1);

    const res = await request(app).get('/api/customers');
    expect(res.status).toBe(200);
    // Without sortBy=lastPayment, should NOT call $queryRawUnsafe
    expect(mockPrismaRaw.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});
