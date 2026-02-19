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
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

// Mock authenticate as passthrough
vi.mock('../../middleware/auth.js', () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
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

const mockPrisma = vi.mocked(prisma);
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
