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
import { buildInstructorMonthlyReport, isManualPaymentOverride } from '../instructorReport.service.js';

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

describe('buildInstructorMonthlyReport — manual payment overrides', () => {
  it('detects overrides with a ₪1 tolerance', () => {
    expect(isManualPaymentOverride(260, 260)).toBe(false);
    expect(isManualPaymentOverride(261, 260)).toBe(false);
    expect(isManualPaymentOverride(262, 260)).toBe(true);
    expect(isManualPaymentOverride(273, 585)).toBe(true);
  });

  it('keeps hours × rate when the stored payment matches the calculation', async () => {
    // employee, 2h × 100 → stored 260 (= 200 × 1.3)
    setup({ meetings: [meeting({ instructorPayment: 260 })] });
    const report = await buildInstructorMonthlyReport('2026-09');
    const m = report.instructors[0].meetings[0];
    expect(m.instructorPayment).toBe(200);
    expect(m.hourlyRate).toBe(100);
    expect(m.manualPaymentOverride).toBe(false);
    expect(m.paymentNote).toBeNull();
  });

  it('uses the stored amount ÷ 1.3 for an employee whose payment was corrected (Fadi case)', async () => {
    const fadi = { ...kim, id: 'fadi', name: 'פאדי אמון', rateFrontal: 150 };
    // 3h × 150 would store 585; manually corrected to 273 (= 3 × 70 × 1.3)
    setup({
      meetings: [meeting({
        instructorId: 'fadi', instructor: fadi, cycle: cycle({ instructorId: 'fadi' }),
        startTime: t('16:00'), endTime: t('19:00'), instructorPayment: 273,
      })],
    });
    const report = await buildInstructorMonthlyReport('2026-09');
    const i = report.instructors[0];
    expect(i.totalPayment).toBe(210);
    expect(i.meetings[0]).toMatchObject({
      instructorPayment: 210, hourlyRate: 70, manualPaymentOverride: true, paymentNote: 'סכום מתוקן ידנית',
    });
    expect(i.byActivityType[0]).toMatchObject({ activityTypeRaw: 'frontal', hours: 3, subtotal: 210, manualOverrides: 1 });
  });

  it('raises the base when stored was corrected upward (Elad case, 3 × 1h meetings)', async () => {
    const elad = { ...kim, id: 'elad', name: 'אלעד תורגמן', rateFrontal: 90 };
    const base = { instructorId: 'elad', instructor: elad, cycle: cycle({ instructorId: 'elad' }), instructorPayment: 156 };
    setup({
      meetings: [
        meeting({ ...base, id: 'e1', startTime: t('16:30'), endTime: t('17:30') }),
        meeting({ ...base, id: 'e2', startTime: t('17:30'), endTime: t('18:30') }),
        meeting({ ...base, id: 'e3', startTime: t('18:30'), endTime: t('19:30') }),
      ],
    });
    const report = await buildInstructorMonthlyReport('2026-09');
    const i = report.instructors[0];
    expect(i.meetings.map((m) => m.instructorPayment)).toEqual([120, 120, 120]);
    expect(i.meetings.every((m) => m.manualPaymentOverride && m.hourlyRate === 120)).toBe(true);
    expect(i.totalPayment).toBe(360);
  });

  it('uses the stored amount as-is for freelancers', async () => {
    // freelancer 2h × 120 would store 240; corrected to 300
    setup({ meetings: [meeting({ instructorId: 'dana', instructor: dana, cycle: cycle({ instructorId: 'dana' }), instructorPayment: 300 })] });
    const report = await buildInstructorMonthlyReport('2026-09');
    expect(report.instructors[0].meetings[0]).toMatchObject({ instructorPayment: 300, hourlyRate: 150, manualPaymentOverride: true });
  });

  it('leaves daily-payment cycles untouched', async () => {
    const dailyCycle = cycle({ instructorPaymentMode: 'daily', instructorDailyRate: 500 });
    setup({
      meetings: [
        meeting({ id: 'd1', cycle: dailyCycle, instructorPayment: 500 }),
        meeting({ id: 'd2', cycle: dailyCycle, instructorPayment: 0, startTime: t('18:00'), endTime: t('19:00') }),
      ],
    });
    const report = await buildInstructorMonthlyReport('2026-09');
    const i = report.instructors[0];
    expect(i.meetings.map((m) => [m.instructorPayment, m.paymentNote, m.manualPaymentOverride]))
      .toEqual([[500, 'תשלום יומי', false], [0, 'כלול בתשלום יומי', false]]);
    expect(i.totalPayment).toBe(500);
  });
});
