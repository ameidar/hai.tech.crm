// Meeting bulk operations — shared by the internal CRM route (/api/meetings/bulk-*) and the
// v1 ops API (/api/v1/meetings/bulk-*). Moved verbatim from routes/meetings.ts so revenue /
// instructor-payment recalculation, cycle counters, billing locks, replacement meetings and
// audit stay identical. Also hosts the trial-registration helpers used by PUT /meetings/:id.

import type { Request } from 'express';
import { prisma } from '../utils/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { addReplacementMeetingWithRetry } from './replacement-meeting.js';
import { logAudit } from '../utils/audit.js';
import { actorUserId } from '../utils/request-actor.js';
import { googleMeetService } from './google-meet.js';
import { handleCycleCompletion } from './cycle-completion.js';
import { shouldAutoCompleteCycle } from '../utils/cycle-sync.js';
import { meetingRevenueFromRegistrations, revenueRegistrationCount, roundMoney } from '../utils/revenue.js';
import { assertMeetingNotInIssuedPeriod } from './billing-lock.js';
import {
  calculateInstructorPayment,
  recalculateDailyInstructorPaymentsForMeeting,
} from './instructor-payment.js';
import { checkAndSendNegativeProfitAlert } from './negative-profit-alert.js';

export async function assertRegistrationBelongsToCycle(registrationId: string, cycleId: string) {
  const registration = await prisma.registration.findFirst({
    where: {
      id: registrationId,
      cycleId,
      deletedAt: null,
      status: { notIn: ['cancelled', 'pending_cancellation'] as any },
    },
    select: { id: true },
  });

  if (!registration) {
    throw new AppError(400, 'ההרשמה שנבחרה לא שייכת למחזור או אינה פעילה');
  }
}

async function findLinkedTrialRegistrationId(meetingId: string, registrationId?: string | null) {
  if (registrationId) return registrationId;

  const attendance = await prisma.attendance.findFirst({
    where: {
      meetingId,
      registrationId: { not: null },
    },
    select: { registrationId: true },
  });

  return attendance?.registrationId ?? null;
}

export async function ensureTrialMeetingHasRegistration(meeting: {
  id: string;
  cycleId: string;
  registrationId?: string | null;
  cycle?: { type?: string | null } | null;
}) {
  if (meeting.cycle?.type !== 'trial_private') return null;

  const registrationId = await findLinkedTrialRegistrationId(meeting.id, meeting.registrationId);
  if (!registrationId) {
    throw new AppError(400, 'חובה לשייך תלמיד/הרשמה לפני סימון שיעור ניסיון כהושלם');
  }

  await assertRegistrationBelongsToCycle(registrationId, meeting.cycleId);
  return registrationId;
}

export async function upsertTrialAttendance(meetingId: string, registrationId: string, recordedById?: string) {
  await prisma.attendance.upsert({
    where: {
      meetingId_registrationId: {
        meetingId,
        registrationId,
      },
    },
    update: {
      status: 'present',
      recordedAt: new Date(),
      recordedById,
      isTrial: true,
    },
    create: {
      meetingId,
      registrationId,
      status: 'present',
      recordedById,
      isTrial: true,
    },
  });
}

// Bulk recalculate meetings
export async function bulkRecalculateMeetings(body: any, req?: Request) {
  {
    const { ids, force } = (body ?? {});
    
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new AppError(400, 'ids array is required');
    }

    let recalculated = 0;
    let skipped = 0;
    
    for (const id of ids) {
      const meeting = await prisma.meeting.findUnique({
        where: { id },
        include: {
          cycle: {
            include: {
              registrations: {
                where: { status: { in: ['registered', 'active', 'completed'] } },
              },
            },
          },
          instructor: true,
        },
      });

      if (!meeting || meeting.status !== 'completed') {
        continue;
      }

      // Skip if already has financials calculated (unless force=true)
      if (!force && meeting.revenue !== null && Number(meeting.revenue) > 0) {
        skipped++;
        continue;
      }

      const cycleData = meeting.cycle;

      // Calculate revenue — skipped for no_revenue meetings.
      let revenue = 0;
      const registrationCount = revenueRegistrationCount(cycleData.registrations);

      if (meeting.nature !== 'no_revenue') {
        if (['private', 'trial_private', 'group'].includes(String(cycleData.type))) {
          if (cycleData.meetingRevenue && Number(cycleData.meetingRevenue) > 0) {
            revenue = Number(cycleData.meetingRevenue);
          } else {
            revenue = meetingRevenueFromRegistrations(cycleData.registrations, cycleData.totalMeetings, cycleData.type);
          }
        } else if (cycleData.type === 'institutional_per_child') {
          const pricePerStudent = Number(cycleData.pricePerStudent || 0);
          const studentCount = registrationCount;
          revenue = roundMoney(pricePerStudent * studentCount);
        } else if (cycleData.type === 'institutional_fixed') {
          revenue = Number(cycleData.meetingRevenue || 0);
        }
      }

      const instructorPayment = calculateInstructorPayment(cycleData, meeting.instructor, meeting);

      const profit = revenue - instructorPayment;

      const updatedMeeting = await prisma.meeting.update({
        where: { id },
        data: { revenue, instructorPayment, profit },
      });
      await recalculateDailyInstructorPaymentsForMeeting(updatedMeeting);
      await checkAndSendNegativeProfitAlert(id, 'meeting-bulk-recalculate');
      await logAudit({
        userId: actorUserId(req),
        action: 'UPDATE',
        entity: 'Meeting',
        entityId: id,
        oldValue: moneySnapshot(meeting),
        newValue: { ...moneySnapshot(updatedMeeting), action: 'bulk-recalculate' },
        req,
      });

      recalculated++;
    }

    return { success: true, recalculated, skipped };
  }
}

// Bulk update meeting status
export async function bulkUpdateMeetingStatus(body: any, req?: Request) {
  {
    const { ids, status } = (body ?? {});
    
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new AppError(400, 'ids array is required');
    }
    
    if (!status || !['scheduled', 'completed', 'cancelled', 'postponed'].includes(status)) {
      throw new AppError(400, 'Valid status is required (scheduled, completed, cancelled, postponed)');
    }

    let updated = 0;
    let errors: string[] = [];

    for (const id of ids) {
      try {
        const existingMeeting = await prisma.meeting.findUnique({
          where: { id },
          include: { cycle: true },
        });

        if (!existingMeeting) {
          errors.push(`Meeting ${id} not found`);
          continue;
        }

        const updateData: any = {
          status,
          statusUpdatedAt: new Date(),
          statusUpdatedById: actorUserId(req),
        };

        // Handle status change to completed - calculate financials
        if (status === 'completed' && existingMeeting.status !== 'completed') {
          const trialRegistrationId = await ensureTrialMeetingHasRegistration(existingMeeting);

          const cycleData = await prisma.cycle.findUnique({
            where: { id: existingMeeting.cycleId },
            include: {
              registrations: {
                where: { status: { in: ['registered', 'active', 'completed'] } },
              },
              instructor: true,
            },
          });

          if (cycleData) {
            // Calculate revenue based on cycle type
            let revenue = 0;
            const registrationCount = revenueRegistrationCount(cycleData.registrations);
            
            if (['private', 'trial_private', 'group'].includes(String(cycleData.type))) {
              if (cycleData.meetingRevenue && Number(cycleData.meetingRevenue) > 0) {
                revenue = Number(cycleData.meetingRevenue);
              } else {
                revenue = meetingRevenueFromRegistrations(cycleData.registrations, cycleData.totalMeetings, cycleData.type);
              }
            } else if (cycleData.type === 'institutional_per_child') {
              const pricePerStudent = Number(cycleData.pricePerStudent || 0);
              const studentCount = registrationCount;
              revenue = roundMoney(pricePerStudent * studentCount);
            } else if (cycleData.type === 'institutional_fixed') {
              revenue = Number(cycleData.meetingRevenue || 0);
            }

            const meetingInstructorId = existingMeeting.instructorId;
            const instructor = await prisma.instructor.findUnique({ where: { id: meetingInstructorId } });
            const instructorPayment = calculateInstructorPayment(cycleData, instructor, existingMeeting);

            const profit = revenue - instructorPayment;

            updateData.revenue = revenue;
            updateData.instructorPayment = instructorPayment;
            updateData.profit = profit;

            if (trialRegistrationId) {
              await upsertTrialAttendance(id, trialRegistrationId, actorUserId(req));
              updateData.registrationId = trialRegistrationId;
            }

            // Update cycle counters
            const updatedCompleted = cycleData.completedMeetings + 1;
            const newRemaining = cycleData.totalMeetings - updatedCompleted;
            await prisma.cycle.update({
              where: { id: existingMeeting.cycleId },
              data: {
                completedMeetings: updatedCompleted,
                remainingMeetings: newRemaining,
              },
            });

            // Trigger cycle completion if no remaining meetings
            if (newRemaining <= 0 && await shouldAutoCompleteCycle(existingMeeting.cycleId)) {
              handleCycleCompletion(existingMeeting.cycleId).catch(err =>
                console.error('Cycle completion error:', err)
              );
            }
          }
        }
        
        // Handle status change FROM completed to something else (decrement counters)
        if (existingMeeting.status === 'completed' && status !== 'completed') {
          const cycleData = await prisma.cycle.findUnique({
            where: { id: existingMeeting.cycleId },
          });
          
          if (cycleData && cycleData.completedMeetings > 0) {
            const updatedCompleted = cycleData.completedMeetings - 1;
            await prisma.cycle.update({
              where: { id: existingMeeting.cycleId },
              data: {
                completedMeetings: updatedCompleted,
                remainingMeetings: cycleData.totalMeetings - updatedCompleted,
              },
            });
          }
          
          // Reset financial fields
          updateData.revenue = 0;
          updateData.instructorPayment = 0;
          updateData.profit = 0;
        }

        // Zero amounts on any transition to postponed/cancelled — these meetings
        // didn't take place, so they shouldn't carry revenue/payment/profit.
        if (status === 'postponed' || status === 'cancelled') {
          updateData.revenue = 0;
          updateData.instructorPayment = 0;
          updateData.profit = 0;
        }

        const updatedMeeting = await prisma.meeting.update({
          where: { id },
          data: updateData,
        });
        await recalculateDailyInstructorPaymentsForMeeting(existingMeeting);
        await recalculateDailyInstructorPaymentsForMeeting(updatedMeeting);
        await checkAndSendNegativeProfitAlert(id, 'meeting-bulk-status');

        // Audit log
        await logAudit({
          userId: actorUserId(req),
          action: 'UPDATE',
          entity: 'Meeting',
          entityId: id,
          oldValue: { status: existingMeeting.status },
          newValue: { status },
          req,
        });

        // Trigger replacement meeting when admin bulk-sets status to 'postponed'
        if (status === 'postponed' && existingMeeting.status !== 'postponed') {
          const replacementId = await addReplacementMeetingWithRetry(id, actorUserId(req) ?? '');
          if (!replacementId) {
            errors.push(`Meeting ${id}: replacement meeting creation failed — admin notified`);
          }
        }

        updated++;
      } catch (error: any) {
        errors.push(`Meeting ${id}: ${error.message}`);
      }
    }

    return { 
      success: true, 
      updated, 
      errors: errors.length > 0 ? errors : undefined 
    };
  }
}

// Bulk update meetings (multiple fields)
export async function bulkUpdateMeetings(body: any, req?: Request) {
  {
    const { ids, data } = (body ?? {});
    
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new AppError(400, 'ids array is required');
    }
    
    if (!data || Object.keys(data).length === 0) {
      throw new AppError(400, 'data object is required');
    }

    // Allowed fields for bulk update
    const allowedFields = ['status', 'activityType', 'topic', 'notes', 'scheduledDate', 'startTime', 'endTime', 'instructorId', 'registrationId'];
    const updateData: Record<string, any> = {};
    
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        if (field === 'scheduledDate' && data[field]) {
          updateData[field] = new Date(data[field]);
        } else if ((field === 'startTime' || field === 'endTime') && data[field]) {
          // Convert HH:MM to Date object
          const [hours, minutes] = data[field].split(':').map(Number);
          const timeDate = new Date(Date.UTC(1970, 0, 1, hours, minutes, 0));
          updateData[field] = timeDate;
        } else {
          updateData[field] = data[field];
        }
      }
    }

    // Manual financial override (revenue / instructorPayment). Profit is derived server-side
    // (revenue − instructorPayment − approved expenses, same formula as completion). Not
    // combinable with a status change, which recalculates financials from the cycle.
    const financialOverride = parseFinancialOverride(data);
    if (financialOverride && updateData.status !== undefined) {
      throw new AppError(400, 'Cannot combine revenue/instructorPayment with a status change in the same bulk update');
    }

    if (Object.keys(updateData).length === 0 && !financialOverride) {
      throw new AppError(400, 'No valid fields to update');
    }

    let updated = 0;
    let errors: string[] = [];
    const shouldRecalculate = updateData.status === 'completed';

    for (const id of ids) {
      try {
        const existingMeeting = await prisma.meeting.findUnique({
          where: { id },
          include: { cycle: true },
        });

        if (!existingMeeting) {
          errors.push(`Meeting ${id} not found`);
          continue;
        }

        const perMeetingUpdateData = { ...updateData };

        // If status changing to completed and wasn't completed before, add timestamps
        if (perMeetingUpdateData.status === 'completed' && existingMeeting.status !== 'completed') {
          const trialRegistrationId = await ensureTrialMeetingHasRegistration({
            ...existingMeeting,
            registrationId: perMeetingUpdateData.registrationId ?? existingMeeting.registrationId,
          });
          if (trialRegistrationId) {
            await upsertTrialAttendance(id, trialRegistrationId, actorUserId(req));
            perMeetingUpdateData.registrationId = trialRegistrationId;
          }
          perMeetingUpdateData.statusUpdatedAt = new Date();
          perMeetingUpdateData.statusUpdatedById = actorUserId(req);
        }

        if (Object.prototype.hasOwnProperty.call(perMeetingUpdateData, 'registrationId') && perMeetingUpdateData.registrationId) {
          await assertRegistrationBelongsToCycle(perMeetingUpdateData.registrationId, existingMeeting.cycleId);
        }

        if (financialOverride) {
          // Same lock the single-meeting delete/regenerate paths honor: never change money on
          // a meeting whose month is already invoiced to the institution.
          await assertMeetingNotInIssuedPeriod(id);
          const approvedExpenses = await prisma.meetingExpense.aggregate({
            where: { meetingId: id, status: 'approved' },
            _sum: { amount: true },
          });
          const revenue = financialOverride.revenue ?? Number(existingMeeting.revenue ?? 0);
          const instructorPayment = financialOverride.instructorPayment ?? Number(existingMeeting.instructorPayment ?? 0);
          perMeetingUpdateData.revenue = revenue;
          perMeetingUpdateData.instructorPayment = instructorPayment;
          perMeetingUpdateData.profit = roundMoney(revenue - instructorPayment - Number(approvedExpenses._sum.amount || 0));
        }

        const savedMeeting = await prisma.meeting.update({
          where: { id },
          data: perMeetingUpdateData,
        });

        if (financialOverride) {
          await recalculateDailyInstructorPaymentsForMeeting(existingMeeting);
          await recalculateDailyInstructorPaymentsForMeeting(savedMeeting);
          await checkAndSendNegativeProfitAlert(id, 'meeting-bulk-update');
        }

        await logAudit({
          userId: actorUserId(req),
          action: 'UPDATE',
          entity: 'Meeting',
          entityId: id,
          oldValue: bulkUpdateSnapshot(existingMeeting),
          newValue: { ...bulkUpdateSnapshot(savedMeeting), action: 'bulk-update' },
          req,
        });

        // Recalculate financials if status changed to completed
        if (shouldRecalculate && existingMeeting.status !== 'completed') {
          const meeting = await prisma.meeting.findUnique({
            where: { id },
            include: {
              cycle: {
                include: {
                  registrations: { where: { status: { in: ['registered', 'active', 'completed'] } } },
                },
              },
              instructor: true,
            },
          });

          if (meeting) {
            const cycleData = meeting.cycle;
            let revenue = 0;
            const registrationCount = revenueRegistrationCount(cycleData.registrations);

            if (['private', 'trial_private', 'group'].includes(String(cycleData.type))) {
              if (cycleData.meetingRevenue && Number(cycleData.meetingRevenue) > 0) {
                revenue = Number(cycleData.meetingRevenue);
              } else {
                revenue = meetingRevenueFromRegistrations(cycleData.registrations, cycleData.totalMeetings, cycleData.type);
              }
            } else if (cycleData.type === 'institutional_per_child') {
              revenue = roundMoney(Number(cycleData.pricePerStudent || 0) * registrationCount);
            } else if (cycleData.type === 'institutional_fixed') {
              revenue = Number(cycleData.meetingRevenue || 0);
            }

            const instructorPayment = calculateInstructorPayment(cycleData, meeting.instructor, meeting);

            const updatedMeeting = await prisma.meeting.update({
              where: { id },
              data: { revenue, instructorPayment, profit: revenue - instructorPayment },
            });
            await recalculateDailyInstructorPaymentsForMeeting(updatedMeeting);
            await checkAndSendNegativeProfitAlert(id, 'meeting-bulk-update');
          }
        }

        updated++;
      } catch (err: any) {
        errors.push(`Meeting ${id}: ${err.message}`);
      }
    }

    return { 
      success: true, 
      updated, 
      errors: errors.length > 0 ? errors : undefined 
    };
  }
}

// Bulk delete meetings
export async function bulkDeleteMeetings(body: any, req?: Request) {
  {
    const { ids } = (body ?? {});
    
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new AppError(400, 'ids array is required');
    }

    // Get meetings to check their status and cycle
    const meetings = await prisma.meeting.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        cycleId: true,
        instructorId: true,
        scheduledDate: true,
        status: true,
        videoProvider: true,
        zoomHostEmail: true,
        googleMeetSpaceName: true,
        googleCalendarEventId: true,
      },
    });

    for (const meeting of meetings) {
      await assertMeetingNotInIssuedPeriod(meeting.id);
    }

    // Group completed meetings by cycle to update counters
    const completedByCycle = meetings
      .filter(m => m.status === 'completed')
      .reduce((acc, m) => {
        acc[m.cycleId] = (acc[m.cycleId] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

    for (const meeting of meetings) {
      if ((meeting.videoProvider ?? 'zoom') !== 'google_meet') continue;
      try {
        await googleMeetService.deleteGoogleMeetMeeting({
          hostEmail: meeting.zoomHostEmail,
          googleMeetSpaceName: meeting.googleMeetSpaceName,
          googleCalendarEventIds: [meeting.googleCalendarEventId],
        });
      } catch (e) {
        console.warn(`[meetings] Failed to delete Google Meet calendar event for bulk-deleted meeting ${meeting.id}:`, e);
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      // Update cycle counters
      for (const [cycleId, count] of Object.entries(completedByCycle)) {
        await tx.cycle.update({
          where: { id: cycleId },
          data: {
            completedMeetings: { decrement: count },
            remainingMeetings: { increment: count },
          },
        });
      }

      await tx.meetingChangeRequest.deleteMany({
        where: { meetingId: { in: ids } },
      });
      await tx.meeting.updateMany({
        where: { rescheduledToId: { in: ids } },
        data: { rescheduledToId: null },
      });

      return tx.meeting.deleteMany({
        where: { id: { in: ids } },
      });
    });

    for (const meeting of meetings) {
      if (meeting.status === 'completed') {
        await recalculateDailyInstructorPaymentsForMeeting(meeting);
      }
    }

    for (const meeting of meetings) {
      await logAudit({
        userId: actorUserId(req),
        action: 'DELETE',
        entity: 'Meeting',
        entityId: meeting.id,
        oldValue: {
          cycleId: meeting.cycleId,
          instructorId: meeting.instructorId,
          scheduledDate: meeting.scheduledDate,
          status: meeting.status,
          action: 'bulk-delete',
        },
        req,
      });
    }

    return { success: true, deleted: result.count };
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

type MoneyLike = { toString(): string } | number | null | undefined;
const num = (v: MoneyLike) => (v === null || v === undefined ? null : Number(v.toString()));

function moneySnapshot(m: { revenue?: MoneyLike; instructorPayment?: MoneyLike; profit?: MoneyLike }) {
  return { revenue: num(m.revenue), instructorPayment: num(m.instructorPayment), profit: num(m.profit) };
}

function bulkUpdateSnapshot(m: Record<string, any>) {
  return {
    status: m.status,
    activityType: m.activityType,
    topic: m.topic,
    notes: m.notes,
    scheduledDate: m.scheduledDate,
    startTime: m.startTime,
    endTime: m.endTime,
    instructorId: m.instructorId,
    registrationId: m.registrationId,
    ...moneySnapshot(m),
  };
}

/** Validates optional `revenue` / `instructorPayment` (finite, ≥ 0) in a bulk-update payload. */
function parseFinancialOverride(data: Record<string, any>): { revenue?: number; instructorPayment?: number } | null {
  const out: { revenue?: number; instructorPayment?: number } = {};
  for (const field of ['revenue', 'instructorPayment'] as const) {
    if (data[field] === undefined) continue;
    const value = data[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new AppError(400, `${field} must be a non-negative number`);
    }
    out[field] = value;
  }
  return Object.keys(out).length ? out : null;
}
