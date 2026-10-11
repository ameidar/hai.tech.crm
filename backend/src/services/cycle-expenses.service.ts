// Cycle expenses (הוצאות מחזור) — shared business logic for the internal CRM route
// (/api/expenses/cycle...) and the v1 ops API (/api/v1/cycles/:id/expenses...).
// Moved from routes/expenses.ts so validation, calculation and audit stay identical.
//
// v1.63.0 adds automatic calculation for "percentage of net revenue" expenses
// (isPercentage=true, rateType='net_revenue_percentage' — e.g. brokerage commission
// "עמלת תיווך 20% מהכנסה נטו ללא מע״מ"):
//
//   amount = round2(percentage / 100 × SUM(meeting.revenue))
//            over the cycle's meetings with deletedAt IS NULL and status NOT IN (cancelled, postponed)
//
// meeting.revenue is already net of VAT. The amount is recalculated on create/update of the
// expense (client-provided amount is ignored), via POST /api/v1/cycles/:id/expenses/recalculate,
// and automatically after every write path that changes a meeting's revenue/status/existence
// (see recalcPercentageExpensesSafe call sites). Other expenses — fixed amounts, hours×rate and
// legacy percentage rows without rateType — are never touched by the recalculation.

import type { Request } from 'express';
import { prisma } from '../utils/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { logAudit } from '../utils/audit.js';
import { actorUserId } from '../utils/request-actor.js';
import { roundMoney } from '../utils/revenue.js';

export const NET_REVENUE_PERCENTAGE_RATE_TYPE = 'net_revenue_percentage';

/** Meetings with these statuses don't generate revenue and are excluded from the base. */
export const NON_REVENUE_MEETING_STATUSES = ['cancelled', 'postponed'] as const;

export const CYCLE_EXPENSE_TYPES = [
  'materials',
  'wraparound_hours',
  'equipment',
  'travel_fixed',
  'additional_instructor',
  'other',
] as const;

export function isNetRevenuePercentageExpense(e: { isPercentage?: boolean | null; rateType?: string | null }): boolean {
  return Boolean(e.isPercentage) && e.rateType === NET_REVENUE_PERCENTAGE_RATE_TYPE;
}

/** SUM(revenue) of the cycle's revenue-generating meetings (net of VAT). */
export async function computeCycleNetRevenue(cycleId: string): Promise<number> {
  const agg = await prisma.meeting.aggregate({
    where: {
      cycleId,
      deletedAt: null,
      status: { notIn: [...NON_REVENUE_MEETING_STATUSES] },
    },
    _sum: { revenue: true },
  });
  return roundMoney(Number(agg?._sum?.revenue ?? 0));
}

export function percentageAmount(percentage: unknown, netRevenue: number): number {
  return roundMoney((Number(percentage ?? 0) / 100) * netRevenue);
}

export interface PercentageRecalcResult {
  cycleId: string;
  netRevenue: number;
  dryRun: boolean;
  expenses: Array<{
    id: string;
    description: string | null;
    percentage: number;
    status: string;
    oldAmount: number | null;
    newAmount: number;
    changed: boolean;
  }>;
  updated: number;
}

/**
 * Recalculate every net-revenue-percentage expense of a cycle. Cheap when the cycle has none
 * (one indexed query). Approval status is NOT reset — the rule was approved, only the base moved.
 * Writes an audit row per changed expense.
 */
export async function recalculatePercentageCycleExpenses(
  cycleId: string,
  opts: { source?: string; req?: Request; dryRun?: boolean } = {}
): Promise<PercentageRecalcResult> {
  const dryRun = Boolean(opts.dryRun);
  const rows = await prisma.cycleExpense.findMany({
    where: { cycleId, isPercentage: true, rateType: NET_REVENUE_PERCENTAGE_RATE_TYPE },
    select: { id: true, description: true, percentage: true, amount: true, status: true },
  });
  if (!rows || rows.length === 0) {
    return { cycleId, netRevenue: 0, dryRun, expenses: [], updated: 0 };
  }

  const netRevenue = await computeCycleNetRevenue(cycleId);
  const result: PercentageRecalcResult = { cycleId, netRevenue, dryRun, expenses: [], updated: 0 };

  for (const row of rows) {
    const oldAmount = row.amount === null || row.amount === undefined ? null : Number(row.amount);
    const newAmount = percentageAmount(row.percentage, netRevenue);
    const changed = oldAmount === null || Math.abs(oldAmount - newAmount) >= 0.005;
    result.expenses.push({
      id: row.id,
      description: row.description ?? null,
      percentage: Number(row.percentage ?? 0),
      status: String(row.status),
      oldAmount,
      newAmount,
      changed,
    });
    if (!changed || dryRun) continue;

    await prisma.cycleExpense.update({
      where: { id: row.id },
      data: { amount: newAmount, updatedAt: new Date() },
    });
    result.updated++;
    await logAudit({
      action: 'UPDATE',
      entity: 'CycleExpense',
      entityId: row.id,
      userName: opts.req ? undefined : 'system:auto-recalc',
      oldValue: { amount: oldAmount },
      newValue: { amount: newAmount, netRevenue, percentage: Number(row.percentage ?? 0), trigger: opts.source ?? 'recalculate' },
      req: opts.req,
    });
  }

  if (result.updated > 0) {
    console.log(`[cycle-expenses] ${opts.source ?? 'recalculate'}: cycle ${cycleId} netRevenue=${netRevenue} → ${result.updated} percentage expense(s) updated`);
  }
  return result;
}

/**
 * Non-fatal wrapper for the meeting write paths: recalculates the percentage expenses of the
 * given cycle(s) and only logs on error, so the main request never fails because of it.
 */
export async function recalcPercentageExpensesSafe(
  cycleIds: string | null | undefined | Iterable<string | null | undefined>,
  source: string,
  req?: Request
): Promise<void> {
  const ids = new Set<string>();
  if (typeof cycleIds === 'string') ids.add(cycleIds);
  else if (cycleIds) for (const id of cycleIds) if (id) ids.add(id);
  for (const cycleId of ids) {
    try {
      await recalculatePercentageCycleExpenses(cycleId, { source, req });
    } catch (err) {
      console.error(`[cycle-expenses] percentage recalculation failed for cycle ${cycleId} (${source}):`, err);
    }
  }
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

const expenseInclude = {
  instructor: {
    select: { id: true, name: true, ratePreparation: true, rateOnline: true, rateFrontal: true, employmentType: true },
  },
  reviewedBy: { select: { id: true, name: true } },
} as const;

export async function listCycleExpenses(cycleId: string) {
  return prisma.cycleExpense.findMany({
    where: { cycleId },
    orderBy: { createdAt: 'desc' },
    include: expenseInclude,
  });
}

export async function getCycleExpenseOr404(expenseId: string, cycleId?: string) {
  const existing = await prisma.cycleExpense.findUnique({ where: { id: expenseId } });
  if (!existing || (cycleId && existing.cycleId !== cycleId)) {
    throw new AppError(404, 'Expense not found');
  }
  return existing;
}

interface ExpenseInput {
  type?: string;
  description?: string | null;
  amount?: unknown;
  instructorId?: string | null;
  isPercentage?: boolean;
  percentage?: unknown;
  hours?: unknown;
  rateType?: string | null;
  paymentDate?: unknown;
}

function parsePaymentDate(paymentDate: unknown): Date {
  // Payment date is required — it determines which month the expense is paid in
  const parsed = paymentDate ? new Date(paymentDate as string) : null;
  if (!parsed || isNaN(parsed.getTime())) {
    throw new AppError(400, 'תאריך תשלום הוא שדה חובה');
  }
  return parsed;
}

/** hours × instructor rate (× 1.3 employer cost for employees) for materials / wraparound hours. */
async function hourlyAmount(instructorId: string, hours: unknown, rateType: string): Promise<number> {
  const instructor = await prisma.instructor.findUnique({
    where: { id: instructorId },
    select: { ratePreparation: true, rateOnline: true, rateFrontal: true, employmentType: true },
  });
  if (!instructor) throw new AppError(404, 'Instructor not found');

  let rate = 0;
  switch (rateType) {
    case 'preparation': rate = Number(instructor.ratePreparation || 0); break;
    case 'online': rate = Number(instructor.rateOnline || 0); break;
    case 'frontal': rate = Number(instructor.rateFrontal || 0); break;
  }
  let amount = Number(hours) * rate;
  // Apply employer cost multiplier (1.3) for employees
  if (instructor.employmentType === 'employee') amount *= 1.3;
  return amount;
}

function assertType(type: unknown): asserts type is string {
  if (!type || !(CYCLE_EXPENSE_TYPES as readonly string[]).includes(String(type))) {
    throw new AppError(400, `type must be one of: ${CYCLE_EXPENSE_TYPES.join(', ')}`);
  }
}

function assertNetRevenuePercentage(input: ExpenseInput) {
  if (isNetRevenuePercentageExpense(input) && !(Number(input.percentage) > 0 && Number(input.percentage) <= 100)) {
    throw new AppError(400, 'Percentage must be greater than 0 and at most 100');
  }
}

async function applyReview(
  id: string,
  status: unknown,
  rejectionReason: unknown,
  req?: Request,
  oldStatus?: string
) {
  if (status !== 'approved' && status !== 'rejected') {
    throw new AppError(400, 'status must be "approved" or "rejected"');
  }
  const reviewerId = actorUserId(req) ?? null;
  const updated = await prisma.cycleExpense.update({
    where: { id },
    data: {
      status,
      reviewedById: reviewerId,
      reviewedAt: new Date(),
      rejectionReason: status === 'rejected' ? ((rejectionReason as string) || null) : null,
    },
    include: expenseInclude,
  });
  await logAudit({
    action: 'UPDATE',
    entity: 'CycleExpense',
    entityId: id,
    oldValue: { status: oldStatus },
    newValue: { status },
    req,
  });
  return updated;
}

/**
 * Create a cycle expense. Same rules as the CRM UI:
 * - type + paymentDate required
 * - materials / wraparound_hours with hours + instructorId + rateType → hours × rate (× 1.3 employee)
 * - isPercentage → percentage > 0; amount is NULL (legacy, computed client-side) unless
 *   rateType = net_revenue_percentage → amount = percentage × cycle net revenue (auto)
 * - otherwise amount > 0
 * New expenses are pending. `status: 'approved' | 'rejected'` (v1 only — `allowStatus`) runs
 * the same review step right after creation, attributed to the same actor.
 */
export async function createCycleExpense(
  cycleId: string,
  body: ExpenseInput & { status?: unknown; rejectionReason?: unknown },
  req?: Request,
  opts: { allowStatus?: boolean } = {}
) {
  const { type, description, amount, instructorId, isPercentage, percentage, hours, rateType, paymentDate } = body ?? {};

  if (!cycleId || !type) {
    throw new AppError(400, 'Missing required fields');
  }
  assertType(type);
  const parsedPaymentDate = parsePaymentDate(paymentDate);

  const wantsStatus = opts.allowStatus && body?.status !== undefined && body.status !== 'pending';
  if (wantsStatus && body.status !== 'approved' && body.status !== 'rejected') {
    throw new AppError(400, 'status must be "pending", "approved" or "rejected"');
  }

  let calculatedAmount: number | null = amount ? Number(amount) : null;

  if ((type === 'materials' || type === 'wraparound_hours') && hours && instructorId && rateType) {
    calculatedAmount = await hourlyAmount(instructorId, hours, rateType);
  } else if (isPercentage) {
    if (!percentage || Number(percentage) <= 0) {
      throw new AppError(400, 'Percentage must be greater than 0');
    }
    assertNetRevenuePercentage(body);
    calculatedAmount = null;
  } else if (!calculatedAmount || calculatedAmount <= 0) {
    throw new AppError(400, 'Amount must be greater than 0');
  }

  const cycle = await prisma.cycle.findUnique({ where: { id: cycleId }, select: { id: true } });
  if (!cycle) throw new AppError(404, 'Cycle not found');

  const netRevenuePct = isNetRevenuePercentageExpense({ isPercentage, rateType });
  if (netRevenuePct) {
    calculatedAmount = percentageAmount(percentage, await computeCycleNetRevenue(cycleId));
  }

  let expense = await prisma.cycleExpense.create({
    data: {
      cycleId,
      type: type as any,
      description,
      amount: isPercentage && !netRevenuePct ? null : calculatedAmount,
      isPercentage: isPercentage || false,
      percentage: isPercentage ? Number(percentage) : null,
      hours: hours ? Number(hours) : null,
      rateType: rateType || null,
      paymentDate: parsedPaymentDate,
      createdById: actorUserId(req) ?? null,
      instructorId: instructorId || null,
    },
    include: expenseInclude,
  });

  await logAudit({
    action: 'CREATE',
    entity: 'CycleExpense',
    entityId: expense.id,
    newValue: { cycleId, type, amount: expense.amount, description, ...(netRevenuePct && { percentage: Number(percentage), rateType }) },
    req,
  });

  if (wantsStatus) {
    expense = await applyReview(expense.id, body.status, body.rejectionReason, req, expense.status);
  }
  return expense;
}

/**
 * Update a cycle expense. Same rules as the CRM UI (full replace; editing resets approval to
 * pending). With `partial` (v1 PUT) missing fields keep their current value before the same
 * validation runs. A net_revenue_percentage row edited without a rateType (the UI edit form
 * only sends rateType for hourly rows) keeps its rateType instead of silently becoming a
 * legacy percentage row with amount NULL.
 */
export async function updateCycleExpense(
  id: string,
  input: ExpenseInput,
  req?: Request,
  opts: { cycleId?: string; partial?: boolean } = {}
) {
  const existing = await getCycleExpenseOr404(id, opts.cycleId);
  const body: ExpenseInput = { ...(input ?? {}) };

  if (opts.partial) {
    const keep = <K extends keyof ExpenseInput>(k: K, v: ExpenseInput[K]) => {
      if (body[k] === undefined) body[k] = v;
    };
    keep('type', existing.type);
    keep('description', existing.description);
    keep('instructorId', existing.instructorId);
    keep('isPercentage', existing.isPercentage);
    keep('percentage', existing.percentage === null ? undefined : Number(existing.percentage));
    keep('hours', existing.hours === null ? undefined : Number(existing.hours));
    keep('rateType', existing.rateType);
    keep('paymentDate', existing.paymentDate ?? undefined);
    keep('amount', existing.amount === null ? undefined : Number(existing.amount));
  }
  if (body.isPercentage && body.rateType === undefined && existing.rateType === NET_REVENUE_PERCENTAGE_RATE_TYPE) {
    body.rateType = existing.rateType;
  }

  const { type, description, amount, instructorId, isPercentage, percentage, hours, rateType, paymentDate } = body;
  if (opts.partial) assertType(type);
  const parsedPaymentDate = parsePaymentDate(paymentDate);

  let calculatedAmount: number | null = amount ? Number(amount) : null;

  if ((type === 'materials' || type === 'wraparound_hours') && hours && instructorId && rateType) {
    calculatedAmount = await hourlyAmount(instructorId, hours, rateType);
  } else if (isPercentage) {
    assertNetRevenuePercentage(body);
    calculatedAmount = null;
  }

  const netRevenuePct = isNetRevenuePercentageExpense({ isPercentage, rateType });
  if (netRevenuePct) {
    calculatedAmount = percentageAmount(percentage, await computeCycleNetRevenue(existing.cycleId));
  }

  const updated = await prisma.cycleExpense.update({
    where: { id },
    data: {
      type: type as any,
      description: description || null,
      amount: isPercentage && !netRevenuePct ? null : calculatedAmount,
      isPercentage: isPercentage || false,
      percentage: isPercentage ? Number(percentage) : null,
      hours: hours ? Number(hours) : null,
      rateType: rateType || null,
      paymentDate: parsedPaymentDate,
      updatedAt: new Date(),
      // Editing an expense invalidates any prior approval — back to pending
      status: 'pending',
      reviewedById: null,
      reviewedAt: null,
      rejectionReason: null,
      instructorId: instructorId || null,
    },
    include: expenseInclude,
  });

  await logAudit({
    action: 'UPDATE',
    entity: 'CycleExpense',
    entityId: id,
    oldValue: { type: existing.type, amount: existing.amount, status: existing.status },
    newValue: { type, amount: updated.amount },
    req,
  });
  return updated;
}

/** Approve / reject (admin or manager in the UI; write:cycle_expenses for API keys). */
export async function reviewCycleExpense(
  id: string,
  body: { status?: unknown; rejectionReason?: unknown },
  req?: Request,
  opts: { cycleId?: string } = {}
) {
  const { status, rejectionReason } = body ?? {};
  if (status !== 'approved' && status !== 'rejected') {
    throw new AppError(400, 'status must be "approved" or "rejected"');
  }
  const existing = await getCycleExpenseOr404(id, opts.cycleId);
  return applyReview(id, status, rejectionReason, req, existing.status);
}

/**
 * v1 PUT: field edits (same rules as the UI edit → back to pending) and/or a review
 * (`status: approved|rejected`, optional `rejectionReason`). Sending both edits first, then
 * reviews, so the final status is the requested one. `status: 'pending'` alone is a no-op edit.
 */
export async function editOrReviewCycleExpense(
  cycleId: string,
  id: string,
  body: Record<string, unknown>,
  req?: Request
) {
  const { status, rejectionReason, ...fields } = body ?? {};
  const hasFieldEdits = Object.values(fields).some((v) => v !== undefined);
  const wantsReview = status !== undefined && status !== 'pending';
  if (status !== undefined && !['pending', 'approved', 'rejected'].includes(String(status))) {
    throw new AppError(400, 'status must be "pending", "approved" or "rejected"');
  }
  if (!hasFieldEdits && !wantsReview) {
    if (status === 'pending') {
      // Explicit "back to pending" without other edits = re-run the edit path (resets review).
      return updateCycleExpense(id, {}, req, { cycleId, partial: true });
    }
    throw new AppError(400, 'Nothing to update');
  }
  if (hasFieldEdits) {
    await updateCycleExpense(id, fields as ExpenseInput, req, { cycleId, partial: true });
  }
  if (wantsReview) {
    return reviewCycleExpense(id, { status, rejectionReason }, req, { cycleId });
  }
  return prisma.cycleExpense.findUnique({ where: { id }, include: expenseInclude });
}

/** Hard delete (the model has no soft-delete column — same as the CRM UI). */
export async function deleteCycleExpense(id: string, req?: Request, opts: { cycleId?: string } = {}) {
  const oldExpense = opts.cycleId
    ? await getCycleExpenseOr404(id, opts.cycleId)
    : await prisma.cycleExpense.findUnique({ where: { id } });

  await prisma.cycleExpense.delete({ where: { id } });

  if (oldExpense) {
    await logAudit({
      action: 'DELETE',
      entity: 'CycleExpense',
      entityId: id,
      oldValue: { cycleId: oldExpense.cycleId, type: oldExpense.type, amount: oldExpense.amount, description: oldExpense.description },
      req,
    });
  }
}
