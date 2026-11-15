import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Tentative cycles: creation generates side-effect-free 'tentative' meetings, confirmation
// (tentative → active) flips them to 'scheduled', and invalid transitions are rejected.

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    cycle: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    meeting: {
      createMany: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
    },
    meetingChangeRequest: { deleteMany: vi.fn() },
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
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  }[day] ?? 0),
  calculateCycleEndDate: vi.fn().mockResolvedValue({ endDate: new Date('2026-12-27T00:00:00.000Z') }),
}));

vi.mock('../../utils/audit.js', () => ({ logAudit: vi.fn(), logUpdateAudit: vi.fn() }));

// Video / calendar providers — must never be touched for tentative cycles.
vi.mock('../../services/zoom.js', () => ({
  zoomService: { deleteMeeting: vi.fn(), createMeeting: vi.fn(), createCycleMeeting: vi.fn(), findAvailableUser: vi.fn() },
  getHostKeyByEmail: vi.fn(),
  getIsraelOffset: vi.fn(() => '+02:00'),
  deleteMeeting: vi.fn(),
}));
vi.mock('../../services/google-meet.js', () => ({
  googleMeetService: { createMeeting: vi.fn(), createCycleMeeting: vi.fn(), deleteGoogleMeetMeeting: vi.fn() },
}));

vi.mock('../../services/instructor-payment.js', () => ({
  recalculateInstructorPaymentsForCycle: vi.fn(),
}));
vi.mock('../../services/institutional-order-completion-alert.js', () => ({
  checkAndSendInstitutionalOrderCompletionAlert: vi.fn(),
}));
vi.mock('../../utils/recalcMeetingRevenue.js', () => ({ recalcMeetingRevenue: vi.fn() }));
vi.mock('../../services/monthly-fixed-billing.js', () => ({
  syncMonthlyFixedForCycle: vi.fn(),
  redistributeMonthlyFixedRevenue: vi.fn().mockResolvedValue({ skipped: true, months: [], updated: 0 }),
}));

import { cyclesRouter } from '../cycles.js';
import { prisma } from '../../utils/prisma.js';
import { errorHandler } from '../../middleware/errorHandler.js';
import { zoomService } from '../../services/zoom.js';
import { googleMeetService } from '../../services/google-meet.js';

const mockPrisma = vi.mocked(prisma);

const app = express();
app.use(express.json());
app.use('/api/cycles', cyclesRouter);
app.use(errorHandler);

const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);
const date = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

const tentativeCycle = {
  id: 'cycle-t',
  name: 'מחזור טנטטיבי',
  courseId: 'course-1',
  branchId: 'branch-1',
  instructorId: 'instructor-1',
  institutionalOrderId: 'order-1',
  type: 'institutional_fixed',
  status: 'tentative',
  startDate: date('2026-12-06'),
  endDate: date('2026-12-27'),
  dayOfWeek: 'sunday',
  startTime: time('00:00'),
  endTime: time('01:00'),
  durationMinutes: 60,
  totalMeetings: 4,
  completedMeetings: 0,
  remainingMeetings: 4,
  activityType: 'online',
  meetingRevenue: 500,
  recallBotEnabled: false,
  course: { id: 'course-1', name: 'קורס' },
  branch: { id: 'branch-1', name: 'סניף' },
  instructor: { id: 'instructor-1', name: 'מדריך' },
};

const createBody = {
  name: 'מחזור טנטטיבי',
  courseId: 'course-1',
  branchId: 'branch-1',
  instructorId: 'instructor-1',
  institutionalOrderId: 'order-1',
  type: 'institutional_fixed',
  startDate: '2026-12-06',
  dayOfWeek: 'sunday',
  durationMinutes: 60,
  totalMeetings: 4,
  meetingRevenue: 500,
  activityType: 'online',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
  mockPrisma.billingPeriodMeeting.findFirst.mockResolvedValue(null);
  mockPrisma.course.findUnique.mockResolvedValue({ id: 'course-1' } as any);
  mockPrisma.branch.findUnique.mockResolvedValue({ id: 'branch-1' } as any);
  mockPrisma.instructor.findUnique.mockResolvedValue({ id: 'instructor-1' } as any);
  mockPrisma.institutionalOrder.findUnique.mockResolvedValue({ id: 'order-1' } as any);
  mockPrisma.meeting.createMany.mockResolvedValue({ count: 0 } as any);
  mockPrisma.meeting.findMany.mockResolvedValue([]);
  mockPrisma.meeting.count.mockResolvedValue(0);
  mockPrisma.meeting.deleteMany.mockResolvedValue({ count: 0 } as any);
  mockPrisma.meeting.updateMany.mockResolvedValue({ count: 4 } as any);
  mockPrisma.meetingChangeRequest.deleteMany.mockResolvedValue({ count: 0 } as any);
});

describe('tentative cycle creation', () => {
  it('creates a tentative cycle without times (placeholder slot) and generates tentative meetings only', async () => {
    mockPrisma.cycle.create.mockImplementation(async ({ data }: any) => ({ ...tentativeCycle, ...data, id: 'cycle-t' }));
    mockPrisma.cycle.findUnique.mockResolvedValue({ ...tentativeCycle, meetings: [], registrations: [] } as any);
    mockPrisma.cycle.update.mockResolvedValue(tentativeCycle as any);

    const res = await request(app).post('/api/cycles').send({ ...createBody, status: 'tentative' });

    expect(res.status).toBe(201);
    const createArgs = mockPrisma.cycle.create.mock.calls[0][0] as any;
    expect(createArgs.data.status).toBe('tentative');
    expect(createArgs.data.startTime.toISOString()).toBe('1970-01-01T00:00:00.000Z');
    expect(createArgs.data.endTime.toISOString()).toBe('1970-01-01T01:00:00.000Z');

    const meetings = mockPrisma.meeting.createMany.mock.calls[0][0].data as any[];
    expect(meetings).toHaveLength(4);
    for (const m of meetings) {
      expect(m.status).toBe('tentative');
      expect(m.revenue).toBe(500); // spreads expected revenue into the forecast months
    }

    // No video meeting / calendar / Meet space for a tentative cycle.
    expect(zoomService.createMeeting).not.toHaveBeenCalled();
    expect(zoomService.createCycleMeeting).not.toHaveBeenCalled();
    expect(googleMeetService.createMeeting).not.toHaveBeenCalled();
    expect(googleMeetService.createCycleMeeting).not.toHaveBeenCalled();
  });

  it('still requires start/end times for a regular (active) cycle', async () => {
    const res = await request(app).post('/api/cycles').send(createBody);
    expect(res.status).toBe(400);
    expect(mockPrisma.cycle.create).not.toHaveBeenCalled();
  });

  it('generates scheduled meetings for a normal active cycle (unchanged behaviour)', async () => {
    const active = { ...tentativeCycle, status: 'active', startTime: time('16:00'), endTime: time('17:00') };
    mockPrisma.cycle.create.mockResolvedValue(active as any);
    mockPrisma.cycle.findUnique.mockResolvedValue({ ...active, meetings: [], registrations: [] } as any);
    mockPrisma.cycle.update.mockResolvedValue(active as any);

    const res = await request(app).post('/api/cycles').send({ ...createBody, startTime: '16:00', endTime: '17:00' });

    expect(res.status).toBe(201);
    expect((mockPrisma.cycle.create.mock.calls[0][0] as any).data.status).toBeUndefined();
    const meetings = mockPrisma.meeting.createMany.mock.calls[0][0].data as any[];
    expect(meetings.every((m) => m.status === 'scheduled')).toBe(true);
  });
});

describe('tentative cycle confirmation (tentative → active)', () => {
  it('refuses to confirm while the cycle still has the placeholder time', async () => {
    mockPrisma.cycle.findUnique.mockResolvedValue(tentativeCycle as any);

    const res = await request(app).put('/api/cycles/cycle-t').send({ status: 'active' });

    expect(res.status).toBe(400);
    expect(mockPrisma.cycle.update).not.toHaveBeenCalled();
    expect(mockPrisma.meeting.updateMany).not.toHaveBeenCalled();
  });

  it('flips tentative meetings to scheduled when confirmed with real times', async () => {
    const confirmed = { ...tentativeCycle, status: 'active', startTime: time('16:00'), endTime: time('17:00') };
    mockPrisma.cycle.findUnique.mockImplementation(async (args: any) => {
      if (args?.include?.meetings) {
        return {
          ...confirmed,
          meetings: [
            { id: 'm1', scheduledDate: date('2026-12-06'), status: 'tentative' },
            { id: 'm2', scheduledDate: date('2026-12-13'), status: 'tentative' },
          ],
          registrations: [],
        };
      }
      if (args?.select?.totalMeetings) return { name: confirmed.name, totalMeetings: 4, status: 'active' };
      return tentativeCycle;
    });
    mockPrisma.cycle.update.mockResolvedValue(confirmed as any);

    const res = await request(app)
      .put('/api/cycles/cycle-t')
      .send({ status: 'active', startTime: '16:00', endTime: '17:00' });

    expect(res.status).toBe(200);
    // Times changed while tentative → schedule rebuilt (tentative meetings deleted + regenerated).
    expect(mockPrisma.meeting.deleteMany).toHaveBeenCalled();
    // Remaining tentative meetings flipped to scheduled.
    expect(mockPrisma.meeting.updateMany).toHaveBeenCalledWith({
      where: { cycleId: 'cycle-t', status: 'tentative' },
      data: expect.objectContaining({ status: 'scheduled' }),
    });
    // Regenerated meetings of the now-active cycle are scheduled.
    const generated = mockPrisma.meeting.createMany.mock.calls.flatMap((c: any) => c[0].data);
    expect(generated.every((m: any) => m.status === 'scheduled')).toBe(true);
    // Confirmation itself never auto-creates video meetings.
    expect(googleMeetService.createCycleMeeting).not.toHaveBeenCalled();
    expect(zoomService.createCycleMeeting).not.toHaveBeenCalled();
  });

  it('rejects moving a tentative cycle straight to completed/frozen', async () => {
    mockPrisma.cycle.findUnique.mockResolvedValue(tentativeCycle as any);
    const res = await request(app).put('/api/cycles/cycle-t').send({ status: 'completed' });
    expect(res.status).toBe(400);
    expect(mockPrisma.cycle.update).not.toHaveBeenCalled();
  });

  it('rejects turning an existing active cycle into tentative', async () => {
    mockPrisma.cycle.findUnique.mockResolvedValue({ ...tentativeCycle, status: 'active' } as any);
    const res = await request(app).put('/api/cycles/cycle-t').send({ status: 'tentative' });
    expect(res.status).toBe(400);
    expect(mockPrisma.cycle.update).not.toHaveBeenCalled();
  });

  it('bulk-confirming runs the confirmation for tentative cycles only', async () => {
    mockPrisma.cycle.findMany.mockResolvedValue([
      { id: 'cycle-t', name: 'א', status: 'tentative', startTime: time('16:00') },
      { id: 'cycle-a', name: 'ב', status: 'active', startTime: time('10:00') },
    ] as any);
    mockPrisma.cycle.update.mockResolvedValue({ id: 'x', name: 'x', institutionalOrderId: null } as any);
    mockPrisma.cycle.findUnique.mockResolvedValue({ name: 'א', totalMeetings: 4, status: 'active' } as any);

    const res = await request(app)
      .post('/api/cycles/bulk-update')
      .send({ ids: ['cycle-t', 'cycle-a'], data: { status: 'active' } });

    expect(res.status).toBe(200);
    expect(mockPrisma.meeting.updateMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.meeting.updateMany).toHaveBeenCalledWith({
      where: { cycleId: 'cycle-t', status: 'tentative' },
      data: expect.objectContaining({ status: 'scheduled' }),
    });
  });

  it('bulk-confirm is refused when a tentative cycle has no real time yet', async () => {
    mockPrisma.cycle.findMany.mockResolvedValue([
      { id: 'cycle-t', name: 'א', status: 'tentative', startTime: time('00:00') },
    ] as any);
    const res = await request(app)
      .post('/api/cycles/bulk-update')
      .send({ ids: ['cycle-t'], data: { status: 'active' } });
    expect(res.status).toBe(400);
    expect(mockPrisma.cycle.update).not.toHaveBeenCalled();
  });
});
