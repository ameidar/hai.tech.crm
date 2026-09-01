import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    cycle: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    student: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    registration: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock('../../utils/recalcMeetingRevenue.js', () => ({
  recalcMeetingRevenue: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from '../../utils/prisma.js';
import { recalcMeetingRevenue } from '../../utils/recalcMeetingRevenue.js';
import { autoRegisterLeadToCycle } from '../lead-cycle-registration.js';

const mockPrisma = vi.mocked(prisma);
const mockRecalc = vi.mocked(recalcMeetingRevenue);

const baseInput = {
  source: 'omer-dafna-registration-form',
  customerId: 'customer-1',
  childName: 'אדם',
  childAge: '8',
  cycleId: 'cycle-1',
  interest: 'מיינקראפט כיתה ג',
};

describe('autoRegisterLeadToCycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.cycle.findMany.mockResolvedValue([]);
  });

  it('creates an unpaid registration for a valid Omer form lead', async () => {
    mockPrisma.cycle.findFirst.mockResolvedValue({
      id: 'cycle-1',
      name: 'עומר - מיינקראפט כיתה ג׳',
      status: 'active',
      defaultRegistrationAmount: 3200,
    } as any);
    mockPrisma.student.findFirst.mockResolvedValue(null);
    mockPrisma.student.create.mockResolvedValue({ id: 'student-1' } as any);
    mockPrisma.registration.findFirst.mockResolvedValue(null);
    mockPrisma.registration.create.mockResolvedValue({ id: 'registration-1' } as any);

    const result = await autoRegisterLeadToCycle(baseInput);

    expect(result).toEqual({
      status: 'registered',
      cycleId: 'cycle-1',
      studentId: 'student-1',
      registrationId: 'registration-1',
    });
    expect(mockPrisma.registration.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        studentId: 'student-1',
        cycleId: 'cycle-1',
        status: 'registered',
        paymentStatus: 'unpaid',
        amount: 3200,
      }),
      select: { id: true },
    });
    expect(mockRecalc).toHaveBeenCalledWith('cycle-1');
  });

  it('keeps amount empty when the cycle has no configured price', async () => {
    mockPrisma.cycle.findFirst.mockResolvedValue({
      id: 'cycle-1',
      name: 'עומר - מיינקראפט כיתה ג׳',
      status: 'active',
      defaultRegistrationAmount: null,
    } as any);
    mockPrisma.student.findFirst.mockResolvedValue({ id: 'student-1' } as any);
    mockPrisma.registration.findFirst.mockResolvedValue(null);
    mockPrisma.registration.create.mockResolvedValue({ id: 'registration-1' } as any);

    await autoRegisterLeadToCycle(baseInput);

    expect(mockPrisma.registration.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: null,
        paymentStatus: 'unpaid',
      }),
      select: { id: true },
    });
  });

  it('does not duplicate an existing active registration', async () => {
    mockPrisma.cycle.findFirst.mockResolvedValue({
      id: 'cycle-1',
      status: 'active',
      defaultRegistrationAmount: 3200,
    } as any);
    mockPrisma.student.findFirst.mockResolvedValue({ id: 'student-1' } as any);
    mockPrisma.registration.findFirst.mockResolvedValue({ id: 'registration-1' } as any);

    const result = await autoRegisterLeadToCycle(baseInput);

    expect(result.status).toBe('already_registered');
    expect(result.registrationId).toBe('registration-1');
    expect(mockPrisma.registration.create).not.toHaveBeenCalled();
    expect(mockRecalc).not.toHaveBeenCalled();
  });

  it('skips inactive cycles without creating a student or registration', async () => {
    mockPrisma.cycle.findFirst.mockResolvedValue({
      id: 'cycle-1',
      status: 'completed',
      defaultRegistrationAmount: 3200,
    } as any);

    const result = await autoRegisterLeadToCycle(baseInput);

    expect(result).toEqual({
      status: 'inactive_cycle',
      reason: 'cycle_status_completed',
      cycleId: 'cycle-1',
    });
    expect(mockPrisma.student.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.registration.create).not.toHaveBeenCalled();
  });

  it('skips sources that are not explicitly enabled', async () => {
    const result = await autoRegisterLeadToCycle({
      ...baseInput,
      source: 'website',
    });

    expect(result).toEqual({ status: 'skipped', reason: 'source_not_enabled' });
    expect(mockPrisma.cycle.findFirst).not.toHaveBeenCalled();
  });

  it('allows campaign sources to create cycle registrations', async () => {
    mockPrisma.cycle.findFirst.mockResolvedValue({
      id: 'cycle-1',
      name: 'רובלוקס מתחילים גילאי 10-13',
      status: 'active',
      defaultRegistrationAmount: 999,
    } as any);
    mockPrisma.student.findFirst.mockResolvedValue(null);
    mockPrisma.student.create.mockResolvedValue({ id: 'student-1' } as any);
    mockPrisma.registration.findFirst.mockResolvedValue(null);
    mockPrisma.registration.create.mockResolvedValue({ id: 'registration-1' } as any);

    const result = await autoRegisterLeadToCycle({
      ...baseInput,
      source: 'campaign:roblox-group-20261004',
      childAge: '10',
      grade: 'ה',
      interest: 'Roblox בני 10+',
    });

    expect(result.status).toBe('registered');
    expect(mockPrisma.student.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        age: 10,
        grade: 'ה',
      }),
      select: { id: true },
    });
    expect(mockPrisma.registration.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: 999,
        notes: 'נוצר אוטומטית מטופס campaign:roblox-group-20261004',
      }),
      select: { id: true },
    });
  });

  it('falls back to the submitted cycle label when the hardcoded cycle id is stale', async () => {
    mockPrisma.cycle.findFirst.mockResolvedValue(null);
    mockPrisma.cycle.findMany.mockResolvedValue([
      {
        id: 'current-cycle-id',
        name: 'עומר - סטארטאפ AI כיתות ה׳-ו׳',
        status: 'active',
        defaultRegistrationAmount: 3200,
        dayOfWeek: 'thursday',
        startTime: new Date('1970-01-01T17:30:00.000Z'),
        course: { name: 'סטארטאפ AI' },
        branch: { name: 'בית ספר דפנה עומר' },
      },
    ] as any);
    mockPrisma.student.findFirst.mockResolvedValue(null);
    mockPrisma.student.create.mockResolvedValue({ id: 'student-1' } as any);
    mockPrisma.registration.findFirst.mockResolvedValue(null);
    mockPrisma.registration.create.mockResolvedValue({ id: 'registration-1' } as any);

    const result = await autoRegisterLeadToCycle({
      ...baseInput,
      cycleId: 'old-cycle-id',
      cycleLabel: 'יום חמישי | 17:30 | סטארטאפ AI | כיתות ה׳',
      interest: null,
    });

    expect(result).toEqual({
      status: 'registered',
      cycleId: 'current-cycle-id',
      studentId: 'student-1',
      registrationId: 'registration-1',
    });
    expect(mockPrisma.registration.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cycleId: 'current-cycle-id',
        status: 'registered',
        paymentStatus: 'unpaid',
        amount: 3200,
      }),
      select: { id: true },
    });
  });

  it('does not guess when a submitted cycle label matches multiple active Omer cycles equally', async () => {
    mockPrisma.cycle.findFirst.mockResolvedValue(null);
    mockPrisma.cycle.findMany.mockResolvedValue([
      {
        id: 'cycle-a',
        name: 'עומר - סטארטאפ AI א',
        status: 'active',
        defaultRegistrationAmount: 3200,
        dayOfWeek: 'thursday',
        startTime: new Date('1970-01-01T17:30:00.000Z'),
        course: { name: 'סטארטאפ AI' },
        branch: { name: 'עומר' },
      },
      {
        id: 'cycle-b',
        name: 'עומר - סטארטאפ AI ב',
        status: 'active',
        defaultRegistrationAmount: 3200,
        dayOfWeek: 'thursday',
        startTime: new Date('1970-01-01T17:30:00.000Z'),
        course: { name: 'סטארטאפ AI' },
        branch: { name: 'עומר' },
      },
    ] as any);

    const result = await autoRegisterLeadToCycle({
      ...baseInput,
      cycleId: 'old-cycle-id',
      cycleLabel: 'יום חמישי | 17:30 | סטארטאפ AI',
    });

    expect(result).toEqual({
      status: 'ambiguous_cycle',
      reason: 'cycle_label_ambiguous',
      cycleId: 'old-cycle-id',
    });
    expect(mockPrisma.student.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.registration.create).not.toHaveBeenCalled();
  });

  it('does not infer a weekday from grade text alone', async () => {
    mockPrisma.cycle.findFirst.mockResolvedValue(null);
    mockPrisma.cycle.findMany.mockResolvedValue([
      {
        id: 'cycle-a',
        name: 'עומר - סטארטאפ AI כיתות ה׳-ו׳',
        status: 'active',
        defaultRegistrationAmount: 3200,
        dayOfWeek: 'thursday',
        startTime: new Date('1970-01-01T17:30:00.000Z'),
        course: { name: 'סטארטאפ AI' },
        branch: { name: 'עומר' },
      },
    ] as any);

    const result = await autoRegisterLeadToCycle({
      ...baseInput,
      cycleId: 'old-cycle-id',
      cycleLabel: 'סטארטאפ AI | כיתות ה׳',
    });

    expect(result).toEqual({
      status: 'invalid_cycle',
      reason: 'cycle_not_found',
      cycleId: 'old-cycle-id',
    });
    expect(mockPrisma.student.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.registration.create).not.toHaveBeenCalled();
  });

  it('does not match an unrelated Omer cycle just because day and time match', async () => {
    mockPrisma.cycle.findFirst.mockResolvedValue(null);
    mockPrisma.cycle.findMany.mockResolvedValue([
      {
        id: 'minecraft-cycle',
        name: 'מיינקראפט - קבוצה 1 - עומר',
        status: 'active',
        defaultRegistrationAmount: null,
        dayOfWeek: 'thursday',
        startTime: new Date('1970-01-01T17:30:00.000Z'),
        course: { name: 'קורס כללי' },
        branch: { name: 'עומר פרונטלי' },
      },
      {
        id: 'ai-cycle',
        name: 'יזמות טכנולוגית ו-AI - עומר',
        status: 'active',
        defaultRegistrationAmount: null,
        dayOfWeek: 'thursday',
        startTime: new Date('1970-01-01T18:30:00.000Z'),
        course: { name: 'קורס כללי' },
        branch: { name: 'עומר פרונטלי' },
      },
    ] as any);

    const result = await autoRegisterLeadToCycle({
      ...baseInput,
      cycleId: 'old-cycle-id',
      cycleLabel: 'יום חמישי | 17:30 | סטארטאפ AI | כיתות ה׳',
      interest: null,
    });

    expect(result).toEqual({
      status: 'invalid_cycle',
      reason: 'cycle_not_found',
      cycleId: 'old-cycle-id',
    });
    expect(mockPrisma.student.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.registration.create).not.toHaveBeenCalled();
  });
});
