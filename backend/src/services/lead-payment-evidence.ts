import { prisma } from '../utils/prisma.js';
import { AppError } from '../middleware/errorHandler.js';

/**
 * A lead may only be marked "נסגר להרשמה" (salesStatus/result = 'converted') when the
 * CRM holds real evidence that the customer paid (or is placed in an institution-paid
 * cycle). Otherwise the rep should use 'pending_payment' ("נרשם – ממתין לתשלום"), or an
 * admin/manager may override with an explicit reason.
 */

export const CONVERTED_STATUS = 'converted';
export const PENDING_PAYMENT_STATUS = 'pending_payment';
const CLOSED_SALES_STATUSES = [CONVERTED_STATUS, 'not_relevant'];
const OVERRIDE_ROLES = new Set(['admin', 'manager']);

/** Evidence must be no older than this many days before the lead was created. */
export const EVIDENCE_LOOKBACK_DAYS = 30;

export const CONVERT_WITHOUT_PAYMENT_ERROR =
  "אי אפשר לסמן 'נסגר להרשמה' בלי תשלום במערכת. סמן 'נרשם – ממתין לתשלום' או בקש אישור מנהל";
export const OVERRIDE_REASON_REQUIRED_ERROR =
  "אין תשלום במערכת – כדי לסמן 'נסגר להרשמה' יש למלא סיבת אישור מנהל";
export const AUTO_CONVERT_NOTE = 'נסגר אוטומטית – נמצא תשלום';

export type PaymentEvidenceKind = 'payment' | 'paid_registration' | 'institutional_registration';

export interface PaymentEvidence {
  kind: PaymentEvidenceKind;
  id: string;
}

export interface LeadForEvidence {
  customerId?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  createdAt?: Date | string | null;
}

function phoneVariants(phone?: string | null): string[] {
  const raw = phone?.trim();
  if (!raw) return [];
  const digits = raw.replace(/\D/g, '');
  const variants = new Set<string>([raw]);
  if (digits.length >= 7) {
    variants.add(digits);
    if (digits.startsWith('972')) variants.add(`0${digits.slice(3)}`);
    if (digits.startsWith('0')) variants.add(`972${digits.slice(1)}`);
  }
  return [...variants];
}

function evidenceWindowStart(lead: LeadForEvidence): Date {
  const base = lead.createdAt ? new Date(lead.createdAt) : new Date();
  const baseMs = Number.isNaN(base.getTime()) ? Date.now() : base.getTime();
  return new Date(baseMs - EVIDENCE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Returns the first piece of payment evidence found for the lead's customer, or null.
 *
 * Evidence (any of), all no older than EVIDENCE_LOOKBACK_DAYS before the lead was created:
 *  1. payments row with status='paid' for the customer (by customer_id, or by the lead's
 *     phone/email when the payment isn't linked) — covers manual payments, Morning
 *     webhook/receipt sync, payment links and WooCommerce/LMS website purchases.
 *  2. a non-deleted, non-cancelled registration of one of the customer's students whose
 *     payment_status is 'paid' or 'partial'.
 *  3. a non-deleted registration (status registered/active) of one of the customer's
 *     students in an institution-paid cycle (type institutional_per_child / institutional_fixed).
 */
export async function findPaymentEvidence(lead: LeadForEvidence): Promise<PaymentEvidence | null> {
  const since = evidenceWindowStart(lead);
  const customerId = lead.customerId?.trim() || null;

  const paymentOr: any[] = [];
  if (customerId) paymentOr.push({ customerId });
  const phones = phoneVariants(lead.customerPhone);
  if (phones.length) paymentOr.push({ customerPhone: { in: phones } });
  const email = lead.customerEmail?.trim();
  if (email) paymentOr.push({ customerEmail: { equals: email, mode: 'insensitive' } });

  if (paymentOr.length) {
    const payment = await prisma.payment.findFirst({
      where: {
        status: 'paid',
        OR: paymentOr,
        AND: [{ OR: [{ paidAt: { gte: since } }, { paidAt: null, createdAt: { gte: since } }] }],
      },
      select: { id: true },
    });
    if (payment) return { kind: 'payment', id: payment.id };
  }

  if (!customerId) return null;

  const paidRegistration = await prisma.registration.findFirst({
    where: {
      deletedAt: null,
      status: { not: 'cancelled' },
      paymentStatus: { in: ['paid', 'partial'] },
      updatedAt: { gte: since },
      student: { customerId, deletedAt: null },
    },
    select: { id: true },
  });
  if (paidRegistration) return { kind: 'paid_registration', id: paidRegistration.id };

  const institutionalRegistration = await prisma.registration.findFirst({
    where: {
      deletedAt: null,
      status: { in: ['registered', 'active'] },
      createdAt: { gte: since },
      student: { customerId, deletedAt: null },
      cycle: { deletedAt: null, type: { in: ['institutional_per_child', 'institutional_fixed'] } },
    },
    select: { id: true },
  });
  if (institutionalRegistration) return { kind: 'institutional_registration', id: institutionalRegistration.id };

  return null;
}

export async function hasPaymentEvidence(lead: LeadForEvidence): Promise<boolean> {
  return (await findPaymentEvidence(lead)) !== null;
}

export function isConvertRequest(input: { salesStatus?: unknown; result?: unknown }) {
  return input.salesStatus === CONVERTED_STATUS || input.result === CONVERTED_STATUS;
}

export function canOverrideConversion(role?: string | null) {
  return !!role && OVERRIDE_ROLES.has(role);
}

/**
 * Throws 409 unless the lead may become 'converted'. Returns the note to record on the
 * lead activity when an admin/manager overrode the missing payment (otherwise null).
 */
export async function assertLeadConversionAllowed(params: {
  lead: LeadForEvidence & { salesStatus?: string | null };
  role?: string | null;
  overrideReason?: unknown;
}): Promise<{ overrideNote: string | null }> {
  const { lead, role } = params;
  // Re-saving an already-converted lead (e.g. adding a note) is not a new conversion.
  if (lead.salesStatus === CONVERTED_STATUS) return { overrideNote: null };

  if (await hasPaymentEvidence(lead)) return { overrideNote: null };

  const canOverride = canOverrideConversion(role);
  const reason = typeof params.overrideReason === 'string' ? params.overrideReason.trim() : '';
  if (canOverride && reason) {
    return { overrideNote: `אישור מנהל לסגירה ללא תשלום: ${reason}` };
  }

  throw new AppError(409, canOverride ? OVERRIDE_REASON_REQUIRED_ERROR : CONVERT_WITHOUT_PAYMENT_ERROR, {
    code: 'PAYMENT_REQUIRED',
    suggestedStatus: PENDING_PAYMENT_STATUS,
    canOverride,
  });
}

/**
 * Best-effort: when a payment is recorded for a customer, close their open leads as
 * converted and log an activity. Never throws — the payment flow must not fail on this.
 */
export async function autoConvertLeadsForCustomer(customerId?: string | null): Promise<number> {
  if (!customerId) return 0;
  try {
    const openLeads = await prisma.leadAppointment.findMany({
      where: { customerId, salesStatus: { notIn: CLOSED_SALES_STATUSES } },
      select: { id: true },
    });
    let converted = 0;
    for (const lead of openLeads) {
      try {
        await prisma.$transaction([
          prisma.leadAppointment.update({
            where: { id: lead.id },
            data: { salesStatus: CONVERTED_STATUS, lastContactResult: CONVERTED_STATUS, lastContactedAt: new Date() },
          }),
          prisma.leadActivity.create({
            data: {
              leadAppointmentId: lead.id,
              userId: null,
              type: 'system',
              result: CONVERTED_STATUS,
              note: AUTO_CONVERT_NOTE,
            },
          }),
        ]);
        converted += 1;
      } catch (err) {
        console.error(`[lead-payment-evidence] auto-convert failed for lead ${lead.id}:`, err);
      }
    }
    if (converted) console.log(`[lead-payment-evidence] auto-converted ${converted} lead(s) for customer ${customerId}`);
    return converted;
  } catch (err) {
    console.error(`[lead-payment-evidence] auto-convert lookup failed for customer ${customerId}:`, err);
    return 0;
  }
}

/** Best-effort auto-convert after a payments row is recorded as paid. Never throws. */
export async function autoConvertLeadsForPayment(paymentId?: string | null): Promise<number> {
  if (!paymentId) return 0;
  try {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      select: { customerId: true, status: true },
    });
    if (!payment || payment.status !== 'paid') return 0;
    return await autoConvertLeadsForCustomer(payment.customerId);
  } catch (err) {
    console.error(`[lead-payment-evidence] auto-convert failed for payment ${paymentId}:`, err);
    return 0;
  }
}

/** Best-effort auto-convert after a registration is marked paid/partial. Never throws. */
export async function autoConvertLeadsForRegistration(registrationId?: string | null): Promise<number> {
  if (!registrationId) return 0;
  try {
    const registration = await prisma.registration.findUnique({
      where: { id: registrationId },
      select: { paymentStatus: true, status: true, deletedAt: true, student: { select: { customerId: true } } },
    });
    if (
      !registration ||
      registration.deletedAt ||
      registration.status === 'cancelled' ||
      (registration.paymentStatus !== 'paid' && registration.paymentStatus !== 'partial')
    ) {
      return 0;
    }
    return await autoConvertLeadsForCustomer(registration.student?.customerId);
  } catch (err) {
    console.error(`[lead-payment-evidence] auto-convert failed for registration ${registrationId}:`, err);
    return 0;
  }
}
