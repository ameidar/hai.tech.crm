import { prisma } from './prisma.js';

export function positiveMoneyOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

export function defaultRegistrationAmountForCycle(cycle: { defaultRegistrationAmount?: unknown } | null | undefined): number | null {
  return positiveMoneyOrNull(cycle?.defaultRegistrationAmount);
}

export function resolveRegistrationAmount(
  requestedAmount: unknown,
  cycle: { defaultRegistrationAmount?: unknown } | null | undefined,
): number | null {
  return positiveMoneyOrNull(requestedAmount) ?? defaultRegistrationAmountForCycle(cycle);
}

export async function resolveRegistrationAmountForCycle(
  cycleId: string,
  requestedAmount: unknown,
): Promise<number | null> {
  const requested = positiveMoneyOrNull(requestedAmount);
  if (requested !== null) return requested;

  const cycle = await prisma.cycle.findUnique({
    where: { id: cycleId },
    select: { defaultRegistrationAmount: true },
  });

  return defaultRegistrationAmountForCycle(cycle);
}
