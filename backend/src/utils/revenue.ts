/**
 * Revenue helpers — central place to compute meeting revenue from a cycle's
 * registrations, applying the right VAT treatment.
 *
 * B2C cycles (`private` / `trial_private`) are billed gross (the price the
 * parent pays includes 18% VAT). Our actual revenue is the net amount, so
 * we strip VAT before dividing by totalMeetings. Institutional cycles are
 * already net.
 */

export const VAT_RATE = 0.18;

/**
 * Round a money amount to 2 decimal places (agorot). Money must never be
 * rounded to whole shekels — customers can be charged non-round amounts.
 */
export function roundMoney(amount: number): number {
  return Math.round((Number(amount) + Number.EPSILON) * 100) / 100;
}

const PRIVATE_TYPES = new Set(['private', 'trial_private']);
const REVENUE_REGISTRATION_STATUSES = new Set(['registered', 'active', 'completed']);

export function isVatInclusive(cycleType: string | null | undefined): boolean {
  return PRIVATE_TYPES.has(String(cycleType));
}

/**
 * Convert a customer-facing (gross) amount to the net amount we recognize as
 * revenue. For private cycles we divide out the 18% VAT; otherwise the input
 * is already net.
 */
export function netAmount(
  grossAmount: number,
  cycleType: string | null | undefined
): number {
  if (!grossAmount || grossAmount <= 0) return 0;
  return isVatInclusive(cycleType) ? grossAmount / (1 + VAT_RATE) : grossAmount;
}

// Accept Prisma's Decimal alongside number/string — anything we can pass to Number().
type RegistrationLike = {
  amount?: number | string | { toString(): string } | null;
  status?: string | null;
  deletedAt?: Date | string | null;
};

export function isRevenueRegistration(registration: RegistrationLike): boolean {
  if (registration.deletedAt) return false;
  return REVENUE_REGISTRATION_STATUSES.has(String(registration.status || 'registered'));
}

export function revenueRegistrations<T extends RegistrationLike>(registrations: T[]): T[] {
  return registrations.filter(isRevenueRegistration);
}

export function revenueRegistrationCount(registrations: RegistrationLike[]): number {
  return revenueRegistrations(registrations).length;
}

/**
 * Sum revenue-bearing registration amounts and return the net per-meeting revenue.
 * Completed registrations still count because cycle completion marks paid/active
 * children as completed before the last replacement lesson may be recalculated.
 * `totalMeetings` of 0 (or missing) yields 0.
 */
export function meetingRevenueFromRegistrations(
  registrations: RegistrationLike[],
  totalMeetings: number,
  cycleType: string | null | undefined
): number {
  if (!totalMeetings || totalMeetings <= 0) return 0;
  const gross = revenueRegistrations(registrations).reduce(
    (sum, r) => sum + (r.amount ? Number(r.amount) : 0),
    0
  );
  const net = netAmount(gross, cycleType);
  return roundMoney(net / totalMeetings);
}
