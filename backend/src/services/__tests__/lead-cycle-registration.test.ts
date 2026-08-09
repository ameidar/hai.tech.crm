import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    cycle: {
      findFirst: vi.fn(),
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
  });

  it('creates an unpaid registration for a valid Omer form lead', async () => {
    mockPrisma.cycle.findFirst.mockResolvedValue({
      id: 'cycle-1',
      name: 'עומר - מיינקראפט כיתה ג׳',
      status: 'active',
      pricePerStudent: 3200,
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
      pricePerStudent: null,
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
      pricePerStudent: 3200,
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
      pricePerStudent: 3200,
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
});
