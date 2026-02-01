import { Router } from 'express';
import { prisma } from '../utils/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import crypto from 'crypto';

const MEETING_TOKEN_SECRET = process.env.MEETING_TOKEN_SECRET || 'haitech-meeting-status-2026';

export const publicMeetingRouter = Router();

// Generate token for a meeting (used internally)
export function generateMeetingToken(meetingId: string): string {
  const hmac = crypto.createHmac('sha256', MEETING_TOKEN_SECRET);
  hmac.update(meetingId);
  return hmac.digest('hex').substring(0, 16);
}

// Verify token for a meeting
function verifyMeetingToken(meetingId: string, token: string): boolean {
  return generateMeetingToken(meetingId) === token;
}

// Get meeting info by token (public)
publicMeetingRouter.get('/:meetingId/:token', async (req, res, next) => {
  try {
    const { meetingId, token } = req.params;

    if (!verifyMeetingToken(meetingId, token)) {
      throw new AppError(403, 'קישור לא תקין');
    }

    const meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
      include: {
        cycle: {
          include: {
            course: { select: { id: true, name: true } },
            branch: { select: { id: true, name: true } },
            registrations: {
              where: { status: { in: ['registered', 'active'] } },
              include: {
                student: { select: { id: true, name: true } },
              },
            },
          },
        },
        instructor: { select: { id: true, name: true } },
        attendance: {
          include: {
            registration: {
              include: {
                student: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    if (!meeting) {
      throw new AppError(404, 'פגישה לא נמצאה');
    }

    res.json(meeting);
  } catch (error) {
    next(error);
  }
});

// Update meeting status (public)
publicMeetingRouter.put('/:meetingId/:token/status', async (req, res, next) => {
  try {
    const { meetingId, token } = req.params;
    const { status, notes, attendance } = req.body;

    if (!verifyMeetingToken(meetingId, token)) {
      throw new AppError(403, 'קישור לא תקין');
    }

    const validStatuses = ['completed', 'cancelled', 'no_show'];
    if (!validStatuses.includes(status)) {
      throw new AppError(400, 'סטטוס לא תקין');
    }

    const existingMeeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
      include: { 
        cycle: {
          include: {
            instructor: true,
            registrations: {
              where: { status: { in: ['registered', 'active'] } },
            },
          },
        },
        instructor: true,
      },
    });

    if (!existingMeeting) {
      throw new AppError(404, 'פגישה לא נמצאה');
    }

    // Calculate financials if completing
    let updateData: any = {
      status,
      notes: notes || null,
      statusUpdatedAt: new Date(),
    };

    if (status === 'completed') {
      const cycleData = existingMeeting.cycle;
      
      // Calculate revenue
      let revenue = 0;
      if (cycleData.type === 'private') {
        const totalRegistrationAmount = cycleData.registrations.reduce(
          (sum, reg) => sum + (reg.amount ? Number(reg.amount) : 0),
          0
        );
        revenue = Math.round(totalRegistrationAmount / cycleData.totalMeetings);
      } else if (cycleData.type === 'institutional_per_child') {
        const pricePerStudent = Number(cycleData.pricePerStudent || 0);
        const studentCount = cycleData.studentCount || cycleData.registrations.filter(r => r.status === 'active').length;
        revenue = Math.round(pricePerStudent * studentCount);
      } else if (cycleData.type === 'institutional_fixed') {
        revenue = Number(cycleData.meetingRevenue || 0);
      }

      // Calculate instructor payment
      const instructor = existingMeeting.instructor;
      let instructorPayment = 0;
      if (instructor) {
        let hourlyRate = 0;
        if (cycleData.type === 'private') {
          hourlyRate = Number(instructor.ratePrivate || instructor.rateFrontal || 0);
        } else if (cycleData.isOnline) {
          hourlyRate = Number(instructor.rateOnline || 0);
        } else {
          hourlyRate = Number(instructor.rateFrontal || 0);
        }
        
        const durationHours = cycleData.durationMinutes / 60;
        instructorPayment = Math.round(hourlyRate * durationHours);
      }

      updateData.revenue = revenue;
      updateData.instructorPayment = instructorPayment;
      updateData.profit = revenue - instructorPayment;

      // Update cycle counters
      if (existingMeeting.status !== 'completed') {
        await prisma.cycle.update({
          where: { id: existingMeeting.cycleId },
          data: {
            completedMeetings: { increment: 1 },
            remainingMeetings: { decrement: 1 },
          },
        });
      }
    }

    const meeting = await prisma.meeting.update({
      where: { id: meetingId },
      data: updateData,
    });

    // Update attendance if provided
    if (attendance && Array.isArray(attendance)) {
      // Get or create a system user for public updates
      let systemUser = await prisma.user.findFirst({
        where: { email: 'system@haitech.co.il' },
      });
      
      if (!systemUser) {
        // Use the instructor's user ID if available
        const instructor = await prisma.instructor.findUnique({
          where: { id: existingMeeting.instructorId },
          select: { userId: true },
        });
        if (instructor?.userId) {
          systemUser = await prisma.user.findUnique({ where: { id: instructor.userId } });
        }
      }

      for (const att of attendance) {
        if (att.registrationId && att.status) {
          await prisma.attendance.upsert({
            where: {
              meetingId_registrationId: {
                meetingId,
                registrationId: att.registrationId,
              },
            },
            create: {
              meetingId,
              registrationId: att.registrationId,
              status: att.status,
              notes: att.notes || null,
              recordedById: systemUser?.id || existingMeeting.instructorId,
            },
            update: {
              status: att.status,
              notes: att.notes || null,
            },
          });
        }
      }
    }

    res.json({ success: true, meeting });
  } catch (error) {
    next(error);
  }
});
