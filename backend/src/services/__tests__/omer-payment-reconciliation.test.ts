import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    payment: {
      findUnique: vi.fn(),
    },
    registration: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../../utils/recalcMeetingRevenue.js', () => ({
  recalcMeetingRevenue: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from '../../utils/prisma.js';
import { recalcMeetingRevenue } from '../../utils/recalcMeetingRevenue.js';
import { reconcileOmerRegistrationPayment } from '../omer-payment-reconciliation.js';

const mockPrisma = vi.mocked(prisma);
const mockRecalc = vi.mocked(recalcMeetingRevenue);

describe('reconcileOmerRegistrationPayment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks a single matching Omer registration paid when the payment covers the amount', async () => {
    mockPrisma.payment.findUnique.mockResolvedValue({
      id: 'payment-1',
      customerId: 'customer-1',
      amount: 2980,
      status: 'paid',
    } as any);
    mockPrisma.registration.findMany.mockResolvedValue([
      { id: 'registration-1', cycleId: 'cycle-1', amount: 2980, cycle: { defaultRegistrationAmount: 2980 } },
    ] as any);

    const result = await reconcileOmerRegistrationPayment('payment-1');

    expect(result).toEqual({
      status: 'updated',
      registrationId: 'registration-1',
      paymentStatus: 'paid',
    });
    expect(mockPrisma.registration.update).toHaveBeenCalledWith({
      where: { id: 'registration-1' },
      data: {
        amount: 2980,
        paymentStatus: 'paid',
      },
    });
    expect(mockRecalc).toHaveBeenCalledWith('cycle-1');
  });

  it('marks a single matching Omer registration partial when the payment is below the amount', async () => {
    mockPrisma.payment.findUnique.mockResolvedValue({
      id: 'payment-1',
      customerId: 'customer-1',
      amount: 1000,
      status: 'paid',
    } as any);
    mockPrisma.registration.findMany.mockResolvedValue([
      { id: 'registration-1', cycleId: 'cycle-1', amount: 2980, cycle: { defaultRegistrationAmount: 2980 } },
    ] as any);

    const result = await reconcileOmerRegistrationPayment('payment-1');

    expect(result.paymentStatus).toBe('partial');
    expect(mockPrisma.registration.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ paymentStatus: 'partial' }),
    }));
  });

  it('uses the cycle default registration amount for older registrations without amount', async () => {
    mockPrisma.payment.findUnique.mockResolvedValue({
      id: 'payment-1',
      customerId: 'customer-1',
      amount: 2980,
      status: 'paid',
    } as any);
    mockPrisma.registration.findMany.mockResolvedValue([
      { id: 'registration-1', cycleId: 'cycle-1', amount: null, cycle: { defaultRegistrationAmount: 2980 } },
    ] as any);

    await reconcileOmerRegistrationPayment('payment-1');

    expect(mockPrisma.registration.update).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        amount: 2980,
        paymentStatus: 'paid',
      },
    }));
  });

  it('skips ambiguous customers with more than one open Omer registration', async () => {
    mockPrisma.payment.findUnique.mockResolvedValue({
      id: 'payment-1',
      customerId: 'customer-1',
      amount: 2980,
      status: 'paid',
    } as any);
    mockPrisma.registration.findMany.mockResolvedValue([
      { id: 'registration-1', cycleId: 'cycle-1', amount: 2980, cycle: { defaultRegistrationAmount: 2980 } },
      { id: 'registration-2', cycleId: 'cycle-2', amount: 2980, cycle: { defaultRegistrationAmount: 2980 } },
    ] as any);

    const result = await reconcileOmerRegistrationPayment('payment-1');

    expect(result).toEqual({ status: 'skipped', reason: 'ambiguous_registrations' });
    expect(mockPrisma.registration.update).not.toHaveBeenCalled();
    expect(mockRecalc).not.toHaveBeenCalled();
  });
});
