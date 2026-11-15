// Tentative cycles (מחזור טנטטיבי) — an activity that is not yet confirmed (no final
// dates/times). Its meetings carry status 'tentative' so the forecast can spread their
// expected revenue across months (as tentativeRevenue), while every side effect is skipped:
// no reminders, no WhatsApp/email, no Zoom/Meet/Calendar, no instructor schedules,
// no unresolved-meeting alerts, no billing and no payroll.
//
// Every scheduler/report that acts on meetings must therefore either select an explicit
// positive status list (e.g. status: 'scheduled' / 'completed') or exclude 'tentative'.
// When the cycle is confirmed (tentative → active) its tentative meetings become
// 'scheduled' and from then on flow through the normal pipeline.

import type { Request } from 'express';
import { prisma } from '../utils/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { logAudit } from '../utils/audit.js';
import { syncCycleProgress } from '../utils/cycle-sync.js';
import { recalculateInstructorPaymentsForCycle } from './instructor-payment.js';
import { syncMonthlyFixedForCycle } from './monthly-fixed-billing.js';

export const TENTATIVE = 'tentative' as const;

/** Statuses that a tentative cycle may move to directly. Anything else needs confirmation first. */
export const TENTATIVE_EXIT_STATUSES = ['active', 'cancelled', 'tentative'] as const;

/** Placeholder slot stored for a tentative cycle created without final times. */
export const TENTATIVE_PLACEHOLDER_START = '00:00';

export function isTentativeStatus(status: unknown): boolean {
  return status === TENTATIVE;
}

/** HH:MM placeholder end time = 00:00 + duration (capped at 23:59). */
export function tentativePlaceholderEnd(durationMinutes: number): string {
  const total = Math.min(Math.max(0, Math.round(durationMinutes || 0)), 23 * 60 + 59);
  const h = Math.floor(total / 60).toString().padStart(2, '0');
  const m = (total % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

/** True when the stored cycle start time is still the tentative 00:00 placeholder. */
export function hasPlaceholderTime(startTime: Date | string | null | undefined): boolean {
  if (!startTime) return true;
  const d = startTime instanceof Date ? startTime : new Date(startTime);
  if (Number.isNaN(d.getTime())) return false;
  return d.getUTCHours() === 0 && d.getUTCMinutes() === 0;
}

/**
 * Validate a status transition for a cycle. A tentative cycle can only be confirmed
 * (→ active) or cancelled; an existing non-tentative cycle cannot be turned tentative
 * (its meetings may already have links, reminders and billing).
 */
export function assertTentativeTransition(fromStatus: string, toStatus: string | undefined) {
  if (!toStatus || toStatus === fromStatus) return;
  if (fromStatus === TENTATIVE && !(TENTATIVE_EXIT_STATUSES as readonly string[]).includes(toStatus)) {
    throw new AppError(400, 'מחזור טנטטיבי ניתן רק לאשר (פעיל) או לבטל — יש לאשר את המחזור לפני שינוי לסטטוס אחר');
  }
  if (toStatus === TENTATIVE && fromStatus !== TENTATIVE) {
    throw new AppError(400, 'לא ניתן להחזיר מחזור קיים לסטטוס טנטטיבי');
  }
}

/** Reject an operation that would create side effects (video/calendar/bots) for a tentative cycle/meeting. */
export function assertNotTentative(status: unknown, what = 'מחזור טנטטיבי') {
  if (isTentativeStatus(status)) {
    throw new AppError(400, `${what} — יש לאשר את המחזור לפני יצירת קישור/אירוע`);
  }
}

/**
 * Confirm a tentative cycle: flip its tentative meetings to 'scheduled' and run the same
 * follow-ups a newly-created active cycle gets (instructor payments, monthly-fixed split,
 * progress). The cycle row's status itself is set by the caller. Video meetings are
 * created the same way as for any active cycle (the "צור פגישת וידאו" action), never
 * automatically. Returns the number of meetings flipped.
 */
export async function confirmTentativeMeetings(cycleId: string, req?: Request): Promise<number> {
  const flipped = await prisma.meeting.updateMany({
    where: { cycleId, status: TENTATIVE },
    data: { status: 'scheduled', statusUpdatedAt: new Date() },
  });

  await recalculateInstructorPaymentsForCycle(cycleId);
  await syncMonthlyFixedForCycle(cycleId);
  await syncCycleProgress(cycleId);

  await logAudit({
    action: 'UPDATE',
    entity: 'CycleConfirmation',
    entityId: cycleId,
    newValue: { from: TENTATIVE, to: 'active', meetingsConfirmed: flipped.count },
    req,
  });

  return flipped.count;
}

/**
 * Bulk status change guard. Validates every selected cycle's transition and returns the
 * ids of tentative cycles that this bulk update confirms (caller runs
 * confirmTentativeMeetings for them after updating the rows).
 */
export async function tentativeCyclesConfirmedByBulk(ids: string[], toStatus: string | undefined): Promise<string[]> {
  if (!toStatus) return [];
  const cycles = await prisma.cycle.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, status: true, startTime: true },
  });
  for (const c of cycles) assertTentativeTransition(c.status, toStatus);
  const confirming = cycles.filter((c) => c.status === TENTATIVE && toStatus === 'active');
  const missingTimes = confirming.filter((c) => hasPlaceholderTime(c.startTime));
  if (missingTimes.length > 0) {
    throw new AppError(
      400,
      `יש להזין שעות אמיתיות לפני אישור המחזורים: ${missingTimes.map((c) => c.name).join(', ')}`,
    );
  }
  return confirming.map((c) => c.id);
}

/**
 * A meeting of a tentative cycle stays tentative until the cycle is confirmed: it may be
 * re-dated/re-timed or cancelled, but not marked scheduled/completed/postponed (which would
 * pull it into reminders, payroll and billing before the activity is confirmed).
 */
export function isTentativeMeetingStatusChangeBlocked(
  meetingStatus: unknown,
  cycleStatus: unknown,
  newStatus: string | undefined,
): boolean {
  if (!newStatus || newStatus === meetingStatus) return false;
  // Only a cycle confirmation/creation makes a meeting tentative — never a meeting edit.
  if (newStatus === TENTATIVE) return true;
  if (!isTentativeStatus(meetingStatus) && !isTentativeStatus(cycleStatus)) return false;
  return newStatus !== 'cancelled';
}

export function assertTentativeMeetingStatusChange(
  meetingStatus: unknown,
  cycleStatus: unknown,
  newStatus: string | undefined,
) {
  if (isTentativeMeetingStatusChangeBlocked(meetingStatus, cycleStatus, newStatus)) {
    throw new AppError(400, 'מפגש של מחזור טנטטיבי — יש לאשר את המחזור לפני שינוי סטטוס המפגש');
  }
}
