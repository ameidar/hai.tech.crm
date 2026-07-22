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
    payment: {
      findMany: vi.fn(),
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

  it('can include paid payment summary for lead journal items', async () => {
    const items = [{
      id: leadId,
      customerId: 'customer-1',
      customerName: 'נועה כהן',
      customerPhone: '0501234567',
      customerEmail: 'noa@example.com',
    }];
    const payment = {
      id: 'payment-1',
      customerId: 'customer-1',
      customerName: 'נועה כהן',
      customerEmail: 'noa@example.com',
      customerPhone: '0501234567',
      description: 'Roblox',
      amount: 400,
      currency: 'ILS',
      status: 'paid',
      paidAt: new Date('2026-07-04T09:00:00.000Z'),
      invoiceUrl: 'https://invoice.example/1',
      invoiceNumber: 'INV-1',
      paymentMethod: 'creditcard',
    };
    mockPrisma.leadAppointment.findMany.mockResolvedValue(items);
    mockPrisma.leadAppointment.count.mockResolvedValue(1);
    mockPrisma.payment.findMany.mockResolvedValue([payment]);

    const res = await request(app)
      .get('/api/v1/leads?includePayments=true')
      .set('x-test-scopes', 'read:leads,read:payments');

    expect(res.status).toBe(200);
    expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        status: 'paid',
        OR: [
          { customerId: { in: ['customer-1'] } },
          { customerPhone: { in: ['0501234567'] } },
          { customerEmail: { in: ['noa@example.com'] } },
        ],
      },
    }));
    expect(res.body.data[0].paymentSummary).toEqual(expect.objectContaining({
      hasPaid: true,
      paidCount: 1,
      totalPaid: 400,
      latestPayment: expect.objectContaining({ id: 'payment-1', amount: 400 }),
    }));
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

  it('denies payment summary without read:payments scope', async () => {
    mockPrisma.leadAppointment.findMany.mockResolvedValue([]);
    mockPrisma.leadAppointment.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/v1/leads?includePayments=true')
      .set('x-test-scopes', 'read:leads');

    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('read:payments');
    expect(mockPrisma.payment.findMany).not.toHaveBeenCalled();
  });

  it('returns a single lead with payment summary matched by phone when no customerId exists', async () => {
    const item = {
      id: leadId,
      customerId: null,
      customerName: 'ליד ללא לקוח',
      customerPhone: '0507654321',
      customerEmail: null,
    };
    const payment = {
      id: 'payment-2',
      customerId: null,
      customerName: 'ליד ללא לקוח',
      customerEmail: null,
      customerPhone: '0507654321',
      description: 'Python',
      amount: 250,
      currency: 'ILS',
      status: 'paid',
      paidAt: new Date('2026-07-03T08:00:00.000Z'),
      invoiceUrl: null,
      invoiceNumber: null,
      paymentMethod: 'bit',
    };
    mockPrisma.leadAppointment.findUnique.mockResolvedValue(item);
    mockPrisma.payment.findMany.mockResolvedValue([payment]);

    const res = await request(app)
      .get(`/api/v1/leads/${leadId}?includePayments=true`)
      .set('x-test-scopes', 'read:leads,read:payments');

    expect(res.status).toBe(200);
    expect(res.body.data.paymentSummary).toEqual(expect.objectContaining({
      hasPaid: true,
      paidCount: 1,
      totalPaid: 250,
      latestPayment: expect.objectContaining({ id: 'payment-2' }),
    }));
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
