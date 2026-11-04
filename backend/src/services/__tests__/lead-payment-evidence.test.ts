import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    payment: { findFirst: vi.fn(), findUnique: vi.fn() },
    registration: { findFirst: vi.fn(), findUnique: vi.fn() },
    leadAppointment: { findMany: vi.fn(), update: vi.fn() },
    leadActivity: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from '../../utils/prisma.js';
import {
  AUTO_CONVERT_NOTE,
  CONVERT_WITHOUT_PAYMENT_ERROR,
  OVERRIDE_REASON_REQUIRED_ERROR,
  assertLeadConversionAllowed,
  autoConvertLeadsForCustomer,
  autoConvertLeadsForPayment,
  autoConvertLeadsForRegistration,
  findPaymentEvidence,
  hasPaymentEvidence,
} from '../lead-payment-evidence.js';

const mockPrisma = vi.mocked(prisma) as any;
const lead = {
  customerId: 'cust-1',
  customerPhone: '050-1234567',
  customerEmail: 'Parent@Example.com',
  createdAt: new Date('2026-11-04T10:00:00Z'),
};

describe('lead payment evidence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.payment.findFirst.mockResolvedValue(null);
    mockPrisma.registration.findFirst.mockResolvedValue(null);
    mockPrisma.$transaction.mockImplementation(async (ops: any) => (Array.isArray(ops) ? Promise.all(ops) : ops(mockPrisma)));
  });

  describe('findPaymentEvidence', () => {
    it('accepts a paid payments row matched by customer, phone variants or email, within the lookback window', async () => {
      mockPrisma.payment.findFirst.mockResolvedValue({ id: 'pay-1' });

      await expect(findPaymentEvidence(lead)).resolves.toEqual({ kind: 'payment', id: 'pay-1' });

      const where = mockPrisma.payment.findFirst.mock.calls[0][0].where;
      expect(where.status).toBe('paid');
      expect(where.OR).toEqual(expect.arrayContaining([
        { customerId: 'cust-1' },
        { customerPhone: { in: expect.arrayContaining(['050-1234567', '0501234567', '972501234567']) } },
        { customerEmail: { equals: 'Parent@Example.com', mode: 'insensitive' } },
      ]));
      // 30 days before the lead was created
      const since = new Date('2026-10-05T10:00:00Z');
      expect(where.AND[0].OR).toEqual([
        { paidAt: { gte: since } },
        { paidAt: null, createdAt: { gte: since } },
      ]);
      expect(mockPrisma.registration.findFirst).not.toHaveBeenCalled();
    });

    it('accepts a paid/partial registration of the customer’s student', async () => {
      mockPrisma.registration.findFirst.mockResolvedValueOnce({ id: 'reg-paid' });

      await expect(findPaymentEvidence(lead)).resolves.toEqual({ kind: 'paid_registration', id: 'reg-paid' });
      expect(mockPrisma.registration.findFirst.mock.calls[0][0].where).toEqual(expect.objectContaining({
        deletedAt: null,
        status: { not: 'cancelled' },
        paymentStatus: { in: ['paid', 'partial'] },
        student: { customerId: 'cust-1', deletedAt: null },
      }));
    });

    it('accepts an active registration in an institution-paid cycle (no parent payment expected)', async () => {
      mockPrisma.registration.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'reg-inst' });

      await expect(findPaymentEvidence(lead)).resolves.toEqual({ kind: 'institutional_registration', id: 'reg-inst' });
      expect(mockPrisma.registration.findFirst.mock.calls[1][0].where).toEqual(expect.objectContaining({
        deletedAt: null,
        status: { in: ['registered', 'active'] },
        student: { customerId: 'cust-1', deletedAt: null },
        cycle: { deletedAt: null, type: { in: ['institutional_per_child', 'institutional_fixed'] } },
      }));
    });

    it('returns null when nothing is found', async () => {
      await expect(hasPaymentEvidence(lead)).resolves.toBe(false);
    });

    it('only checks payments by contact when the lead has no customer', async () => {
      await expect(hasPaymentEvidence({ customerPhone: '0501234567' })).resolves.toBe(false);
      expect(mockPrisma.payment.findFirst).toHaveBeenCalledTimes(1);
      expect(mockPrisma.registration.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('assertLeadConversionAllowed', () => {
    it('blocks a sales rep when there is no payment evidence', async () => {
      await expect(assertLeadConversionAllowed({ lead, role: 'sales' })).rejects.toMatchObject({
        statusCode: 409,
        message: CONVERT_WITHOUT_PAYMENT_ERROR,
        data: { code: 'PAYMENT_REQUIRED', suggestedStatus: 'pending_payment', canOverride: false },
      });
    });

    it('ignores an override reason from a non-admin', async () => {
      await expect(
        assertLeadConversionAllowed({ lead, role: 'sales', overrideReason: 'הלקוח הבטיח לשלם' }),
      ).rejects.toMatchObject({ statusCode: 409, message: CONVERT_WITHOUT_PAYMENT_ERROR });
    });

    it('allows conversion when payment evidence exists', async () => {
      mockPrisma.payment.findFirst.mockResolvedValue({ id: 'pay-1' });
      await expect(assertLeadConversionAllowed({ lead, role: 'sales' })).resolves.toEqual({ overrideNote: null });
    });

    it('requires a non-empty reason for an admin/manager override', async () => {
      await expect(
        assertLeadConversionAllowed({ lead, role: 'admin', overrideReason: '   ' }),
      ).rejects.toMatchObject({ statusCode: 409, message: OVERRIDE_REASON_REQUIRED_ERROR, data: expect.objectContaining({ canOverride: true }) });

      await expect(
        assertLeadConversionAllowed({ lead, role: 'manager', overrideReason: 'שולם במזומן לאמי' }),
      ).resolves.toEqual({ overrideNote: 'אישור מנהל לסגירה ללא תשלום: שולם במזומן לאמי' });
    });

    it('does not re-check a lead that is already converted', async () => {
      await expect(
        assertLeadConversionAllowed({ lead: { ...lead, salesStatus: 'converted' }, role: 'sales' }),
      ).resolves.toEqual({ overrideNote: null });
      expect(mockPrisma.payment.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('auto-convert', () => {
    it('converts the customer’s open leads and logs a system activity', async () => {
      mockPrisma.leadAppointment.findMany.mockResolvedValue([{ id: 'lead-1' }, { id: 'lead-2' }]);
      mockPrisma.leadAppointment.update.mockResolvedValue({});
      mockPrisma.leadActivity.create.mockResolvedValue({});

      await expect(autoConvertLeadsForCustomer('cust-1')).resolves.toBe(2);

      expect(mockPrisma.leadAppointment.findMany).toHaveBeenCalledWith({
        where: { customerId: 'cust-1', salesStatus: { notIn: ['converted', 'not_relevant'] } },
        select: { id: true },
      });
      expect(mockPrisma.leadAppointment.update).toHaveBeenCalledWith({
        where: { id: 'lead-1' },
        data: expect.objectContaining({ salesStatus: 'converted', lastContactResult: 'converted' }),
      });
      expect(mockPrisma.leadActivity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ leadAppointmentId: 'lead-2', type: 'system', result: 'converted', note: AUTO_CONVERT_NOTE }),
      });
    });

    it('never throws when the database fails', async () => {
      mockPrisma.leadAppointment.findMany.mockRejectedValue(new Error('db down'));
      await expect(autoConvertLeadsForCustomer('cust-1')).resolves.toBe(0);

      mockPrisma.leadAppointment.findMany.mockResolvedValue([{ id: 'lead-1' }]);
      mockPrisma.$transaction.mockRejectedValue(new Error('tx failed'));
      await expect(autoConvertLeadsForCustomer('cust-1')).resolves.toBe(0);

      mockPrisma.payment.findUnique.mockRejectedValue(new Error('db down'));
      await expect(autoConvertLeadsForPayment('pay-1')).resolves.toBe(0);
    });

    it('only converts for paid payments with a customer', async () => {
      mockPrisma.payment.findUnique.mockResolvedValue({ customerId: 'cust-1', status: 'pending' });
      await expect(autoConvertLeadsForPayment('pay-1')).resolves.toBe(0);
      mockPrisma.payment.findUnique.mockResolvedValue({ customerId: null, status: 'paid' });
      await expect(autoConvertLeadsForPayment('pay-1')).resolves.toBe(0);
      expect(mockPrisma.leadAppointment.findMany).not.toHaveBeenCalled();

      mockPrisma.payment.findUnique.mockResolvedValue({ customerId: 'cust-1', status: 'paid' });
      mockPrisma.leadAppointment.findMany.mockResolvedValue([]);
      await autoConvertLeadsForPayment('pay-1');
      expect(mockPrisma.leadAppointment.findMany).toHaveBeenCalledTimes(1);
    });

    it('converts after a registration is marked paid/partial, not when unpaid or cancelled', async () => {
      mockPrisma.leadAppointment.findMany.mockResolvedValue([]);
      mockPrisma.registration.findUnique.mockResolvedValue({ paymentStatus: 'unpaid', status: 'active', deletedAt: null, student: { customerId: 'cust-1' } });
      await autoConvertLeadsForRegistration('reg-1');
      mockPrisma.registration.findUnique.mockResolvedValue({ paymentStatus: 'paid', status: 'cancelled', deletedAt: null, student: { customerId: 'cust-1' } });
      await autoConvertLeadsForRegistration('reg-1');
      expect(mockPrisma.leadAppointment.findMany).not.toHaveBeenCalled();

      mockPrisma.registration.findUnique.mockResolvedValue({ paymentStatus: 'partial', status: 'active', deletedAt: null, student: { customerId: 'cust-1' } });
      await autoConvertLeadsForRegistration('reg-1');
      expect(mockPrisma.leadAppointment.findMany).toHaveBeenCalledTimes(1);
    });
  });
});
