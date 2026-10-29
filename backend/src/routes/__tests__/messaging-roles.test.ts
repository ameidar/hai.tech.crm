import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

let role = 'operations_manager';

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 't1', name: 'תזכורת' }]),
  },
}));

vi.mock('../../middleware/auth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/auth.js')>();
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = { userId: 'u1', role };
      next();
    },
  };
});

import { messagingRouter } from '../messaging.js';
import { errorHandler } from '../../middleware/errorHandler.js';

const app = express();
app.use(express.json());
app.use('/api/messaging', messagingRouter);
app.use(errorHandler);

describe('messaging access by role', () => {
  it('lets operations managers load message templates', async () => {
    role = 'operations_manager';
    const res = await request(app).get('/api/messaging/templates');
    expect(res.status).toBe(200);
  });

  it('still blocks instructors', async () => {
    role = 'instructor';
    const res = await request(app).get('/api/messaging/templates');
    expect(res.status).toBe(403);
  });
});
