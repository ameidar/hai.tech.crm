import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock prisma
vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    leadAppointment: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    leadActivity: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

// Mock authenticate as passthrough
vi.mock('../../middleware/auth.js', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1', id: 'user-1', role: 'sales' };
    next();
  },
  salesOrAbove: (_req: any, _res: any, next: any) => next(),
  managerOrAdmin: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../utils/lead-customer.js', () => ({
  findOrCreateCustomer: vi.fn(),
}));

vi.mock('../../services/lead-welcome.js', () => ({
  sendLeadWelcomeTemplate: vi.fn(),
}));

// Mock AppError
vi.mock('../../middleware/errorHandler.js', () => ({
  AppError: class AppError extends Error {
    statusCode: number;
    constructor(statusCode: number, message: string) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

import { leadAppointmentsRouter } from '../lead-appointments.js';
import { prisma } from '../../utils/prisma.js';
import { findOrCreateCustomer } from '../../utils/lead-customer.js';
import { sendLeadWelcomeTemplate } from '../../services/lead-welcome.js';

const mockPrisma = vi.mocked(prisma);
const mockFindOrCreateCustomer = vi.mocked(findOrCreateCustomer);
const mockSendLeadWelcomeTemplate = vi.mocked(sendLeadWelcomeTemplate);
const app = express();
app.use(express.json());
app.use('/api/lead-appointments', leadAppointmentsRouter);
// Error handler
app.use((err: any, _req: any, res: any, _next: any) => {
  res.status(err.statusCode || 500).json({ error: err.message });
});

describe('Lead Appointments API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mockPrisma.$transaction as any).mockImplementation(async (cb: any) => cb(mockPrisma));
    mockFindOrCreateCustomer.mockResolvedValue({ customerId: 'customer-1', isNew: false } as any);
    mockSendLeadWelcomeTemplate.mockResolvedValue(undefined);
  });

  describe('GET /api/lead-appointments', () => {
    it('returns paginated list', async () => {
      const items = [{ id: '1', appointmentStatus: 'scheduled' }];
      mockPrisma.leadAppointment.findMany.mockResolvedValue(items);
      mockPrisma.leadAppointment.count.mockResolvedValue(1);

      const res = await request(app).get('/api/lead-appointments');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(items);
      expect(res.body.pagination.total).toBe(1);
    });

    it('supports status filter', async () => {
      mockPrisma.leadAppointment.findMany.mockResolvedValue([]);
      mockPrisma.leadAppointment.count.mockResolvedValue(0);

      await request(app).get('/api/lead-appointments?status=scheduled');
      expect(mockPrisma.leadAppointment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ appointmentStatus: 'scheduled' }),
        })
      );
    });

    it('supports from/to as aliases for dateFrom/dateTo', async () => {
      mockPrisma.leadAppointment.findMany.mockResolvedValue([]);
      mockPrisma.leadAppointment.count.mockResolvedValue(0);

      await request(app).get('/api/lead-appointments?from=2026-01-01&to=2026-01-31');
      expect(mockPrisma.leadAppointment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: {
              gte: new Date('2026-01-01'),
              lte: new Date('2026-01-31T23:59:59Z'),
            },
          }),
        })
      );
    });

    it('supports dateFrom/dateTo params', async () => {
      mockPrisma.leadAppointment.findMany.mockResolvedValue([]);
      mockPrisma.leadAppointment.count.mockResolvedValue(0);

      await request(app).get('/api/lead-appointments?dateFrom=2026-02-01&dateTo=2026-02-28');
      expect(mockPrisma.leadAppointment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: {
              gte: new Date('2026-02-01'),
              lte: new Date('2026-02-28T23:59:59Z'),
            },
          }),
        })
      );
    });

    it('respects page and limit', async () => {
      mockPrisma.leadAppointment.findMany.mockResolvedValue([]);
      mockPrisma.leadAppointment.count.mockResolvedValue(50);

      const res = await request(app).get('/api/lead-appointments?page=3&limit=10');
      expect(mockPrisma.leadAppointment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 })
      );
      expect(res.body.pagination.totalPages).toBe(5);
    });

    it('supports sales workflow filters and due follow-up sorting', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-04T12:00:00Z'));
      mockPrisma.leadAppointment.findMany.mockResolvedValue([]);
      mockPrisma.leadAppointment.count.mockResolvedValue(0);

      await request(app).get('/api/lead-appointments?salesStatus=follow_up&assignedToId=unassigned&followUp=due&sortBy=nextFollowUpAt');

      expect(mockPrisma.leadAppointment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            assignedToId: null,
            nextFollowUpAt: { lte: new Date('2026-07-04T12:00:00Z') },
            salesStatus: { notIn: ['converted', 'not_relevant'] },
          }),
          orderBy: [{ nextFollowUpAt: 'asc' }, { updatedAt: 'desc' }],
        })
      );
      vi.useRealTimers();
    });
  });

  describe('POST /api/lead-appointments', () => {
    it('creates a manual lead with sales workflow fields', async () => {
      const created = {
        id: 'lead-1',
        customerName: 'נועה כהן',
        salesStatus: 'interested',
        assignedToId: 'sales-1',
      };
      mockPrisma.leadAppointment.create.mockResolvedValue(created);

      const res = await request(app)
        .post('/api/lead-appointments')
        .send({
          customerName: 'נועה כהן',
          customerPhone: '0501234567',
          customerEmail: 'noa@example.com',
          childName: 'אורי',
          interest: 'Roblox',
          salesStatus: 'interested',
          assignedToId: 'sales-1',
          nextFollowUpAt: '2026-07-05T09:30:00.000Z',
          appointmentStatus: 'scheduled',
          sendWelcome: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toEqual(created);
      expect(mockFindOrCreateCustomer).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'נועה כהן',
          phone: '0501234567',
          email: 'noa@example.com',
          source: 'manual',
          childName: 'אורי',
        })
      );
      expect(mockPrisma.leadAppointment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          customerId: 'customer-1',
          customerName: 'נועה כהן',
          customerPhone: '0501234567',
          salesStatus: 'interested',
          assignedToId: 'sales-1',
          nextFollowUpAt: new Date('2026-07-05T09:30:00.000Z'),
        }),
        include: expect.any(Object),
      });
      expect(mockSendLeadWelcomeTemplate).toHaveBeenCalledWith('0501234567', 'נועה כהן');
    });

    it('requires at least one customer identifier', async () => {
      const res = await request(app)
        .post('/api/lead-appointments')
        .send({ interest: 'Python' });

      expect(res.status).toBe(400);
      expect(mockPrisma.leadAppointment.create).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/lead-appointments/:id', () => {
    it('returns item by id', async () => {
      const item = { id: 'abc', appointmentStatus: 'scheduled' };
      mockPrisma.leadAppointment.findUnique.mockResolvedValue(item);

      const res = await request(app).get('/api/lead-appointments/abc');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(item);
    });

    it('returns 404 when not found', async () => {
      mockPrisma.leadAppointment.findUnique.mockResolvedValue(null);

      const res = await request(app).get('/api/lead-appointments/missing');
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/lead-appointments/:id', () => {
    it('updates appointment fields', async () => {
      const updated = { id: 'abc', appointmentStatus: 'completed' };
      mockPrisma.leadAppointment.update.mockResolvedValue(updated);

      const res = await request(app)
        .patch('/api/lead-appointments/abc')
        .send({ appointmentStatus: 'completed' });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(updated);
      expect(mockPrisma.leadAppointment.update).toHaveBeenCalledWith({
        where: { id: 'abc' },
        data: { appointmentStatus: 'completed' },
        include: expect.any(Object),
      });
    });

    it('records activity when contact result is provided', async () => {
      const updated = { id: 'abc', appointmentStatus: 'pending', salesStatus: 'follow_up' };
      mockPrisma.leadAppointment.update.mockResolvedValue(updated);
      mockPrisma.leadActivity.create.mockResolvedValue({ id: 'activity-1' });

      const res = await request(app)
        .patch('/api/lead-appointments/abc')
        .send({
          salesStatus: 'follow_up',
          lastContactResult: 'no_answer',
          activityNote: 'אין מענה, לנסות שוב מחר',
        });

      expect(res.status).toBe(200);
      expect(mockPrisma.leadActivity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          leadAppointmentId: 'abc',
          type: 'note',
          result: 'no_answer',
          note: 'אין מענה, לנסות שוב מחר',
        }),
      });
    });
  });

  describe('POST /api/lead-appointments/:id/activities', () => {
    it('adds activity and updates lead sales state', async () => {
      const activity = { id: 'activity-1', type: 'call', result: 'answered' };
      mockPrisma.leadActivity.create.mockResolvedValue(activity);
      mockPrisma.leadAppointment.update.mockResolvedValue({ id: 'abc' });

      const res = await request(app)
        .post('/api/lead-appointments/abc/activities')
        .send({
          type: 'call',
          result: 'answered',
          note: 'דיברנו, רוצה פרטים',
          salesStatus: 'interested',
          nextFollowUpAt: '2026-07-06T08:00:00.000Z',
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toEqual(activity);
      expect(mockPrisma.leadActivity.create).toHaveBeenCalledWith({
        data: {
          leadAppointmentId: 'abc',
          userId: 'user-1',
          type: 'call',
          result: 'answered',
          note: 'דיברנו, רוצה פרטים',
          nextFollowUpAt: new Date('2026-07-06T08:00:00.000Z'),
        },
        include: expect.any(Object),
      });
      expect(mockPrisma.leadAppointment.update).toHaveBeenCalledWith({
        where: { id: 'abc' },
        data: expect.objectContaining({
          salesStatus: 'interested',
          lastContactResult: 'answered',
          nextFollowUpAt: new Date('2026-07-06T08:00:00.000Z'),
        }),
      });
    });
  });

  describe('DELETE /api/lead-appointments/:id', () => {
    it('deletes appointment', async () => {
      mockPrisma.leadAppointment.delete.mockResolvedValue({ id: 'abc' });

      const res = await request(app).delete('/api/lead-appointments/abc');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockPrisma.leadAppointment.delete).toHaveBeenCalledWith({
        where: { id: 'abc' },
      });
    });

    it('returns error when delete fails', async () => {
      mockPrisma.leadAppointment.delete.mockRejectedValue(
        Object.assign(new Error('Record not found'), { statusCode: 404 })
      );

      const res = await request(app).delete('/api/lead-appointments/missing');
      expect(res.status).toBe(404);
    });
  });
});
