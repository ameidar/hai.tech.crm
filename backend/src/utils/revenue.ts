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

const PRIVATE_TYPES = new Set(['private', 'trial_private']);

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
type RegistrationLike = { amount?: number | string | { toString(): string } | null };

/**
 * Sum active registration amounts and return the net per-meeting revenue.
 * `totalMeetings` of 0 (or missing) yields 0.
 */
export function meetingRevenueFromRegistrations(
  registrations: RegistrationLike[],
  totalMeetings: number,
  cycleType: string | null | undefined
): number {
  if (!totalMeetings || totalMeetings <= 0) return 0;
  const gross = registrations.reduce(
    (sum, r) => sum + (r.amount ? Number(r.amount) : 0),
    0
  );
  const net = netAmount(gross, cycleType);
  return Math.round(net / totalMeetings);
}
