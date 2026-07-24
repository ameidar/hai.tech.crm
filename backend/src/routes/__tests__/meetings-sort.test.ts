/**
 * Tests for /api/meetings ?sort=asc|desc (PR #37, 22/04/2026)
 *
 * BUG: default sort was scheduledDate ASC (oldest first). With 27K+ meetings
 *      from 2022 onward, consumers calling /api/meetings?limit=500 without a
 *      date filter got 2022 meetings and couldn't see 2026 meetings without
 *      deep pagination.
 * FIX: accept optional ?sort=desc to return newest-first. Default stays ASC.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

let authenticatedUser = { userId: 'admin-id', role: 'admin' };

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    meeting: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    cycleExpense: {
      groupBy: vi.fn(),
    },
    instructor: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../../middleware/auth.js', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = authenticatedUser;
    next();
  },
  managerOrAdmin: (_req: any, _res: any, next: any) => next(),
  operationsManagerOrAdmin: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../services/replacement-meeting.js', () => ({
  addReplacementMeetingWithRetry: vi.fn(),
}));

vi.mock('../../utils/audit.js', () => ({
  logAudit: vi.fn(),
  logUpdateAudit: vi.fn(),
}));

vi.mock('../../services/zoom.js', () => ({
  zoomService: { createMeeting: vi.fn(), deleteMeeting: vi.fn() },
}));

vi.mock('../../services/cycle-completion.js', () => ({
  handleCycleCompletion: vi.fn(),
}));

vi.mock('../../utils/cycle-sync.js', () => ({
  syncCycleProgress: vi.fn(),
}));

import { meetingsRouter } from '../meetings.js';
import { prisma } from '../../utils/prisma.js';
import { errorHandler } from '../../middleware/errorHandler.js';

const mockPrisma = vi.mocked(prisma);

const app = express();
app.use(express.json());
app.use('/api/meetings', meetingsRouter);
app.use(errorHandler);

beforeEach(() => {
  vi.clearAllMocks();
  authenticatedUser = { userId: 'admin-id', role: 'admin' };
  mockPrisma.meeting.count.mockResolvedValue(0);
  mockPrisma.meeting.findMany.mockResolvedValue([]);
  mockPrisma.cycleExpense.groupBy.mockResolvedValue([]);
  mockPrisma.instructor.findUnique.mockResolvedValue(null);
});

describe('GET /api/meetings — sort param', () => {
  it('defaults to ASC (oldest first) when sort is not provided — backwards compatible', async () => {
    await request(app).get('/api/meetings');

    expect(mockPrisma.meeting.findMany).toHaveBeenCalledTimes(1);
    const call = mockPrisma.meeting.findMany.mock.calls[0][0] as any;
    expect(call.orderBy).toEqual([
      { scheduledDate: 'asc' },
      { startTime: 'asc' },
    ]);
  });

  it('sorts DESC when ?sort=desc is passed', async () => {
    await request(app).get('/api/meetings?sort=desc');

    const call = mockPrisma.meeting.findMany.mock.calls[0][0] as any;
    expect(call.orderBy).toEqual([
      { scheduledDate: 'desc' },
      { startTime: 'desc' },
    ]);
  });

  it('sorts ASC when ?sort=asc is passed explicitly', async () => {
    await request(app).get('/api/meetings?sort=asc');

    const call = mockPrisma.meeting.findMany.mock.calls[0][0] as any;
    expect(call.orderBy).toEqual([
      { scheduledDate: 'asc' },
      { startTime: 'asc' },
    ]);
  });

  it('accepts ?sort=DESC (case-insensitive) and applies DESC', async () => {
    await request(app).get('/api/meetings?sort=DESC');

    const call = mockPrisma.meeting.findMany.mock.calls[0][0] as any;
    expect(call.orderBy).toEqual([
      { scheduledDate: 'desc' },
      { startTime: 'desc' },
    ]);
  });

  it('falls back to ASC for unknown sort values (e.g. ?sort=banana)', async () => {
    await request(app).get('/api/meetings?sort=banana');

    const call = mockPrisma.meeting.findMany.mock.calls[0][0] as any;
    expect(call.orderBy).toEqual([
      { scheduledDate: 'asc' },
      { startTime: 'asc' },
    ]);
  });

  it('forces operations_control users to their linked instructor meetings', async () => {
    authenticatedUser = { userId: 'kim-user-id', role: 'operations_control' };
    mockPrisma.instructor.findUnique.mockResolvedValue({ id: 'kim-instructor-id' } as any);

    await request(app).get('/api/meetings?instructorId=other-instructor-id');

    expect(mockPrisma.instructor.findUnique).toHaveBeenCalledWith({
      where: { userId: 'kim-user-id' },
      select: { id: true },
    });
    const call = mockPrisma.meeting.findMany.mock.calls[0][0] as any;
    expect(call.where.instructorId).toBe('kim-instructor-id');
  });

  it('does not leak all meetings when operations_control has no linked instructor', async () => {
    authenticatedUser = { userId: 'unlinked-user-id', role: 'operations_control' };
    mockPrisma.instructor.findUnique.mockResolvedValue(null);

    const response = await request(app).get('/api/meetings');

    expect(response.status).toBe(403);
    expect(mockPrisma.meeting.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.meeting.count).not.toHaveBeenCalled();
  });
});
