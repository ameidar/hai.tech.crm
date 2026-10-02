// Instructor fixed monthly additions ("תוספות קבועות") — pure helpers shared by the
// CRUD routes, the monthly salary report and the forecast.
//
// Months are represented as "YYYY-MM" in the API and stored as the first day of the
// month (DATE, UTC midnight). endMonth is inclusive; null = open-ended.

type DecimalLike = { toString(): string } | number | string;

export interface FixedAdditionLike {
  id: string;
  description: string;
  amount: DecimalLike;
  isNet: boolean;
  startMonth: Date;
  endMonth: Date | null;
  deletedAt?: Date | null;
}

export interface FixedAdditionReportItem {
  id: string;
  description: string;
  amount: number;
  isNet: boolean;
  netLabel: 'נטו' | 'ברוטו';
  startMonth: string; // YYYY-MM
  endMonth: string | null; // YYYY-MM
}

/** Employer-cost multiplier for employees — same rule as instructor-payment.ts. */
export const EMPLOYEE_EMPLOYER_COST_MULTIPLIER = 1.3;

export const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "YYYY-MM" → Date at UTC midnight of the first day of that month. */
export function monthToDate(month: string): Date {
  if (!MONTH_REGEX.test(month)) throw new Error(`Invalid month "${month}" (expected YYYY-MM)`);
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1));
}

/** Date → "YYYY-MM" (UTC). */
export function dateToMonth(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Whether the addition applies to the given report month.
 * Active when startMonth <= M and (endMonth is null or endMonth >= M), and not soft-deleted.
 */
export function isFixedAdditionActiveInMonth(
  addition: Pick<FixedAdditionLike, 'startMonth' | 'endMonth' | 'deletedAt'>,
  month: string,
): boolean {
  if (addition.deletedAt) return false;
  const m = dateToMonth(monthToDate(month));
  const start = dateToMonth(addition.startMonth);
  if (start > m) return false;
  if (addition.endMonth && dateToMonth(addition.endMonth) < m) return false;
  return true;
}

/** Prisma `where` fragment selecting additions active in the month starting at `monthStart`. */
export function activeFixedAdditionsWhere(monthStart: Date) {
  return {
    deletedAt: null,
    startMonth: { lte: monthStart },
    OR: [{ endMonth: null }, { endMonth: { gte: monthStart } }],
  };
}

export function toFixedAdditionReportItem(a: FixedAdditionLike): FixedAdditionReportItem {
  return {
    id: a.id,
    description: a.description,
    amount: Number(a.amount.toString()),
    isNet: a.isNet,
    netLabel: a.isNet ? 'נטו' : 'ברוטו',
    startMonth: dateToMonth(a.startMonth),
    endMonth: a.endMonth ? dateToMonth(a.endMonth) : null,
  };
}

/**
 * Monthly *cost* of an addition to the company (forecast / profit).
 * Gross (ברוטו) amounts for employees carry the 1.3 employer-cost multiplier, same as
 * meeting pay. Net (נטו) amounts are counted as-is (we do not try to gross them up).
 */
export function fixedAdditionMonthlyCost(
  addition: Pick<FixedAdditionLike, 'amount' | 'isNet'>,
  employmentType: string | null | undefined,
): number {
  const amount = Number(addition.amount.toString());
  if (!addition.isNet && employmentType === 'employee') {
    return Math.round(amount * EMPLOYEE_EMPLOYER_COST_MULTIPLIER);
  }
  return amount;
}
