import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    meetingChangeRequest: { findUnique: vi.fn(), update: vi.fn() },
    meeting: { update: vi.fn() },
  },
}));
vi.mock('../../middleware/auth.js', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { userId: 'admin-id', role: 'admin' };
    next();
  },
}));
vi.mock('../../services/email/sender.js', () => ({ sendEmail: vi.fn() }));
vi.mock('../../services/replacement-meeting.js', () => ({
  addReplacementMeetingWithRetry: vi.fn().mockResolvedValue('replacement-id'),
}));

import { meetingRequestsRouter } from '../meeting-requests.js';
import { prisma } from '../../utils/prisma.js';
import { addReplacementMeetingWithRetry } from '../../services/replacement-meeting.js';
import { errorHandler } from '../../middleware/errorHandler.js';

const mockPrisma = vi.mocked(prisma, true);
const app = express();
app.use(express.json());
app.use('/api/meeting-requests', meetingRequestsRouter);
app.use(errorHandler);

const t = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);
const pending = {
  id: 'req-1',
  meetingId: 'm-1',
  type: 'postpone',
  status: 'pending',
  meeting: { id: 'm-1', startTime: t('18:00'), endTime: t('18:45'), cycle: { name: 'רובלוקס - עדן' } },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.meetingChangeRequest.findUnique.mockResolvedValue(pending as never);
  mockPrisma.meetingChangeRequest.update.mockResolvedValue({ ...pending, status: 'approved' } as never);
  mockPrisma.meeting.update.mockResolvedValue({} as never);
});

describe('PUT /api/meeting-requests/:id/approve (postpone)', () => {
  it('reschedules the same meeting to the requested slot and keeps it scheduled', async () => {
    const res = await request(app).put('/api/meeting-requests/req-1/approve')
      .send({ newDate: '2026-10-29', newStartTime: '17:00' });
    expect(res.status).toBe(200);
    expect(mockPrisma.meeting.update).toHaveBeenCalledWith({
      where: { id: 'm-1' },
      data: expect.objectContaining({
        scheduledDate: new Date('2026-10-29T00:00:00.000Z'),
        startTime: t('17:00'),
        endTime: t('17:45'),
        status: 'scheduled',
      }),
    });
    expect(addReplacementMeetingWithRetry).not.toHaveBeenCalled();
  });

  it('keeps the original time when only a new date is given', async () => {
    await request(app).put('/api/meeting-requests/req-1/approve').send({ newDate: '2026-10-25' });
    expect(mockPrisma.meeting.update).toHaveBeenCalledWith({
      where: { id: 'm-1' },
      data: expect.objectContaining({ startTime: t('18:00'), endTime: t('18:45'), status: 'scheduled' }),
    });
  });

  it('without a new slot keeps the old behaviour: postponed + replacement at cycle end', async () => {
    await request(app).put('/api/meeting-requests/req-1/approve').send({});
    expect(mockPrisma.meeting.update).toHaveBeenCalledWith({
      where: { id: 'm-1' },
      data: expect.objectContaining({ status: 'postponed' }),
    });
    expect(addReplacementMeetingWithRetry).toHaveBeenCalledTimes(1);
  });

  it('rejects a new time without a new date', async () => {
    const res = await request(app).put('/api/meeting-requests/req-1/approve').send({ newStartTime: '17:00' });
    expect(res.status).toBe(400);
    expect(mockPrisma.meeting.update).not.toHaveBeenCalled();
  });
});
