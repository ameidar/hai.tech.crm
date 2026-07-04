import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../../utils/prisma.js', () => ({
  prisma: {
    leadAppointment: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    leadActivity: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../middleware/auth.js', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    const scopes = String(req.headers['x-test-scopes'] || 'read:leads,write:leads')
      .split(',')
      .map((scope) => scope.trim())
      .filter(Boolean);

    req.apiKey = {
      id: 'api-key-1',
      name: 'Ormi',
      scopes,
      createdBy: {
        id: 'api-user-1',
        email: 'ormi@example.com',
        name: 'Ormi API',
        role: 'sales',
      },
    };
    req.user = {
      userId: 'api-user-1',
      email: 'ormi@example.com',
      name: 'Ormi API',
      role: 'sales',
    };
    next();
  },
}));

import { leadsRouter } from './leads.js';
import { prisma } from '../../../utils/prisma.js';

const mockPrisma = vi.mocked(prisma);
const app = express();

app.use(express.json());
app.use('/api/v1/leads', leadsRouter);
app.use((err: any, _req: any, res: any, _next: any) => {
  res.status(err.statusCode || 500).json({
    error: {
      code: err.code || 'ERROR',
      message: err.message,
    },
  });
});

const leadId = '11111111-1111-4111-8111-111111111111';
const assignedToId = '22222222-2222-4222-8222-222222222222';

describe('API v1 leads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mockPrisma.$transaction as any).mockImplementation(async (cb: any) => cb(mockPrisma));
  });

  it('lists leads for API-key clients with sales filters', async () => {
    const items = [{ id: leadId, salesStatus: 'follow_up' }];
    mockPrisma.leadAppointment.findMany.mockResolvedValue(items);
    mockPrisma.leadAppointment.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/v1/leads?salesStatus=follow_up&assignedToId=unassigned&limit=10&offset=20')
      .set('x-test-scopes', 'read:leads');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: items, meta: { total: 1, limit: 10, offset: 20 } });
    expect(mockPrisma.leadAppointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          salesStatus: 'follow_up',
          assignedToId: null,
        },
        orderBy: [{ nextFollowUpAt: 'asc' }, { updatedAt: 'desc' }],
        skip: 20,
        take: 10,
        include: expect.any(Object),
      })
    );
  });

  it('returns due follow-ups and excludes closed sales states', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-04T12:00:00Z'));
    mockPrisma.leadAppointment.findMany.mockResolvedValue([]);
    mockPrisma.leadAppointment.count.mockResolvedValue(0);

    await request(app)
      .get('/api/v1/leads?followUp=due')
      .set('x-test-scopes', 'read:leads');

    expect(mockPrisma.leadAppointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          nextFollowUpAt: { lte: new Date('2026-07-04T12:00:00Z') },
          salesStatus: { notIn: ['converted', 'not_relevant'] },
        },
      })
    );
    vi.useRealTimers();
  });

  it('denies lead reads without read:leads scope', async () => {
    const res = await request(app)
      .get('/api/v1/leads')
      .set('x-test-scopes', 'write:leads');

    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('read:leads');
    expect(mockPrisma.leadAppointment.findMany).not.toHaveBeenCalled();
  });

  it('updates only sales workflow fields and records activity', async () => {
    const updated = { id: leadId, salesStatus: 'interested', assignedToId };
    mockPrisma.leadAppointment.update.mockResolvedValue(updated);
    mockPrisma.leadActivity.create.mockResolvedValue({ id: 'activity-1' });

    const res = await request(app)
      .patch(`/api/v1/leads/${leadId}`)
      .set('x-test-scopes', 'write:leads')
      .send({
        salesStatus: 'interested',
        assignedToId,
        nextFollowUpAt: '2026-07-06T08:00:00.000Z',
        lastContactResult: 'answered',
        activityType: 'call',
        activityNote: 'שיחה טובה, לשלוח פרטים',
      });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(updated);
    expect(mockPrisma.leadAppointment.update).toHaveBeenCalledWith({
      where: { id: leadId },
      data: expect.objectContaining({
        salesStatus: 'interested',
        assignedToId,
        nextFollowUpAt: new Date('2026-07-06T08:00:00.000Z'),
        lastContactResult: 'answered',
      }),
      include: expect.any(Object),
    });
    expect(mockPrisma.leadActivity.create).toHaveBeenCalledWith({
      data: {
        leadAppointmentId: leadId,
        userId: 'api-user-1',
        type: 'call',
        result: 'answered',
        note: 'שיחה טובה, לשלוח פרטים',
        nextFollowUpAt: new Date('2026-07-06T08:00:00.000Z'),
      },
    });
  });

  it('rejects attempts to update immutable lead identity fields', async () => {
    const res = await request(app)
      .patch(`/api/v1/leads/${leadId}`)
      .set('x-test-scopes', 'write:leads')
      .send({
        customerName: 'שם חדש',
        customerPhone: '0509999999',
        source: 'manual-change',
      });

    expect(res.status).toBe(400);
    expect(mockPrisma.leadAppointment.update).not.toHaveBeenCalled();
  });

  it('adds an activity and rolls up last contact details', async () => {
    const activity = { id: 'activity-1', type: 'whatsapp', result: 'sent' };
    mockPrisma.leadActivity.create.mockResolvedValue(activity);
    mockPrisma.leadAppointment.update.mockResolvedValue({ id: leadId });

    const res = await request(app)
      .post(`/api/v1/leads/${leadId}/activities`)
      .set('x-test-scopes', 'write:leads')
      .send({
        type: 'whatsapp',
        result: 'sent',
        note: 'נשלחה הודעת המשך',
        salesStatus: 'follow_up',
        nextFollowUpAt: '2026-07-07T10:00:00.000Z',
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual(activity);
    expect(mockPrisma.leadActivity.create).toHaveBeenCalledWith({
      data: {
        leadAppointmentId: leadId,
        userId: 'api-user-1',
        type: 'whatsapp',
        result: 'sent',
        note: 'נשלחה הודעת המשך',
        nextFollowUpAt: new Date('2026-07-07T10:00:00.000Z'),
      },
      include: expect.any(Object),
    });
    expect(mockPrisma.leadAppointment.update).toHaveBeenCalledWith({
      where: { id: leadId },
      data: expect.objectContaining({
        salesStatus: 'follow_up',
        lastContactResult: 'sent',
        nextFollowUpAt: new Date('2026-07-07T10:00:00.000Z'),
      }),
    });
  });
});
