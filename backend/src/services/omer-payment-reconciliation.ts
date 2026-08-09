import { prisma } from '../utils/prisma.js';
import { recalcMeetingRevenue } from '../utils/recalcMeetingRevenue.js';

const OMER_REGISTRATION_SOURCE = 'omer-dafna-registration-form';

export type OmerPaymentReconciliationStatus =
  | 'updated'
  | 'skipped';

export interface OmerPaymentReconciliationResult {
  status: OmerPaymentReconciliationStatus;
  reason?: string;
  registrationId?: string;
  paymentStatus?: 'paid' | 'partial';
}

function positiveAmount(value: unknown): number | null {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/**
 * Connect a paid payment to a single unpaid Omer auto-registration when the
 * customer has exactly one obvious match. Ambiguous cases intentionally stay
 * manual so a payment is never applied to the wrong child/cycle.
 */
export async function reconcileOmerRegistrationPayment(paymentId: string): Promise<OmerPaymentReconciliationResult> {
  try {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        customerId: true,
        amount: true,
        status: true,
      },
    });

    if (!payment) return { status: 'skipped', reason: 'payment_not_found' };
    if (payment.status !== 'paid') return { status: 'skipped', reason: 'payment_not_paid' };
    if (!payment.customerId) return { status: 'skipped', reason: 'missing_customer' };

    const paidAmount = positiveAmount(payment.amount);
    if (!paidAmount) return { status: 'skipped', reason: 'invalid_amount' };

    const registrations = await prisma.registration.findMany({
      where: {
        deletedAt: null,
        status: { in: ['registered', 'active'] },
        OR: [
          { paymentStatus: { in: ['unpaid', 'partial'] } },
          { paymentStatus: null },
        ],
        notes: { contains: OMER_REGISTRATION_SOURCE },
        student: {
          deletedAt: null,
          customerId: payment.customerId,
        },
        cycle: {
          deletedAt: null,
          status: 'active',
        },
      },
      select: {
        id: true,
        cycleId: true,
        amount: true,
        cycle: {
          select: { pricePerStudent: true },
        },
      },
    });

    if (registrations.length === 0) return { status: 'skipped', reason: 'no_matching_registration' };
    if (registrations.length > 1) return { status: 'skipped', reason: 'ambiguous_registrations' };

    const registration = registrations[0];
    const expectedAmount = positiveAmount(registration.amount) ?? positiveAmount(registration.cycle.pricePerStudent);
    if (!expectedAmount) return { status: 'skipped', reason: 'missing_expected_amount' };

    const nextPaymentStatus = paidAmount >= expectedAmount ? 'paid' : 'partial';

    await prisma.registration.update({
      where: { id: registration.id },
      data: {
        amount: expectedAmount,
        paymentStatus: nextPaymentStatus,
      },
    });

    recalcMeetingRevenue(registration.cycleId)
      .catch(err => console.error('[omer-payment-reconciliation] failed to recalculate cycle revenue:', err));

    return {
      status: 'updated',
      registrationId: registration.id,
      paymentStatus: nextPaymentStatus,
    };
  } catch (error) {
    console.error('[omer-payment-reconciliation] failed:', error);
    return { status: 'skipped', reason: 'error' };
  }
}
