/**
 * Tests for LeadStatus enum fix (03/04/2026)
 * BUG: backend expected old values (purchased/gift/not_relevant)
 *      frontend was sending new values (contacted/converted/closed) → 400 error
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

const mockPrisma = vi.mocked(prisma);
const app = express();
app.use(express.json());
app.use('/api/customers', customersRouter);
app.use(errorHandler);

const CUSTOMER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const baseCustomer = {
  id: CUSTOMER_ID,
  name: 'ישראל ישראלי',
  phone: '0501234567',
  email: null,
  leadStatus: 'new',
  _count: { students: 0 },
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('LeadStatus enum — PUT /api/customers/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.customer.findUnique.mockResolvedValue(baseCustomer as any);
    mockPrisma.customer.findFirst.mockResolvedValue(null);
  });

  const validStatuses = ['new', 'contacted', 'in_progress', 'converted', 'closed'];

  for (const status of validStatuses) {
    it(`מקבל leadStatus="${status}" ומחזיר 200`, async () => {
      mockPrisma.customer.update.mockResolvedValue({ ...baseCustomer, leadStatus: status } as any);

      const res = await request(app)
        .put(`/api/customers/${CUSTOMER_ID}`)
        .send({ leadStatus: status });

      expect(res.status).toBe(200);
      expect(mockPrisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ leadStatus: status }),
        })
      );
    });
  }

  it('דוחה ערך ישן "purchased" עם 400', async () => {
    const res = await request(app)
      .put(`/api/customers/${CUSTOMER_ID}`)
      .send({ leadStatus: 'purchased' });

    expect(res.status).toBe(400);
    expect(mockPrisma.customer.update).not.toHaveBeenCalled();
  });

  it('דוחה ערך ישן "gift" עם 400', async () => {
    const res = await request(app)
      .put(`/api/customers/${CUSTOMER_ID}`)
      .send({ leadStatus: 'gift' });

    expect(res.status).toBe(400);
    expect(mockPrisma.customer.update).not.toHaveBeenCalled();
  });

  it('דוחה ערך ישן "not_relevant" עם 400', async () => {
    const res = await request(app)
      .put(`/api/customers/${CUSTOMER_ID}`)
      .send({ leadStatus: 'not_relevant' });

    expect(res.status).toBe(400);
    expect(mockPrisma.customer.update).not.toHaveBeenCalled();
  });

  it('דוחה ערך לא קיים "homer" עם 400', async () => {
    const res = await request(app)
      .put(`/api/customers/${CUSTOMER_ID}`)
      .send({ leadStatus: 'homer' });

    expect(res.status).toBe(400);
    expect(mockPrisma.customer.update).not.toHaveBeenCalled();
  });

  it('מאפשר עדכון ללא leadStatus (partial update)', async () => {
    mockPrisma.customer.update.mockResolvedValue({ ...baseCustomer, name: 'שם חדש' } as any);

    const res = await request(app)
      .put(`/api/customers/${CUSTOMER_ID}`)
      .send({ name: 'שם חדש' });

    expect(res.status).toBe(200);
  });
});
