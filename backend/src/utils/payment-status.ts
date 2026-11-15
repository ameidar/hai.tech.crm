/**
 * Registration / cycle payment status (Prisma enum `PaymentStatus`).
 *
 * `refunded` ("זוכה") = was paid, then cancelled with a Morning credit note.
 * It is NOT paid: every revenue, paid-total, report and payment-evidence check must
 * use {@link isPaidPaymentStatus} / {@link PAID_PAYMENT_STATUSES} rather than `!== 'unpaid'`.
 */
export const PAYMENT_STATUSES = ['unpaid', 'partial', 'paid', 'refunded'] as const;
export type PaymentStatusValue = (typeof PAYMENT_STATUSES)[number];

/** Statuses that count as money actually received (revenue / payment evidence). */
export const PAID_PAYMENT_STATUSES: PaymentStatusValue[] = ['paid', 'partial'];

export function isPaidPaymentStatus(status: string | null | undefined): boolean {
  return !!status && (PAID_PAYMENT_STATUSES as string[]).includes(status);
}

export const PAYMENT_STATUS_LABELS_HE: Record<PaymentStatusValue, string> = {
  unpaid: 'לא שולם',
  partial: 'חלקי',
  paid: 'שולם',
  refunded: 'זוכה',
};

/**
 * Status values of the free-text `payments.status` column (Payment model).
 * Only `paid` counts as paid; `refunded` = credit note issued after payment.
 */
export const PAYMENT_RECORD_STATUSES = ['pending', 'paid', 'cancelled', 'refunded'] as const;
export type PaymentRecordStatus = (typeof PAYMENT_RECORD_STATUSES)[number];

export function isPaymentRecordStatus(value: unknown): value is PaymentRecordStatus {
  return typeof value === 'string' && (PAYMENT_RECORD_STATUSES as readonly string[]).includes(value);
}
