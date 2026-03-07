/**
 * Tests for Customer source field
 * BUG fix 07/03/2026: שדה source (מקור הגעה) חסר במודל Customer
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
    $transaction: vi.fn((fn: any) => fn({
      customer: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
    })),
  },
}));

vi.mock('../../middleware/auth.js', () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
  managerOrAdmin: (_req: any, _res: any, next: any) => next(),
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

// Use real errorHandler (handles ZodError → 400, AppError → correct statusCode)
// No mock for errorHandler

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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Customer source field (BUG fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/customers — יצירת לקוח עם source', () => {
    it('שומר source=manual כברירת מחדל כשלא מועבר', async () => {
      const created = {
        id: 'uuid-1',
        name: 'ישראל ישראלי',
        phone: '0501234567',
        email: null,
        source: 'manual',
        _count: { students: 0 },
      };
      mockPrisma.customer.findUnique.mockResolvedValue(null);
      mockPrisma.customer.findFirst.mockResolvedValue(null);
      mockPrisma.customer.create.mockResolvedValue(created);

      const res = await request(app)
        .post('/api/customers')
        .send({ name: 'ישראל ישראלי', phone: '0501234567' });

      expect(res.status).toBe(201);
      const callArgs = mockPrisma.customer.create.mock.calls[0][0];
      expect(callArgs.data.source).toBe('manual');
    });

    it('שומר source שהועבר מפורשות', async () => {
      const created = {
        id: 'uuid-2',
        name: 'שרה כהן',
        phone: '0521234567',
        email: null,
        source: 'whatsapp',
        _count: { students: 0 },
      };
      mockPrisma.customer.findUnique.mockResolvedValue(null);
      mockPrisma.customer.findFirst.mockResolvedValue(null);
      mockPrisma.customer.create.mockResolvedValue(created);

      const res = await request(app)
        .post('/api/customers')
        .send({ name: 'שרה כהן', phone: '0521234567', source: 'whatsapp' });

      expect(res.status).toBe(201);
      const callArgs = mockPrisma.customer.create.mock.calls[0][0];
      expect(callArgs.data.source).toBe('whatsapp');
    });

    it('דוחה source לא חוקי', async () => {
      const res = await request(app)
        .post('/api/customers')
        .send({ name: 'שרה כהן', phone: '0521234567', source: 'telegram' });

      expect(res.status).toBe(400);
      expect(mockPrisma.customer.create).not.toHaveBeenCalled();
    });

    it('מקבל את כל ערכי source החוקיים', async () => {
      const validSources = ['whatsapp', 'facebook', 'instagram', 'website', 'phone', 'upsell', 'manual'];

      for (const source of validSources) {
        vi.clearAllMocks();
        mockPrisma.customer.findUnique.mockResolvedValue(null);
        mockPrisma.customer.findFirst.mockResolvedValue(null);
        mockPrisma.customer.create.mockResolvedValue({
          id: 'uuid-x', name: 'שם', phone: `05${source.length}1234567`, email: null,
          source, _count: { students: 0 },
        });

        const res = await request(app)
          .post('/api/customers')
          .send({ name: 'שם', phone: `05${source.length}1234567`, source });

        expect(res.status, `source="${source}" should return 201`).toBe(201);
      }
    });
  });

  describe('GET /api/customers — source מוחזר ב-response', () => {
    it('מחזיר את שדה source בתוצאות', async () => {
      const customers = [
        { id: 'u1', name: 'א', phone: '050', email: null, source: 'whatsapp', _count: { students: 0 } },
        { id: 'u2', name: 'ב', phone: '052', email: null, source: null,      _count: { students: 0 } },
      ];
      mockPrisma.customer.findMany.mockResolvedValue(customers);
      mockPrisma.customer.count.mockResolvedValue(2);

      const res = await request(app).get('/api/customers');
      expect(res.status).toBe(200);
      const data = res.body.data;
      expect(data[0].source).toBe('whatsapp');
      expect(data[1].source).toBeNull();
    });
  });
});
