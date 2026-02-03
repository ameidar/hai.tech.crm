import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { zoomService } from '../services/zoom';

const router = Router();
const prisma = new PrismaClient();

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
 * POST /api/zoom/cycles/:cycleId/meeting
 * Create a Zoom meeting for a cycle
 */
router.post('/cycles/:cycleId/meeting', async (req: Request, res: Response) => {
  try {
    const { cycleId } = req.params;

    // Get cycle details
    const cycle = await prisma.cycle.findUnique({
      where: { id: cycleId },
      include: { course: true }
    });

    if (!cycle) {
      return res.status(404).json({ error: 'Cycle not found' });
    }

    // Check if cycle is online
    if (cycle.activityType !== 'online') {
      return res.status(400).json({ 
        error: 'Zoom meetings can only be created for online cycles' 
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

    // Create the meeting using actual meeting dates
    const result = await zoomService.createCycleMeeting({
      cycleName: `${cycle.course.name} - ${cycle.name}`,
      startDate: firstDate,
      endDate: lastDate,
      dayOfWeek: dayOfWeekToZoom[cycle.dayOfWeek],
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

    // Update cycle with Zoom details
    const updatedCycle = await prisma.cycle.update({
      where: { id: cycleId },
      data: {
        zoomHostId: hostUser.id,
        zoomHostEmail: hostUser.email,
        zoomMeetingId: String(meeting.id),
        zoomJoinUrl: meeting.join_url,
        zoomHostKey: meeting.host_key || null,
        zoomPassword: meeting.password
      }
    });

    // Update all meetings with the Zoom details so they're accessible from each meeting
    await prisma.meeting.updateMany({
      where: { cycleId, deletedAt: null },
      data: {
        zoomMeetingId: String(meeting.id),
        zoomJoinUrl: meeting.join_url,
        zoomPassword: meeting.password,
        zoomHostKey: meeting.host_key || null,
        zoomHostEmail: hostUser.email
      }
    });

    res.json({
      success: true,
      cycle: {
        id: updatedCycle.id,
        name: updatedCycle.name,
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
    res.status(500).json({ 
      error: 'Failed to create Zoom meeting',
      details: error.message 
    });
  }
});

/**
 * DELETE /api/zoom/cycles/:cycleId/meeting
 * Delete a Zoom meeting from a cycle
 */
router.delete('/cycles/:cycleId/meeting', async (req: Request, res: Response) => {
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

    // Delete meeting from Zoom
    try {
      await zoomService.deleteMeeting(cycle.zoomMeetingId);
    } catch (error: any) {
      // Ignore 404 errors (meeting already deleted)
      if (error.response?.status !== 404) {
        throw error;
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
        zoomPassword: null
      }
    });

    // Clear Zoom fields from all meetings
    await prisma.meeting.updateMany({
      where: { cycleId },
      data: {
        zoomMeetingId: null,
        zoomJoinUrl: null,
        zoomPassword: null,
        zoomHostKey: null,
        zoomHostEmail: null
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
        zoomPassword: true
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

    // Optionally verify meeting still exists in Zoom
    const meeting = await zoomService.getMeeting(cycle.zoomMeetingId);

    res.json({
      hasMeeting: true,
      meetingExists: !!meeting,
      zoomMeetingId: cycle.zoomMeetingId,
      zoomJoinUrl: cycle.zoomJoinUrl,
      zoomHostKey: cycle.zoomHostKey,
      zoomPassword: cycle.zoomPassword,
      zoomHostEmail: cycle.zoomHostEmail
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
