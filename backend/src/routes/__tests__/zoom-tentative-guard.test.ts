import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// A tentative (unconfirmed) cycle must never get a Zoom / Google Meet / Calendar series.

const mockDb = vi.hoisted(() => ({
  cycle: { findUnique: vi.fn(), update: vi.fn() },
  meeting: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function PrismaClient() { return mockDb; }),
}));

vi.mock('../../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { userId: 'admin-id', role: 'admin' };
    next();
  },
  managerOrAdmin: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../services/zoom', () => ({
  zoomService: { createCycleMeeting: vi.fn(), createMeeting: vi.fn(), findAvailableUser: vi.fn() },
  getIsraelOffset: vi.fn(() => '+02:00'),
}));
vi.mock('../../services/google-meet', () => ({
  googleMeetService: { createCycleMeeting: vi.fn(), createMeeting: vi.fn() },
}));

import zoomRouter from '../zoom.js';
import { zoomService } from '../../services/zoom';
import { googleMeetService } from '../../services/google-meet';

const app = express();
app.use(express.json());
app.use('/api/zoom', zoomRouter);

beforeEach(() => vi.clearAllMocks());

describe('POST /api/zoom/cycles/:cycleId/meeting — tentative guard', () => {
  it.each(['google_meet', 'zoom'])('refuses to create a %s series for a tentative cycle', async (provider) => {
    mockDb.cycle.findUnique.mockResolvedValue({
      id: 'cycle-t',
      name: 'טנטטיבי',
      status: 'tentative',
      type: 'private',
      activityType: 'online',
      zoomMeetingId: null,
      dayOfWeek: 'sunday',
      durationMinutes: 60,
      startTime: new Date('1970-01-01T00:00:00.000Z'),
      course: { name: 'קורס' },
      instructor: { email: 'i@hai.tech' },
    });

    const res = await request(app).post('/api/zoom/cycles/cycle-t/meeting').send({ videoProvider: provider });

    expect(res.status).toBe(400);
    expect(mockDb.meeting.findMany).not.toHaveBeenCalled();
    expect(googleMeetService.createCycleMeeting).not.toHaveBeenCalled();
    expect(zoomService.createCycleMeeting).not.toHaveBeenCalled();
  });
});
