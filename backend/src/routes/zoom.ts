import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { getIsraelOffset, zoomService } from '../services/zoom';
import { googleMeetService } from '../services/google-meet';
import { authenticate, managerOrAdmin } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();
type VideoProvider = 'zoom' | 'google_meet';

// All zoom routes require authentication
router.use(authenticate);

// Day of week mapping: Prisma enum to Zoom format (1=Sunday, 7=Saturday)
const dayOfWeekToZoom: Record<string, number> = {
  'sunday': 1,
  'monday': 2,
  'tuesday': 3,
  'wednesday': 4,
  'thursday': 5,
  'friday': 6,
  'saturday': 7
};

function parseIsraelDateTime(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [hours, minutes] = time.split(':').map(Number);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  const localDate = new Date(`${date}T${time}:00`);
  if (Number.isNaN(localDate.getTime())) return null;

  const offset = getIsraelOffset(localDate);
  const parsed = new Date(`${date}T${time}:00${offset}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateInput(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function formatTimeInput(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function resolveVideoProvider(raw: unknown): VideoProvider {
  return raw === 'google_meet' ? 'google_meet' : 'zoom';
}

function meetingDateTimeFromDateAndTime(date: Date, time: Date): Date {
  const dateStr = date.toISOString().split('T')[0];
  const timeStr = `${time.getUTCHours().toString().padStart(2, '0')}:${time.getUTCMinutes().toString().padStart(2, '0')}:00`;
  return new Date(`${dateStr}T${timeStr}${getIsraelOffset(new Date(`${dateStr}T${timeStr}`))}`);
}

type InternalZoomRow = {
  id: string;
  title: string;
  requester_name: string;
  requested_by_id: string | null;
  start_at: Date;
  end_at: Date;
  duration_minutes: number;
  zoom_host_id: string | null;
  zoom_host_email: string | null;
  zoom_meeting_id: string | null;
  zoom_join_url: string | null;
  zoom_start_url: string | null;
  zoom_password: string | null;
  zoom_host_key: string | null;
  video_provider: VideoProvider;
  google_meet_space_name: string | null;
  google_calendar_event_id: string | null;
  status: 'scheduled' | 'cancelled';
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  cancelled_at: Date | null;
  cancelled_by_id: string | null;
};

function serializeInternalZoom(row: InternalZoomRow) {
  return {
    id: row.id,
    title: row.title,
    requesterName: row.requester_name,
    requestedById: row.requested_by_id,
    startAt: row.start_at.toISOString(),
    endAt: row.end_at.toISOString(),
    date: formatDateInput(row.start_at),
    startTime: formatTimeInput(row.start_at),
    endTime: formatTimeInput(row.end_at),
    durationMinutes: row.duration_minutes,
    zoomHostId: row.zoom_host_id,
    zoomHostEmail: row.zoom_host_email,
    zoomMeetingId: row.zoom_meeting_id,
    zoomJoinUrl: row.zoom_join_url,
    zoomStartUrl: row.zoom_start_url,
    zoomPassword: row.zoom_password,
    zoomHostKey: row.zoom_host_key,
    videoProvider: row.video_provider,
    googleMeetSpaceName: row.google_meet_space_name,
    googleCalendarEventId: row.google_calendar_event_id,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    cancelledAt: row.cancelled_at?.toISOString() ?? null,
    cancelledById: row.cancelled_by_id,
  };
}

/**
 * GET /api/zoom/users
 * List all Zoom users
 */
router.get('/users', async (_req: Request, res: Response) => {
  try {
    const users = await zoomService.getUsers();
    res.json(users);
  } catch (error: any) {
    console.error('Failed to get Zoom users:', error);
    res.status(500).json({ 
      error: 'Failed to get Zoom users',
      details: error.message 
    });
  }
});

/**
 * GET /api/zoom/users/:userId/availability
 * Check user availability for a time slot
 */
router.get('/users/:userId/availability', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { startTime, duration } = req.query;

    if (!startTime || !duration) {
      return res.status(400).json({ error: 'startTime and duration are required' });
    }

    const available = await zoomService.isUserAvailable(
      userId,
      new Date(startTime as string),
      parseInt(duration as string)
    );

    res.json({ available });
  } catch (error: any) {
    console.error('Failed to check availability:', error);
    res.status(500).json({ 
      error: 'Failed to check availability',
      details: error.message 
    });
  }
});

/**
 * GET /api/zoom/internal-meetings
 * List standalone Zoom meetings requested by staff.
 */
router.get('/internal-meetings', async (req: Request, res: Response) => {
  try {
    const from = typeof req.query.from === 'string'
      ? new Date(`${req.query.from}T00:00:00${getIsraelOffset(new Date(`${req.query.from}T00:00:00`))}`)
      : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const to = typeof req.query.to === 'string'
      ? new Date(`${req.query.to}T23:59:59${getIsraelOffset(new Date(`${req.query.to}T12:00:00`))}`)
      : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    const rows = await prisma.$queryRaw<InternalZoomRow[]>`
      SELECT *
      FROM internal_zoom_meetings
      WHERE start_at >= ${from}
        AND start_at <= ${to}
      ORDER BY start_at ASC, created_at DESC
    `;

    res.json(rows.map(serializeInternalZoom));
  } catch (error: any) {
    console.error('Failed to list internal Zoom meetings:', error);
    res.status(500).json({
      error: 'Failed to list internal Zoom meetings',
      details: error.message,
    });
  }
});

/**
 * POST /api/zoom/internal-meetings
 * Create a standalone Zoom meeting if one of the account hosts is free.
 */
router.post('/internal-meetings', async (req: Request, res: Response) => {
  try {
    const provider = resolveVideoProvider(req.body.provider || req.body.videoProvider);
    const title = String(req.body.title || '').trim();
    const requesterName = String(req.body.requesterName || req.user?.name || '').trim();
    const date = String(req.body.date || '').trim();
    const startTime = String(req.body.startTime || '').trim();
    const durationMinutes = Number(req.body.durationMinutes || 60);
    const notes = String(req.body.notes || '').trim() || null;

    if (!title) return res.status(400).json({ error: 'חובה להזין כותרת לפגישה' });
    if (!requesterName) return res.status(400).json({ error: 'חובה להזין מי ביקש את הזום' });
    if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 480) {
      return res.status(400).json({ error: 'משך הפגישה חייב להיות בין 15 ל-480 דקות' });
    }

    const startAt = parseIsraelDateTime(date, startTime);
    if (!startAt) return res.status(400).json({ error: 'תאריך או שעה לא תקינים' });
    const endAt = new Date(startAt.getTime() + durationMinutes * 60_000);

    if (provider === 'google_meet') {
      const meeting = await googleMeetService.createMeeting({
        topic: title,
        lessonStart: startAt,
        durationMinutes,
        record: true,
        transcript: true,
      });
      if (!meeting) {
        return res.status(409).json({ error: 'אין חשבון Google Meet פנוי בזמן המבוקש' });
      }
      const rows = await prisma.$queryRaw<InternalZoomRow[]>`
        INSERT INTO internal_zoom_meetings (
          id, title, requester_name, requested_by_id, start_at, end_at,
          duration_minutes, zoom_host_id, zoom_host_email, zoom_meeting_id,
          zoom_join_url, zoom_start_url, zoom_password, zoom_host_key,
          video_provider, google_meet_space_name, google_calendar_event_id,
          notes, updated_at
        )
        VALUES (
          gen_random_uuid()::text, ${title}, ${requesterName}, ${req.user?.userId ?? null},
          ${startAt}, ${endAt}, ${durationMinutes}, ${meeting.hostEmail},
          ${meeting.hostEmail}, ${meeting.id}, ${meeting.joinUrl}, ${meeting.startUrl ?? null},
          null, null, 'google_meet'::"VideoMeetingProvider", ${meeting.spaceName ?? null},
          ${meeting.calendarEventId ?? null}, ${notes}, CURRENT_TIMESTAMP
        )
        RETURNING *
      `;
      return res.status(201).json({
        success: true,
        meeting: serializeInternalZoom(rows[0]),
        hostUser: { id: meeting.hostEmail, email: meeting.hostEmail, name: meeting.hostEmail },
      });
    }

    const hostUser = await zoomService.findAvailableUser(startAt, durationMinutes);
    if (!hostUser) {
      return res.status(409).json({
        error: 'אין חשבון Zoom פנוי בזמן המבוקש',
      });
    }

    const meeting = await zoomService.createMeeting(hostUser.id, {
      topic: title,
      startTime: startAt,
      duration: durationMinutes,
      timezone: 'Asia/Jerusalem',
    });
    const joinUrl = zoomService.getDirectJoinUrl(meeting);

    const rows = await prisma.$queryRaw<InternalZoomRow[]>`
      INSERT INTO internal_zoom_meetings (
        id,
        title,
        requester_name,
        requested_by_id,
        start_at,
        end_at,
        duration_minutes,
        zoom_host_id,
        zoom_host_email,
        zoom_meeting_id,
        zoom_join_url,
        zoom_start_url,
        zoom_password,
        zoom_host_key,
        video_provider,
        google_meet_space_name,
        google_calendar_event_id,
        notes,
        updated_at
      )
      VALUES (
        gen_random_uuid()::text,
        ${title},
        ${requesterName},
        ${req.user?.userId ?? null},
        ${startAt},
        ${endAt},
        ${durationMinutes},
        ${hostUser.id},
        ${hostUser.email},
        ${String(meeting.id)},
        ${joinUrl},
        ${meeting.start_url ?? null},
        ${meeting.password || '1111'},
        ${meeting.host_key ?? hostUser.host_key ?? null},
        'zoom'::"VideoMeetingProvider",
        null,
        null,
        ${notes},
        CURRENT_TIMESTAMP
      )
      RETURNING *
    `;

    res.status(201).json({
      success: true,
      meeting: serializeInternalZoom(rows[0]),
      hostUser: {
        id: hostUser.id,
        email: hostUser.email,
        name: `${hostUser.first_name} ${hostUser.last_name}`.trim(),
      },
    });
  } catch (error: any) {
    console.error('Failed to create internal Zoom meeting:', error);
    const zoomErrorData = error.response?.data;
    res.status(500).json({
      error: 'Failed to create internal Zoom meeting',
      details: error.message,
      zoomError: zoomErrorData || null,
    });
  }
});

/**
 * DELETE /api/zoom/internal-meetings/:id
 * Cancel a standalone Zoom meeting and release the locally booked host.
 */
router.delete('/internal-meetings/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const rows = await prisma.$queryRaw<InternalZoomRow[]>`
      SELECT *
      FROM internal_zoom_meetings
      WHERE id = ${id}
      LIMIT 1
    `;

    const existing = rows[0];
    if (!existing) return res.status(404).json({ error: 'פגישת Zoom לא נמצאה' });
    if (existing.status === 'cancelled') return res.json({ success: true, meeting: serializeInternalZoom(existing) });

    if (existing.zoom_meeting_id && existing.video_provider === 'zoom') {
      try {
        await zoomService.deleteMeeting(existing.zoom_meeting_id);
      } catch (error: any) {
        if (error.response?.status !== 404) throw error;
      }
    }

    const updated = await prisma.$queryRaw<InternalZoomRow[]>`
      UPDATE internal_zoom_meetings
      SET status = 'cancelled'::"InternalZoomMeetingStatus",
          cancelled_at = CURRENT_TIMESTAMP,
          cancelled_by_id = ${req.user?.userId ?? null},
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id}
      RETURNING *
    `;

    res.json({ success: true, meeting: serializeInternalZoom(updated[0]) });
  } catch (error: any) {
    console.error('Failed to cancel internal Zoom meeting:', error);
    res.status(500).json({
      error: 'Failed to cancel internal Zoom meeting',
      details: error.message,
    });
  }
});

/**
 * POST /api/zoom/cycles/:cycleId/meeting
 * Create a Zoom meeting for a cycle
 */
router.post('/cycles/:cycleId/meeting', async (req: Request, res: Response) => {
  try {
    const { cycleId } = req.params;
    const provider = resolveVideoProvider(req.body.provider || req.body.videoProvider);

    // Get cycle details
    const cycle = await prisma.cycle.findUnique({
      where: { id: cycleId },
      include: { course: true, instructor: true }
    });

    if (!cycle) {
      return res.status(404).json({ error: 'Cycle not found' });
    }

    // Check if cycle supports Zoom (online or private lesson)
    if (cycle.activityType !== 'online' && cycle.activityType !== 'private_lesson' && cycle.type !== 'private') {
      return res.status(400).json({ 
        error: 'Zoom meetings can only be created for online or private lesson cycles' 
      });
    }

    // Check if cycle already has a Zoom meeting
    if (cycle.zoomMeetingId) {
      return res.status(400).json({ 
        error: 'Cycle already has a Zoom meeting',
        zoomJoinUrl: cycle.zoomJoinUrl,
        zoomHostKey: cycle.zoomHostKey
      });
    }

    // Get actual meetings for this cycle (scheduled only, not cancelled)
    const meetings = await prisma.meeting.findMany({
      where: { 
        cycleId,
        status: { in: ['scheduled', 'completed'] },
        deletedAt: null
      },
      orderBy: { scheduledDate: 'asc' }
    });

    if (meetings.length === 0) {
      return res.status(400).json({ 
        error: 'No meetings found for this cycle' 
      });
    }

    // Get first and last meeting dates
    const firstMeeting = meetings[0];
    const lastMeeting = meetings[meetings.length - 1];

    // Format start time from Time field
    const startTimeDate = new Date(cycle.startTime);
    const startTimeStr = `${startTimeDate.getUTCHours().toString().padStart(2, '0')}:${startTimeDate.getUTCMinutes().toString().padStart(2, '0')}`;

    // Calculate number of weeks between first and last meeting
    const firstDate = new Date(firstMeeting.scheduledDate);
    const lastDate = new Date(lastMeeting.scheduledDate);
    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    const weeksCount = Math.ceil((lastDate.getTime() - firstDate.getTime()) / msPerWeek) + 1;

    // Validate dayOfWeek mapping
    const zoomDayOfWeek = dayOfWeekToZoom[cycle.dayOfWeek];
    if (!zoomDayOfWeek) {
      return res.status(400).json({
        error: `Invalid dayOfWeek value: "${cycle.dayOfWeek}". Expected one of: ${Object.keys(dayOfWeekToZoom).join(', ')}`
      });
    }

    if (!cycle.durationMinutes || cycle.durationMinutes <= 0) {
      return res.status(400).json({
        error: `Invalid durationMinutes: ${cycle.durationMinutes}`
      });
    }

    if (provider === 'google_meet') {
      const result = await googleMeetService.createCycleMeeting({
        topic: `${cycle.course.name} - ${cycle.name}`,
        instructorEmail: cycle.instructor.email,
        record: true,
        transcript: true,
        occurrences: meetings.map((meeting) => ({
          meetingId: meeting.id,
          lessonStart: meetingDateTimeFromDateAndTime(meeting.scheduledDate, cycle.startTime),
          durationMinutes: cycle.durationMinutes,
        })),
      });

      if (!result) {
        return res.status(503).json({ error: 'No available Google Meet hosts for this cycle schedule' });
      }

      const updatedCycle = await prisma.cycle.update({
        where: { id: cycleId },
        data: {
          videoProvider: 'google_meet',
          zoomHostId: result.hostEmail,
          zoomHostEmail: result.hostEmail,
          zoomMeetingId: result.id,
          zoomJoinUrl: result.joinUrl,
          zoomHostKey: null,
          zoomPassword: null,
          googleMeetSpaceName: result.spaceName ?? null,
          googleCalendarEventId: result.calendarEventId ?? null,
        },
      });

      for (const event of result.events || []) {
        if (!event.meetingId) continue;
        await prisma.meeting.update({
          where: { id: event.meetingId },
          data: {
            videoProvider: 'google_meet',
            zoomMeetingId: result.id,
            zoomJoinUrl: result.joinUrl,
            zoomPassword: null,
            zoomHostKey: null,
            zoomHostEmail: result.hostEmail,
            googleMeetSpaceName: result.spaceName ?? null,
            googleCalendarEventId: event.calendarEventId,
          },
        });
      }

      return res.json({
        success: true,
        cycle: {
          id: updatedCycle.id,
          name: updatedCycle.name,
          videoProvider: updatedCycle.videoProvider,
          zoomMeetingId: updatedCycle.zoomMeetingId,
          zoomJoinUrl: updatedCycle.zoomJoinUrl,
          zoomHostKey: updatedCycle.zoomHostKey,
          zoomPassword: updatedCycle.zoomPassword,
        },
        hostUser: { id: result.hostEmail, email: result.hostEmail, name: result.hostEmail },
      });
    }

    // Create the meeting using actual meeting dates
    const result = await zoomService.createCycleMeeting({
      cycleName: `${cycle.course.name} - ${cycle.name}`,
      startDate: firstDate,
      endDate: lastDate,
      dayOfWeek: zoomDayOfWeek,
      startTime: startTimeStr,
      durationMinutes: cycle.durationMinutes,
      totalOccurrences: Math.max(weeksCount, meetings.length)
    });

    if (!result) {
      return res.status(503).json({ 
        error: 'No available Zoom users for this time slot' 
      });
    }

    const { meeting, hostUser } = result;
    const joinUrl = zoomService.getDirectJoinUrl(meeting);

    // Update cycle with Zoom details
    const updatedCycle = await prisma.cycle.update({
      where: { id: cycleId },
      data: {
        zoomHostId: hostUser.id,
        zoomHostEmail: hostUser.email,
        zoomMeetingId: String(meeting.id),
        zoomJoinUrl: joinUrl,
        zoomHostKey: meeting.host_key || null,
        zoomPassword: meeting.password,
        videoProvider: 'zoom',
        googleMeetSpaceName: null,
        googleCalendarEventId: null,
      }
    });

    // Update all meetings with the Zoom details so they're accessible from each meeting
    await prisma.meeting.updateMany({
      where: { cycleId, deletedAt: null },
      data: {
        zoomMeetingId: String(meeting.id),
        zoomJoinUrl: joinUrl,
        zoomPassword: meeting.password,
        zoomHostKey: meeting.host_key || null,
        zoomHostEmail: hostUser.email,
        videoProvider: 'zoom',
        googleMeetSpaceName: null,
        googleCalendarEventId: null,
      }
    });

    res.json({
      success: true,
      cycle: {
        id: updatedCycle.id,
        name: updatedCycle.name,
        videoProvider: updatedCycle.videoProvider,
        zoomMeetingId: updatedCycle.zoomMeetingId,
        zoomJoinUrl: updatedCycle.zoomJoinUrl,
        zoomHostKey: updatedCycle.zoomHostKey,
        zoomPassword: updatedCycle.zoomPassword
      },
      hostUser: {
        id: hostUser.id,
        email: hostUser.email,
        name: `${hostUser.first_name} ${hostUser.last_name}`
      }
    });
  } catch (error: any) {
    console.error('Failed to create Zoom meeting:', error);
    const zoomErrorData = error.response?.data;
    console.error('Zoom API error details:', JSON.stringify(zoomErrorData, null, 2));
    res.status(500).json({ 
      error: 'Failed to create Zoom meeting',
      details: error.message,
      zoomError: zoomErrorData || null
    });
  }
});

/**
 * DELETE /api/zoom/cycles/:cycleId/meeting
 * Delete a Zoom meeting from a cycle
 */
router.delete('/cycles/:cycleId/meeting', managerOrAdmin, async (req: Request, res: Response) => {
  try {
    const { cycleId } = req.params;

    const cycle = await prisma.cycle.findUnique({
      where: { id: cycleId }
    });

    if (!cycle) {
      return res.status(404).json({ error: 'Cycle not found' });
    }

    if (!cycle.zoomMeetingId) {
      return res.status(400).json({ error: 'Cycle has no Zoom meeting' });
    }

    if ((cycle.videoProvider ?? 'zoom') === 'zoom') {
      // Delete cloud recordings first (must be done before deleting the meeting)
      try {
        await zoomService.deleteRecordings(cycle.zoomMeetingId);
      } catch (error: any) {
        console.log(`[Zoom] Could not delete recordings: ${error.message}`);
      }

      // Delete meeting from Zoom
      try {
        await zoomService.deleteMeeting(cycle.zoomMeetingId);
      } catch (error: any) {
        // Ignore 404 errors (meeting already deleted)
        if (error.response?.status !== 404) {
          throw error;
        }
      }
    }

    // Clear Zoom fields from cycle
    await prisma.cycle.update({
      where: { id: cycleId },
      data: {
        zoomHostId: null,
        zoomHostEmail: null,
        zoomMeetingId: null,
        zoomJoinUrl: null,
        zoomHostKey: null,
        zoomPassword: null,
        videoProvider: 'zoom',
        googleMeetSpaceName: null,
        googleCalendarEventId: null,
      }
    });

    // Clear Zoom fields and recording data from all meetings
    await prisma.meeting.updateMany({
      where: { cycleId },
      data: {
        zoomMeetingId: null,
        zoomJoinUrl: null,
        zoomPassword: null,
        zoomHostKey: null,
        zoomHostEmail: null,
        videoProvider: 'zoom',
        googleMeetSpaceName: null,
        googleCalendarEventId: null,
        zoomRecordingUrl: null,
        zoomRecordingPassword: null,
        lessonTranscript: null
      }
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error('Failed to delete Zoom meeting:', error);
    res.status(500).json({ 
      error: 'Failed to delete Zoom meeting',
      details: error.message 
    });
  }
});

/**
 * GET /api/zoom/cycles/:cycleId/meeting
 * Get Zoom meeting details for a cycle
 */
router.get('/cycles/:cycleId/meeting', async (req: Request, res: Response) => {
  try {
    const { cycleId } = req.params;

    const cycle = await prisma.cycle.findUnique({
      where: { id: cycleId },
      select: {
        id: true,
        name: true,
        activityType: true,
        zoomHostId: true,
        zoomHostEmail: true,
        zoomMeetingId: true,
        zoomJoinUrl: true,
        zoomHostKey: true,
        zoomPassword: true,
        videoProvider: true,
        googleMeetSpaceName: true,
        googleCalendarEventId: true,
      }
    });

    if (!cycle) {
      return res.status(404).json({ error: 'Cycle not found' });
    }

    if (!cycle.zoomMeetingId) {
      return res.json({ 
        hasMeeting: false,
        canCreate: cycle.activityType === 'online'
      });
    }

    const provider = cycle.videoProvider ?? 'zoom';
    const meeting = provider === 'zoom'
      ? await zoomService.getMeeting(cycle.zoomMeetingId)
      : null;

    res.json({
      hasMeeting: true,
      meetingExists: provider === 'zoom' ? !!meeting : true,
      videoProvider: provider,
      zoomMeetingId: cycle.zoomMeetingId,
      zoomJoinUrl: cycle.zoomJoinUrl,
      zoomHostKey: cycle.zoomHostKey,
      zoomPassword: cycle.zoomPassword,
      zoomHostEmail: cycle.zoomHostEmail,
      googleMeetSpaceName: cycle.googleMeetSpaceName,
      googleCalendarEventId: cycle.googleCalendarEventId,
    });
  } catch (error: any) {
    console.error('Failed to get Zoom meeting:', error);
    res.status(500).json({ 
      error: 'Failed to get Zoom meeting',
      details: error.message 
    });
  }
});

export default router;
