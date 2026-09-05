import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    cycle: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    meeting: {
      createMany: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
    },
    meetingChangeRequest: {
      deleteMany: vi.fn(),
    },
    course: { findUnique: vi.fn() },
    branch: { findUnique: vi.fn() },
    instructor: { findUnique: vi.fn() },
    institutionalOrder: { findUnique: vi.fn() },
    billingPeriodMeeting: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../../middleware/auth.js', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { userId: 'admin-id', role: 'admin', email: 'admin@hai.tech' };
    next();
  },
  cycleRosterOrAdmin: (_req: any, _res: any, next: any) => next(),
  operationsManagerOrAdmin: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../utils/holidays.js', () => ({
  fetchHolidays: vi.fn().mockResolvedValue([]),
  dayNameToNumber: (day: string) => ({
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  }[day] ?? 0),
  calculateCycleEndDate: vi.fn(),
}));

vi.mock('../../utils/audit.js', () => ({
  logAudit: vi.fn(),
  logUpdateAudit: vi.fn(),
}));

vi.mock('../../services/zoom.js', () => ({
  zoomService: { deleteMeeting: vi.fn() },
  getHostKeyByEmail: vi.fn(),
}));

vi.mock('../../services/instructor-payment.js', () => ({
  recalculateInstructorPaymentsForCycle: vi.fn(),
}));

vi.mock('../../services/institutional-order-completion-alert.js', () => ({
  checkAndSendInstitutionalOrderCompletionAlert: vi.fn(),
}));

vi.mock('../../utils/recalcMeetingRevenue.js', () => ({
  recalcMeetingRevenue: vi.fn(),
}));

import { cyclesRouter } from '../cycles.js';
import { prisma } from '../../utils/prisma.js';
import { errorHandler } from '../../middleware/errorHandler.js';

const mockPrisma = vi.mocked(prisma);

const app = express();
app.use(express.json());
app.use('/api/cycles', cyclesRouter);
app.use(errorHandler);

const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);
const date = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

const baseCycle = {
  id: 'cycle-1',
  name: 'מחזור בדיקה',
  courseId: 'course-1',
  branchId: 'branch-1',
  instructorId: 'instructor-1',
  institutionalOrderId: null,
  type: 'private',
  status: 'active',
  startDate: date('2026-09-06'),
  endDate: date('2026-09-20'),
  dayOfWeek: 'sunday',
  startTime: time('16:00'),
  endTime: time('17:00'),
  durationMinutes: 60,
  totalMeetings: 4,
  completedMeetings: 0,
  remainingMeetings: 2,
  activityType: 'frontal',
  meetingRevenue: null,
  pricePerStudent: null,
  studentCount: null,
  course: { name: 'קורס' },
  branch: { name: 'סניף' },
  instructor: { name: 'מדריך' },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(async (callback: any) => callback(mockPrisma));
  mockPrisma.billingPeriodMeeting.findFirst.mockResolvedValue(null);
  mockPrisma.cycle.update.mockImplementation(async (_args: any) => ({
    ...baseCycle,
    course: { id: 'course-1', name: 'קורס' },
    branch: { id: 'branch-1', name: 'סניף' },
    instructor: { id: 'instructor-1', name: 'מדריך' },
  } as any));
  mockPrisma.meeting.createMany.mockResolvedValue({ count: 0 } as any);
  mockPrisma.meeting.findMany.mockResolvedValue([]);
  mockPrisma.meeting.deleteMany.mockResolvedValue({ count: 0 } as any);
  mockPrisma.meeting.updateMany.mockResolvedValue({ count: 0 } as any);
  mockPrisma.meetingChangeRequest.deleteMany.mockResolvedValue({ count: 0 } as any);
});

describe('cycle meeting generation', () => {
  it('generates only missing meetings after the last existing meeting', async () => {
    mockPrisma.cycle.findUnique
      .mockResolvedValueOnce({
        ...baseCycle,
        meetings: [
          { id: 'm1', scheduledDate: date('2026-09-06'), status: 'scheduled' },
          { id: 'm2', scheduledDate: date('2026-09-13'), status: 'scheduled' },
        ],
      } as any)
      .mockResolvedValueOnce({
        ...baseCycle,
        meetings: [
          { id: 'm1', scheduledDate: date('2026-09-06'), status: 'scheduled' },
          { id: 'm2', scheduledDate: date('2026-09-13'), status: 'scheduled' },
        ],
      } as any)
      .mockResolvedValueOnce({ ...baseCycle, meetings: [] } as any);

    const response = await request(app).post('/api/cycles/cycle-1/generate-meetings');

    expect(response.status).toBe(200);
    expect(mockPrisma.meeting.createMany).toHaveBeenCalledTimes(1);
    const data = mockPrisma.meeting.createMany.mock.calls[0][0].data as any[];
    expect(data.map(m => m.scheduledDate.toISOString().slice(0, 10))).toEqual([
      '2026-09-20',
      '2026-09-27',
    ]);
    expect(response.body.generated).toBe(2);
  });

  it('regenerates editable meetings while preserving completed and cancelled meetings', async () => {
    const existing = {
      ...baseCycle,
      startDate: date('2026-10-05'),
      dayOfWeek: 'monday',
    };
    const updated = {
      ...existing,
      startDate: date('2026-10-06'),
      dayOfWeek: 'tuesday',
      course: { id: 'course-1', name: 'קורס' },
      branch: { id: 'branch-1', name: 'סניף' },
      instructor: { id: 'instructor-1', name: 'מדריך' },
    };

    mockPrisma.cycle.update.mockResolvedValue(updated as any);
    mockPrisma.cycle.findUnique
      .mockResolvedValueOnce(existing as any)
      .mockResolvedValueOnce({
        ...updated,
        meetings: [
          { id: 'completed-1', scheduledDate: date('2026-10-06'), status: 'completed' },
          { id: 'scheduled-1', scheduledDate: date('2026-10-13'), status: 'scheduled' },
          { id: 'postponed-1', scheduledDate: date('2026-10-20'), status: 'postponed' },
          { id: 'cancelled-1', scheduledDate: date('2026-10-27'), status: 'cancelled' },
        ],
      } as any)
      .mockResolvedValueOnce({
        ...updated,
        meetings: [
          { id: 'completed-1', scheduledDate: date('2026-10-06'), status: 'completed' },
          { id: 'cancelled-1', scheduledDate: date('2026-10-27'), status: 'cancelled' },
        ],
      } as any);
    mockPrisma.meeting.findMany.mockResolvedValue([
      { scheduledDate: date('2026-10-06') },
    ] as any);

    const response = await request(app)
      .put('/api/cycles/cycle-1')
      .send({
        startDate: '2026-10-06',
        dayOfWeek: 'tuesday',
        startTime: '16:00',
        endTime: '17:00',
        regenerateMeetings: true,
      });

    expect(response.status).toBe(200);
    expect(mockPrisma.meetingChangeRequest.deleteMany).toHaveBeenCalledWith({
      where: { meetingId: { in: ['scheduled-1', 'postponed-1'] } },
    });
    expect(mockPrisma.meeting.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['scheduled-1', 'postponed-1'] } },
    });
    const generated = mockPrisma.meeting.createMany.mock.calls[0][0].data as any[];
    expect(generated.map(m => m.scheduledDate.toISOString().slice(0, 10))).toEqual([
      '2026-10-13',
      '2026-10-20',
      '2026-10-27',
    ]);
  });

  it('does not auto-generate meetings for trial private cycles', async () => {
    const trialCycle = {
      ...baseCycle,
      type: 'trial_private',
    };
    mockPrisma.cycle.findUnique
      .mockResolvedValueOnce(trialCycle as any)
      .mockResolvedValueOnce({
        ...trialCycle,
        meetings: [
          { id: 'manual-1', scheduledDate: date('2026-10-06'), status: 'scheduled' },
        ],
      } as any);

    const response = await request(app)
      .put('/api/cycles/cycle-1')
      .send({
        startDate: '2026-10-06',
        dayOfWeek: 'tuesday',
        startTime: '16:00',
        endTime: '17:00',
        regenerateMeetings: true,
      });

    expect(response.status).toBe(200);
    expect(mockPrisma.meeting.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.meeting.createMany).not.toHaveBeenCalled();
  });
});
