/**
 * Replacement Meeting Service
 *
 * When a meeting is postponed (approved postpone request or direct admin action),
 * we add a new meeting at the END of the cycle:
 *  - Same day of week + time as the cycle
 *  - Scheduled 1 week after the last existing meeting in the cycle
 *  - If the postponed meeting had Zoom (or cycle is online) → create a Zoom meeting
 *  - totalMeetings stays unchanged; remainingMeetings is incremented by 1
 */

import { prisma } from '../utils/prisma.js';
import { zoomService } from './zoom.js';

/**
 * Add a replacement meeting to the end of the cycle when a meeting is postponed.
 * @param postponedMeetingId - the meeting that was just set to 'postponed'
 * @param actorUserId - the user approving / triggering the postpone
 */
export async function addReplacementMeeting(postponedMeetingId: string, actorUserId: string): Promise<void> {
  // Load the postponed meeting with cycle details
  const postponed = await prisma.meeting.findUnique({
    where: { id: postponedMeetingId },
    include: {
      cycle: true,
    },
  });

  if (!postponed) {
    console.error('[ReplacementMeeting] postponed meeting not found:', postponedMeetingId);
    return;
  }

  const cycle = postponed.cycle;

  // Find the last scheduled/completed meeting in this cycle (excluding the postponed one)
  const lastMeeting = await prisma.meeting.findFirst({
    where: {
      cycleId: cycle.id,
      id: { not: postponedMeetingId },
      status: { in: ['scheduled', 'completed'] },
    },
    orderBy: { scheduledDate: 'desc' },
  });

  // Calculate new date: last meeting + 7 days, or cycle endDate + 7 days as fallback
  const baseDate = lastMeeting?.scheduledDate ?? cycle.endDate;
  const newDate = new Date(baseDate);
  newDate.setDate(newDate.getDate() + 7);

  // Use cycle's time settings
  const startTime = cycle.startTime; // stored as 1970-01-01T{HH:MM}:00Z
  const endTime = cycle.endTime;
  const activityType = cycle.activityType ?? postponed.activityType ?? 'frontal';
  const instructorId = postponed.instructorId;

  // Calculate revenue & instructor payment (same logic as POST /meetings)
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  const cycleWithReg = await prisma.cycle.findUnique({
    where: { id: cycle.id },
    include: {
      registrations: { where: { status: { in: ['registered', 'active'] } } },
    },
  });

  let revenue = 0;
  if (cycle.type === 'institutional_fixed' && cycle.meetingRevenue) {
    revenue = Number(cycle.meetingRevenue);
  } else if (cycle.type === 'institutional_per_child' && cycle.pricePerStudent) {
    const count = cycle.studentCount ?? cycleWithReg?.registrations.length ?? 0;
    revenue = Number(cycle.pricePerStudent) * count;
  } else if (cycle.type === 'private' && cycle.pricePerStudent) {
    revenue = Number(cycle.pricePerStudent) * (cycleWithReg?.registrations.length ?? 0);
  }

  let instructorPayment = 0;
  if (instructor) {
    let hourlyRate = 0;
    if (activityType === 'online') hourlyRate = Number(instructor.rateOnline) || Number(instructor.rateFrontal) || 0;
    else if (activityType === 'private_lesson') hourlyRate = Number(instructor.ratePrivate) || Number(instructor.rateFrontal) || 0;
    else hourlyRate = Number(instructor.rateFrontal) || 0;

    const durationMin = cycle.durationMinutes || 60;
    instructorPayment = Math.round(hourlyRate * (durationMin / 60));
    if (instructor.employmentType === 'employee') instructorPayment = Math.round(instructorPayment * 1.3);
  }

  const profit = revenue - instructorPayment;

  // Create the replacement meeting
  const replacement = await prisma.meeting.create({
    data: {
      cycleId: cycle.id,
      instructorId,
      scheduledDate: newDate,
      startTime,
      endTime,
      status: 'scheduled',
      activityType,
      revenue,
      instructorPayment,
      profit,
      topic: `פגישה חלופית (דחייה מ-${new Date(postponed.scheduledDate).toLocaleDateString('he-IL')})`,
    },
  });

  console.log(`[ReplacementMeeting] Created replacement meeting ${replacement.id} on ${newDate.toISOString().split('T')[0]} for cycle ${cycle.id}`);

  // Increment remainingMeetings (totalMeetings stays the same per business rule)
  await prisma.cycle.update({
    where: { id: cycle.id },
    data: { remainingMeetings: { increment: 1 } },
  });

  // Create Zoom meeting if the postponed meeting had Zoom (or cycle is online)
  const needsZoom = (cycle.isOnline || activityType === 'online' || activityType === 'private_lesson')
    && (postponed.zoomMeetingId !== null || cycle.zoomMeetingId !== null);

  if (needsZoom) {
    try {
      // Build start time in Israel TZ (10 min early)
      const startHHMM = startTime.toISOString().substring(11, 16); // "HH:MM"
      let [sHour, sMin] = startHHMM.split(':').map(Number);
      sMin -= 10;
      if (sMin < 0) { sMin += 60; sHour -= 1; if (sHour < 0) sHour = 23; }

      const dateStr = newDate.toISOString().split('T')[0];
      const timeStr = `${sHour.toString().padStart(2, '0')}:${sMin.toString().padStart(2, '0')}:00`;
      const meetingDate = new Date(`${dateStr}T${timeStr}+02:00`);
      const durationMin = (cycle.durationMinutes || 60) + 10;

      const availableUser = await zoomService.findAvailableUser(meetingDate, durationMin);
      if (availableUser) {
        const zoomMeeting = await zoomService.createMeeting(availableUser.id, {
          topic: cycle.name,
          startTime: meetingDate,
          duration: durationMin,
        });

        await prisma.meeting.update({
          where: { id: replacement.id },
          data: {
            zoomMeetingId: zoomMeeting.id?.toString(),
            zoomJoinUrl: zoomMeeting.join_url,
            zoomStartUrl: zoomMeeting.start_url,
            zoomPassword: zoomMeeting.password,
            zoomHostKey: zoomMeeting.host_key,
            zoomHostEmail: availableUser.email,
          },
        });

        console.log(`[ReplacementMeeting] Zoom meeting created for replacement ${replacement.id}`);
      } else {
        console.warn('[ReplacementMeeting] No available Zoom user found — replacement meeting without Zoom');
      }
    } catch (zoomError) {
      console.error('[ReplacementMeeting] Failed to create Zoom meeting:', zoomError);
      // Don't fail — replacement meeting exists without Zoom
    }
  }
}
