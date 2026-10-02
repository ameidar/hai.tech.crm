import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    meeting: { findMany: vi.fn() },
    cycleExpense: { findMany: vi.fn() },
    instructorFixedAddition: { findMany: vi.fn() },
    instructor: { findMany: vi.fn() },
  },
}));

import { prisma } from '../../utils/prisma.js';
import { buildInstructorMonthlyReport } from '../instructorReport.service.js';

const mockPrisma = vi.mocked(prisma, true);

const t = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

const kim = {
  id: 'kim', name: 'קים נוה', email: 'kim@example.com', employmentType: 'employee', kind: 'instructor',
  rateFrontal: 100, rateOnline: 80, ratePrivate: null, ratePreparation: null,
};
const dana = {
  id: 'dana', name: 'דנה', email: null, employmentType: 'freelancer', kind: 'instructor',
  rateFrontal: 120, rateOnline: 100, ratePrivate: null, ratePreparation: null,
};
const orYosef = {
  id: 'or', name: 'אור יוסף אשטמקר', email: null, employmentType: 'employee', kind: 'instructor',
  rateFrontal: 0, rateOnline: 0, ratePrivate: null, ratePreparation: null,
};

const cycle = (overrides: Record<string, unknown> = {}) => ({
  id: 'c1', name: 'מחזור א', instructorId: 'kim', activityType: 'frontal', type: 'institutional_per_child',
  isOnline: false, durationMinutes: 60, instructorPaymentMode: 'hourly', instructorDailyRate: null,
  location: 'באר שבע', branch: { city: 'באר שבע' }, course: { name: 'קורס' },
  ...overrides,
});

const meeting = (overrides: Record<string, unknown>) => ({
  id: 'm1', instructorId: 'kim', instructor: kim, cycleId: 'c1', cycle: cycle(),
  scheduledDate: day('2026-09-08'), startTime: t('16:00'), endTime: t('18:00'),
  activityType: 'frontal', instructorPayment: 260, revenue: 1000, topic: null, expenses: [],
  ...overrides,
});

const addition = (overrides: Record<string, unknown>) => ({
  id: 'a1', instructorId: 'kim', instructor: kim, description: 'ריכוז', amount: { toString: () => '2500.00' },
  isNet: true, startMonth: day('2026-09-01'), endMonth: null, deletedAt: null, createdAt: new Date(),
  ...overrides,
});

const setup = ({ meetings = [] as unknown[], additions = [] as unknown[] }) => {
  mockPrisma.meeting.findMany.mockImplementation((async (args: { where: { status: string } }) =>
    (args.where.status === 'completed' ? meetings : [])) as never);
  mockPrisma.cycleExpense.findMany.mockResolvedValue([] as never);
  mockPrisma.instructorFixedAddition.findMany.mockResolvedValue(additions as never);
  mockPrisma.instructor.findMany.mockResolvedValue([] as never);
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildInstructorMonthlyReport — fixed monthly additions', () => {
  it('queries additions active in the report month', async () => {
    setup({});
    await buildInstructorMonthlyReport('2026-09');
    const where = mockPrisma.instructorFixedAddition.findMany.mock.calls[0][0]!.where;
    expect(where).toEqual({
      deletedAt: null,
      startMonth: { lte: day('2026-09-01') },
      OR: [{ endMonth: null }, { endMonth: { gte: day('2026-09-01') } }],
    });
  });

  it('adds the additions to the instructor grand total and the report totals (no ×1.3)', async () => {
    setup({
      meetings: [meeting({})], // 2h × 100 = 200 base
      additions: [addition({}), addition({ id: 'a2', description: 'בונוס', amount: 300, isNet: false })],
    });

    const report = await buildInstructorMonthlyReport('2026-09');
    const k = report.instructors.find((i) => i.instructorId === 'kim')!;

    expect(k.totalPayment).toBe(200);
    expect(k.fixedAdditions).toEqual([
      expect.objectContaining({ description: 'ריכוז', amount: 2500, isNet: true, netLabel: 'נטו' }),
      expect.objectContaining({ description: 'בונוס', amount: 300, isNet: false, netLabel: 'ברוטו' }),
    ]);
    expect(k.fixedAdditionsTotal).toBe(2800);
    expect(k.grandTotal).toBe(200 + 2800);
    expect(report.summaryTotalFixedAdditions).toBe(2800);
    expect(report.summaryGrandTotal).toBe(
      report.summaryTotalPayment + report.summaryTotalExpenses + 2800
      + report.summaryTotalFixedSalaries + report.summaryTotalOperationsPayment,
    );
  });

  it('includes instructors that have an active addition but no meetings this month', async () => {
    setup({ meetings: [meeting({ instructorId: 'dana', instructor: dana })], additions: [addition({})] });

    const report = await buildInstructorMonthlyReport('2026-09');
    const k = report.instructors.find((i) => i.instructorId === 'kim');

    expect(k).toBeDefined();
    expect(k!.instructorName).toBe('קים נוה');
    expect(k!.totalMeetings).toBe(0);
    expect(k!.totalPayment).toBe(0);
    expect(k!.fixedAdditionsTotal).toBe(2500);
    expect(k!.grandTotal).toBe(2500);
    expect(report.instructors.find((i) => i.instructorId === 'dana')!.fixedAdditionsTotal).toBe(0);
  });

  it('keeps skipping fixed-management instructors (אור יוסף) even with additions', async () => {
    setup({ additions: [addition({ instructorId: 'or', instructor: orYosef })] });
    const report = await buildInstructorMonthlyReport('2026-09');
    expect(report.instructors.find((i) => i.instructorId === 'or')).toBeUndefined();
    expect(report.summaryTotalFixedAdditions).toBe(0);
  });

  it('reports zero additions when none are active', async () => {
    setup({ meetings: [meeting({})] });
    const report = await buildInstructorMonthlyReport('2026-09');
    const k = report.instructors[0];
    expect(k.fixedAdditions).toEqual([]);
    expect(k.fixedAdditionsTotal).toBe(0);
    expect(k.grandTotal).toBe(200);
  });
});
