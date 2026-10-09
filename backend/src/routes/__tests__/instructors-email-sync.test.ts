import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    instructor: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
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

const mockPrisma = vi.mocked(prisma) as any;

const app = express();
app.use(express.json());
app.use('/api/instructors', instructorsRouter);
app.use(errorHandler);

const INSTRUCTOR_ID = 'f58fa87e-be20-43f6-a738-11be8dc034c2';
const USER_ID = '341351e5-c686-46d9-84a4-746dd266e819';

const existing = {
  id: INSTRUCTOR_ID,
  name: 'ליאן',
  email: 'lian.temp@hai.tech',
  userId: USER_ID,
  rateFrontal: 100,
  rateOnline: 100,
  ratePrivate: 100,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.instructor.findUnique.mockResolvedValue(existing);
  mockPrisma.instructor.update.mockImplementation(({ data }: any) => ({ ...existing, ...data }));
  mockPrisma.user.update.mockImplementation(({ data }: any) => ({ id: USER_ID, ...data }));
  mockPrisma.user.findUnique.mockResolvedValue(null);
  mockPrisma.$transaction.mockImplementation((ops: any[]) => Promise.all(ops));
});

describe('PUT /api/instructors/:id email sync', () => {
  it('updates the linked login user email together with the instructor', async () => {
    const res = await request(app)
      .put(`/api/instructors/${INSTRUCTOR_ID}`)
      .send({ email: 'IamLian7575@gmail.com' });

    expect(res.status).toBe(200);
    expect(res.body.email).toBe('iamlian7575@gmail.com');
    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { email: 'iamlian7575@gmail.com' },
    });
  });

  it('rejects an email that belongs to another user', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'someone-else' });

    const res = await request(app)
      .put(`/api/instructors/${INSTRUCTOR_ID}`)
      .send({ email: 'taken@example.com' });

    expect(res.status).toBe(409);
    expect(mockPrisma.instructor.update).not.toHaveBeenCalled();
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('does not touch the user when the instructor has no login account', async () => {
    mockPrisma.instructor.findUnique.mockResolvedValue({ ...existing, userId: null });

    const res = await request(app)
      .put(`/api/instructors/${INSTRUCTOR_ID}`)
      .send({ email: 'new@example.com' });

    expect(res.status).toBe(200);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('does not touch the user when the email is cleared or unchanged', async () => {
    await request(app).put(`/api/instructors/${INSTRUCTOR_ID}`).send({ email: '' });
    await request(app).put(`/api/instructors/${INSTRUCTOR_ID}`).send({ email: 'lian.temp@hai.tech' });
    await request(app).put(`/api/instructors/${INSTRUCTOR_ID}`).send({ name: 'ליאן הרשקוביץ' });

    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});
