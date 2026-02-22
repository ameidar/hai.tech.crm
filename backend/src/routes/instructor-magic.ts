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
import { sendWhatsAppMessage } from '../services/notifications.js';

const ADMIN_PHONE = '0528746137';

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
    const { status, topic, attendance, requestReason } = req.body;
    
    const verification = verifyMeetingMagicLink(token);
    
    if (!verification.valid || verification.meetingId !== meetingId) {
      return res.status(401).json({ error: 'INVALID_TOKEN' });
    }
    
    // Verify meeting belongs to instructor
    const meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
      include: {
        instructor: { select: { name: true, phone: true } },
        cycle: { 
          include: {
            branch: { select: { name: true } },
            course: { select: { name: true } },
          }
        }
      }
    });
    
    if (!meeting || meeting.instructorId !== verification.instructorId) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }

    const isPendingRequest = status === 'pending_cancellation' || status === 'pending_postponement';
    
    // Update meeting
    const updates: any = {};
    if (status) updates.status = status;
    if (topic !== undefined) updates.topic = topic;
    // Store request reason in notes for pending requests
    if (isPendingRequest && requestReason) {
      updates.notes = requestReason;
    }
    
    if (Object.keys(updates).length > 0) {
      await prisma.meeting.update({
        where: { id: meetingId },
        data: updates,
      });
    }
    
    // Update attendance (only for completed meetings)
    if (status !== 'pending_cancellation' && status !== 'pending_postponement' && attendance && Array.isArray(attendance)) {
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

    // Send WhatsApp notification to admin for pending requests
    if (isPendingRequest) {
      try {
        const requestType = status === 'pending_cancellation' ? 'ביטול' : 'דחיה';
        const dateStr = new Date(meeting.scheduledDate).toLocaleDateString('he-IL', { 
          weekday: 'long', day: 'numeric', month: 'long' 
        });
        const message = `⚠️ *בקשת ${requestType} מחכה לאישור*\n\n` +
          `👩‍🏫 מדריך: ${meeting.instructor?.name}\n` +
          `📚 ${meeting.cycle?.course?.name} - ${meeting.cycle?.name}\n` +
          `📍 ${meeting.cycle?.branch?.name || 'לא ידוע'}\n` +
          `📅 ${dateStr}\n` +
          (requestReason ? `\n💬 סיבה: ${requestReason}\n` : '') +
          `\n🔗 לאישור/דחיית הבקשה היכנס למערכת`;
        
        await sendWhatsAppMessage(ADMIN_PHONE, message);
      } catch (notifyErr) {
        console.error('Failed to send admin notification:', notifyErr);
        // Don't fail the request if notification fails
      }
    }
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('Error updating via magic link:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/instructor-magic/pending-requests
 * Get all meetings pending cancellation or postponement approval (admin only)
 */
router.get('/pending-requests', authenticate, adminOnly, async (_req: Request, res: Response) => {
  try {
    const pending = await prisma.meeting.findMany({
      where: {
        status: { in: ['pending_cancellation', 'pending_postponement'] },
        deletedAt: null,
      },
      include: {
        instructor: { select: { id: true, name: true, phone: true } },
        cycle: {
          include: {
            branch: { select: { id: true, name: true } },
            course: { select: { id: true, name: true } },
          }
        }
      },
      orderBy: { scheduledDate: 'asc' },
    });
    
    res.json({ requests: pending });
  } catch (error) {
    console.error('Error fetching pending requests:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/instructor-magic/approve-request/:meetingId
 * Approve a pending cancellation/postponement request (admin only)
 */
router.post('/approve-request/:meetingId', authenticate, adminOnly, async (req: Request, res: Response) => {
  try {
    const { meetingId } = req.params;
    const { action, adminNotes } = req.body; // action: 'approve' | 'reject'
    
    const meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
      include: { instructor: { select: { name: true, phone: true } } }
    });
    
    if (!meeting) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }
    
    if (meeting.status !== 'pending_cancellation' && meeting.status !== 'pending_postponement') {
      return res.status(400).json({ error: 'NOT_PENDING', message: 'הפגישה אינה ממתינה לאישור' });
    }
    
    let newStatus: string;
    if (action === 'approve') {
      newStatus = meeting.status === 'pending_cancellation' ? 'cancelled' : 'postponed';
    } else {
      newStatus = 'scheduled'; // Rejected — revert to scheduled
    }
    
    await prisma.meeting.update({
      where: { id: meetingId },
      data: { 
        status: newStatus as any,
        notes: adminNotes || meeting.notes,
      },
    });
    
    // Notify instructor via WhatsApp
    try {
      if (meeting.instructor?.phone) {
        const requestType = meeting.status === 'pending_cancellation' ? 'ביטול' : 'דחיה';
        const approved = action === 'approve';
        const icon = approved ? '✅' : '❌';
        const message = `${icon} *בקשת ה${requestType} שלך ${approved ? 'אושרה' : 'לא אושרה'}*\n\n` +
          `📅 הפגישה בתאריך ${new Date(meeting.scheduledDate).toLocaleDateString('he-IL')}\n` +
          (adminNotes ? `💬 הערת מנהל: ${adminNotes}` : '');
        await sendWhatsAppMessage(meeting.instructor.phone, message);
      }
    } catch (notifyErr) {
      console.error('Failed to notify instructor:', notifyErr);
    }
    
    res.json({ success: true, newStatus });
  } catch (error) {
    console.error('Error approving request:', error);
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
