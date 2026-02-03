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

    // Format start time from Time field
    const startTimeDate = new Date(cycle.startTime);
    const startTimeStr = `${startTimeDate.getUTCHours().toString().padStart(2, '0')}:${startTimeDate.getUTCMinutes().toString().padStart(2, '0')}`;

    // Create the meeting
    const result = await zoomService.createCycleMeeting({
      cycleName: `${cycle.course.name} - ${cycle.name}`,
      startDate: new Date(cycle.startDate),
      endDate: new Date(cycle.endDate),
      dayOfWeek: dayOfWeekToZoom[cycle.dayOfWeek],
      startTime: startTimeStr,
      durationMinutes: cycle.durationMinutes
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
        zoomMeetingId: String(meeting.id),
        zoomJoinUrl: meeting.join_url,
        zoomHostKey: meeting.host_key || null,
        zoomPassword: meeting.password
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
        zoomMeetingId: null,
        zoomJoinUrl: null,
        zoomHostKey: null,
        zoomPassword: null
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
      zoomPassword: cycle.zoomPassword
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
