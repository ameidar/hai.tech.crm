// Company-level fixed monthly costs (e.g. salaried staff) — pure helpers shared by the
// CRUD routes, the Morning financials view and the forecast.
import { isFixedAdditionActiveInMonth } from './instructor-fixed-additions.js';

type DecimalLike = { toString(): string } | number | string;

export interface CompanyFixedCostLike {
  name: string;
  amount: DecimalLike;
  startMonth: Date;
  endMonth: Date | null;
  monthOverrides?: unknown;
  deletedAt?: Date | null;
}

/** Cost of the item in the given "YYYY-MM" month (0 when inactive). Overrides win. */
export function companyFixedCostForMonth(cost: CompanyFixedCostLike, month: string): number {
  if (!isFixedAdditionActiveInMonth(cost, month)) return 0;
  const overrides = cost.monthOverrides;
  if (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) {
    const value = (overrides as Record<string, unknown>)[month];
    if (value !== undefined && value !== null && Number.isFinite(Number(value))) return Number(value);
  }
  return Number(cost.amount.toString());
}
