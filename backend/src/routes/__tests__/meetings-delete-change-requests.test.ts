import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const operationLog = vi.hoisted(() => [] as string[]);

vi.mock('../../utils/prisma.js', () => {
  const tx = {
    cycle: {
      findUnique: vi.fn(),
      update: vi.fn(async () => {
        operationLog.push('cycle.update');
        return {};
      }),
    },
    meetingChangeRequest: {
      deleteMany: vi.fn(async () => {
        operationLog.push('meetingChangeRequest.deleteMany');
        return { count: 1 };
      }),
    },
    meeting: {
      updateMany: vi.fn(async () => {
        operationLog.push('meeting.updateMany');
        return { count: 1 };
      }),
      delete: vi.fn(async () => {
        operationLog.push('meeting.delete');
        return {};
      }),
      deleteMany: vi.fn(async () => {
        operationLog.push('meeting.deleteMany');
        return { count: 2 };
      }),
    },
  };

  return {
    prisma: {
      $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
      meeting: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
      },
      cycle: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      cycleExpense: {
        groupBy: vi.fn(),
      },
      instructor: {
        findUnique: vi.fn(),
      },
      meetingChangeRequest: {
        deleteMany: vi.fn(),
      },
      __tx: tx,
    },
  };
});

vi.mock('../../middleware/auth.js', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { userId: 'admin-id', role: 'admin' };
    next();
  },
  operationsManagerOrAdmin: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../services/billing-lock.js', () => ({
  assertCyclePeriodNotLocked: vi.fn(),
  assertMeetingNotInIssuedPeriod: vi.fn(),
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
  getIsraelOffset: vi.fn(() => '+02:00'),
}));

vi.mock('../../services/cycle-completion.js', () => ({
  handleCycleCompletion: vi.fn(),
}));

vi.mock('../../utils/cycle-sync.js', () => ({
  shouldAutoCompleteCycle: vi.fn(),
  syncCycleEndDate: vi.fn(),
  syncCycleProgress: vi.fn(),
}));

vi.mock('../../services/instructor-payment.js', () => ({
  calculateInstructorPayment: vi.fn(),
  recalculateDailyInstructorPaymentsForMeeting: vi.fn(),
}));

vi.mock('../../services/negative-profit-alert.js', () => ({
  checkAndSendNegativeProfitAlert: vi.fn(),
}));

import { meetingsRouter } from '../meetings.js';
import { prisma } from '../../utils/prisma.js';
import { assertMeetingNotInIssuedPeriod } from '../../services/billing-lock.js';
import { recalculateDailyInstructorPaymentsForMeeting } from '../../services/instructor-payment.js';
import { errorHandler } from '../../middleware/errorHandler.js';

const app = express();
app.use(express.json());
app.use('/api/meetings', meetingsRouter);
app.use(errorHandler);

const mockPrisma = vi.mocked(prisma) as any;
const tx = mockPrisma.__tx;

beforeEach(() => {
  vi.clearAllMocks();
  operationLog.length = 0;
  tx.cycle.findUnique.mockResolvedValue({ id: 'cycle-1', completedMeetings: 4 });
});

describe('meeting deletion change request cleanup', () => {
  it('deletes meeting change requests inside the single meeting delete transaction', async () => {
    mockPrisma.meeting.findUnique.mockResolvedValue({
      id: 'meeting-1',
      cycleId: 'cycle-1',
      status: 'completed',
      zoomMeetingId: null,
    });

    const response = await request(app).delete('/api/meetings/meeting-1');

    expect(response.status).toBe(200);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.meetingChangeRequest.deleteMany).toHaveBeenCalledWith({
      where: { meetingId: 'meeting-1' },
    });
    expect(tx.meeting.updateMany).toHaveBeenCalledWith({
      where: { rescheduledToId: 'meeting-1' },
      data: { rescheduledToId: null },
    });
    expect(operationLog).toEqual([
      'cycle.update',
      'meetingChangeRequest.deleteMany',
      'meeting.updateMany',
      'meeting.delete',
    ]);
  });

  it('deletes related meeting change requests before bulk deleting meetings', async () => {
    const meetings = [
      {
        id: 'meeting-1',
        cycleId: 'cycle-1',
        instructorId: 'instructor-1',
        scheduledDate: new Date('2026-08-05T00:00:00.000Z'),
        status: 'completed',
      },
      {
        id: 'meeting-2',
        cycleId: 'cycle-1',
        instructorId: 'instructor-1',
        scheduledDate: new Date('2026-08-13T00:00:00.000Z'),
        status: 'scheduled',
      },
    ];
    mockPrisma.meeting.findMany.mockResolvedValue(meetings);

    const response = await request(app)
      .post('/api/meetings/bulk-delete')
      .send({ ids: ['meeting-1', 'meeting-2'] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, deleted: 2 });
    expect(assertMeetingNotInIssuedPeriod).toHaveBeenCalledTimes(2);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.meetingChangeRequest.deleteMany).toHaveBeenCalledWith({
      where: { meetingId: { in: ['meeting-1', 'meeting-2'] } },
    });
    expect(tx.meeting.updateMany).toHaveBeenCalledWith({
      where: { rescheduledToId: { in: ['meeting-1', 'meeting-2'] } },
      data: { rescheduledToId: null },
    });
    expect(operationLog).toEqual([
      'cycle.update',
      'meetingChangeRequest.deleteMany',
      'meeting.updateMany',
      'meeting.deleteMany',
    ]);
    expect(recalculateDailyInstructorPaymentsForMeeting).toHaveBeenCalledWith(meetings[0]);
    expect(recalculateDailyInstructorPaymentsForMeeting).not.toHaveBeenCalledWith(meetings[1]);
  });
});
