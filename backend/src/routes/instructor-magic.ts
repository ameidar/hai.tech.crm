/**
 * Instructor Magic Link Routes
 * Allows instructors to access their meetings without login
 * 
 * ⚠️ TEST ONLY - Not for production
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../utils/prisma.js';
import { 
  verifyMeetingMagicLink, 
  previewDailyReminders,
  formatWhatsAppReminder,
  getDailyMeetingsForInstructors 
} from '../services/instructor-reminder.service.js';
import { authenticate, adminOnly } from '../middleware/auth.js';

const router = Router();

/**
 * GET /api/instructor-magic/verify/:meetingId/:token
 * Verify magic link and return meeting details
 */
router.get('/verify/:meetingId/:token', async (req: Request, res: Response) => {
  try {
    const { meetingId, token } = req.params;
    
    const verification = verifyMeetingMagicLink(token);
    
    if (!verification.valid) {
      return res.status(401).json({ 
        error: 'INVALID_TOKEN',
        message: verification.error || 'הלינק לא תקף או פג תוקף'
      });
    }
    
    if (verification.meetingId !== meetingId) {
      return res.status(401).json({ 
        error: 'TOKEN_MISMATCH',
        message: 'הלינק לא תואם לפגישה'
      });
    }
    
    // Get meeting details
    const meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
      include: {
        instructor: {
          select: { id: true, name: true }
        },
        cycle: {
          include: {
            branch: { select: { id: true, name: true } },
            course: { select: { id: true, name: true } },
          }
        }
      }
    });
    
    if (!meeting) {
      return res.status(404).json({ 
        error: 'NOT_FOUND',
        message: 'פגישה לא נמצאה'
      });
    }
    
    // Verify instructor matches
    if (meeting.instructorId !== verification.instructorId) {
      return res.status(403).json({ 
        error: 'FORBIDDEN',
        message: 'אין הרשאה לפגישה זו'
      });
    }
    
    // Get attendance
    const attendance = await prisma.attendance.findMany({
      where: { meetingId },
      include: {
        registration: {
          include: {
            student: {
              include: {
                customer: {
                  select: { name: true, phone: true }
                }
              }
            }
          }
        }
      }
    });
    
    // Get registered students for this cycle
    const registrations = await prisma.registration.findMany({
      where: { 
        cycleId: meeting.cycleId,
        status: { in: ['registered', 'active', 'trial'] },
        deletedAt: null,
      },
      include: {
        student: {
          include: {
            customer: {
              select: { name: true, phone: true }
            }
          }
        }
      }
    });
    
    // Build attendance list
    const attendanceMap = new Map(attendance.map(a => [a.registrationId, a]));
    
    const attendanceList = registrations.map(reg => {
      const existing = attendanceMap.get(reg.id);
      return {
        registrationId: reg.id,
        studentId: reg.studentId,
        studentName: reg.student.name,
        grade: reg.student.grade,
        customerName: reg.student.customer?.name,
        customerPhone: reg.student.customer?.phone,
        status: existing?.status || null,
        isTrial: reg.status === 'trial',
      };
    });
    
    res.json({
      meeting: {
        id: meeting.id,
        scheduledDate: meeting.scheduledDate,
        startTime: meeting.startTime,
        endTime: meeting.endTime,
        status: meeting.status,
        topic: meeting.topic,
        notes: meeting.notes,
        cycleName: meeting.cycle?.name,
        branchName: meeting.cycle?.branch?.name,
        courseName: meeting.cycle?.course?.name,
        activityType: meeting.cycle?.activityType,
        zoomJoinUrl: meeting.zoomJoinUrl,
      },
      instructor: {
        id: meeting.instructor?.id,
        name: meeting.instructor?.name,
      },
      attendance: attendanceList,
      stats: {
        total: attendanceList.length,
        present: attendanceList.filter(a => a.status === 'present').length,
        absent: attendanceList.filter(a => a.status === 'absent').length,
        unmarked: attendanceList.filter(a => !a.status).length,
      }
    });
    
  } catch (error) {
    console.error('Error verifying magic link:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'שגיאה בשרת' });
  }
});

/**
 * POST /api/instructor-magic/update/:meetingId/:token
 * Update meeting via magic link
 */
router.post('/update/:meetingId/:token', async (req: Request, res: Response) => {
  try {
    const { meetingId, token } = req.params;
    const { status, topic, attendance } = req.body;
    
    const verification = verifyMeetingMagicLink(token);
    
    if (!verification.valid || verification.meetingId !== meetingId) {
      return res.status(401).json({ error: 'INVALID_TOKEN' });
    }
    
    // Verify meeting belongs to instructor
    const meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { instructorId: true }
    });
    
    if (!meeting || meeting.instructorId !== verification.instructorId) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }
    
    // Update meeting
    const updates: any = {};
    if (status) updates.status = status;
    if (topic !== undefined) updates.topic = topic;
    
    if (Object.keys(updates).length > 0) {
      await prisma.meeting.update({
        where: { id: meetingId },
        data: updates,
      });
    }
    
    // Update attendance
    if (attendance && Array.isArray(attendance)) {
      for (const record of attendance) {
        if (!record.registrationId || !record.status) continue;
        
        await prisma.attendance.upsert({
          where: {
            meetingId_registrationId: {
              meetingId,
              registrationId: record.registrationId,
            }
          },
          create: {
            meetingId,
            registrationId: record.registrationId,
            studentId: record.studentId,
            status: record.status,
            isTrial: record.isTrial || false,
          },
          update: {
            status: record.status,
          }
        });
      }
    }
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('Error updating via magic link:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/instructor-magic/preview-reminders
 * Preview today's reminders (admin only, for testing)
 */
router.get('/preview-reminders', authenticate, adminOnly, async (_req: Request, res: Response) => {
  try {
    const preview = await previewDailyReminders();
    
    // Add formatted messages
    const withMessages = preview.summaries.map(summary => ({
      ...summary,
      whatsappMessage: formatWhatsAppReminder(summary),
    }));
    
    res.json({
      date: preview.date,
      instructorCount: preview.instructorCount,
      totalMeetings: preview.totalMeetings,
      reminders: withMessages,
    });
    
  } catch (error) {
    console.error('Error previewing reminders:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/instructor-magic/send-test/:instructorId
 * Send test reminder to a specific instructor (admin only)
 */
router.post('/send-test/:instructorId', authenticate, adminOnly, async (req: Request, res: Response) => {
  try {
    const { instructorId } = req.params;
    const summaries = await getDailyMeetingsForInstructors();
    const summary = summaries.find(s => s.instructorId === instructorId);
    
    if (!summary) {
      return res.status(404).json({ 
        error: 'NO_MEETINGS',
        message: 'למדריך אין פגישות היום'
      });
    }
    
    const message = formatWhatsAppReminder(summary);
    
    // For testing - just return the message
    res.json({
      success: true,
      instructor: {
        id: summary.instructorId,
        name: summary.instructorName,
        phone: summary.instructorPhone,
      },
      meetingsCount: summary.meetings.length,
      message,
      magicLinks: summary.magicLinks,
    });
    
  } catch (error) {
    console.error('Error sending test reminder:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

export { router as instructorMagicRouter };
