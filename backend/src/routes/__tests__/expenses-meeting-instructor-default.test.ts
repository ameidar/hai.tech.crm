import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// routes/expenses.ts instantiates its own PrismaClient — mock the client module.
const db = vi.hoisted(() => ({
  meeting: { findUnique: vi.fn(), update: vi.fn() },
  instructor: { findUnique: vi.fn() },
  meetingExpense: { create: vi.fn(), aggregate: vi.fn() },
}));

vi.mock('@prisma/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@prisma/client')>();
  return { ...actual, PrismaClient: function PrismaClient() { return db; } as unknown as typeof actual.PrismaClient };
});

vi.mock('../../middleware/auth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/auth.js')>();
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = { userId: 'u1', role: 'admin' };
      next();
    },
  };
});

vi.mock('../../utils/prisma.js', () => ({ prisma: db }));
vi.mock('../../utils/audit.js', () => ({ logAudit: vi.fn() }));
vi.mock('../../services/negative-profit-alert.js', () => ({ checkAndSendNegativeProfitAlert: vi.fn() }));

import expensesRouter from '../expenses.js';

const app = express();
app.use(express.json());
app.use('/expenses', expensesRouter);

const meetingRow = {
  id: 'm1', instructorId: 'kim',
  startTime: new Date('1970-01-01T16:00:00.000Z'), endTime: new Date('1970-01-01T18:00:00.000Z'),
  cycle: { durationMinutes: 120 },
};

beforeEach(() => {
  vi.clearAllMocks();
  db.meeting.findUnique.mockResolvedValue(meetingRow);
  db.meetingExpense.create.mockImplementation(async ({ data }: any) => ({ id: 'e1', amount: data.amount }));
  db.meetingExpense.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
});

describe('POST /expenses/meeting — instructor default', () => {
  it("stores the meeting's instructor when no instructorId is provided (travel)", async () => {
    const res = await request(app).post('/expenses/meeting').send({ meetingId: 'm1', type: 'travel', amount: 50 });
    expect(res.status).toBe(201);
    const data = db.meetingExpense.create.mock.calls[0][0].data;
    expect(data.instructor).toEqual({ connect: { id: 'kim' } });
  });

  it('treats an empty-string instructorId as not provided', async () => {
    await request(app).post('/expenses/meeting').send({ meetingId: 'm1', type: 'taxi', amount: 30, instructorId: '' });
    expect(db.meetingExpense.create.mock.calls[0][0].data.instructor).toEqual({ connect: { id: 'kim' } });
  });

  it('keeps the explicit extra instructor for extra_instructor expenses', async () => {
    db.instructor.findUnique.mockResolvedValue({ ratePreparation: 50, rateOnline: 60, rateFrontal: 70, employmentType: 'freelancer' });
    const res = await request(app).post('/expenses/meeting')
      .send({ meetingId: 'm1', type: 'extra_instructor', instructorId: 'dana', rateType: 'frontal' });
    expect(res.status).toBe(201);
    const data = db.meetingExpense.create.mock.calls[0][0].data;
    expect(data.instructor).toEqual({ connect: { id: 'dana' } });
    expect(data.amount).toBe(140); // 2h × 70
  });

  it('returns 404 when the meeting does not exist', async () => {
    db.meeting.findUnique.mockResolvedValue(null);
    const res = await request(app).post('/expenses/meeting').send({ meetingId: 'nope', type: 'travel', amount: 50 });
    expect(res.status).toBe(404);
    expect(db.meetingExpense.create).not.toHaveBeenCalled();
  });
});
