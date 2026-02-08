import { Router } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { updateMeetingSchema, postponeMeetingSchema, paginationSchema, uuidSchema } from '../types/schemas.js';
import { logAudit } from '../utils/audit.js';
import { zoomService } from '../services/zoom.js';

// Send WhatsApp alert for negative profit
async function sendNegativeProfitAlert(meetingData: {
  cycleName: string;
  courseName: string;
  branchName: string;
  instructorName: string;
  date: string;
  revenue: number;
  cost: number;
  profit: number;
}) {
  const alertPhone = process.env.ALERT_PHONE || '972528746137';
  const greenApiInstanceId = process.env.GREEN_API_INSTANCE_ID;
  const greenApiToken = process.env.GREEN_API_TOKEN;

  if (!greenApiInstanceId || !greenApiToken) {
    console.log('Green API not configured, skipping WhatsApp alert');
    return;
  }

  const message = `⚠️ התראה: רווח שלילי בפגישה

📅 תאריך: ${meetingData.date}
📚 מחזור: ${meetingData.cycleName}
🎓 קורס: ${meetingData.courseName}
🏢 סניף: ${meetingData.branchName}
👨‍🏫 מדריך: ${meetingData.instructorName}

💰 הכנסה: ₪${meetingData.revenue}
💸 עלות: ₪${meetingData.cost}
📉 רווח: ₪${meetingData.profit}`;

  try {
    const response = await fetch(
      `https://api.green-api.com/waInstance${greenApiInstanceId}/sendMessage/${greenApiToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId: `${alertPhone}@c.us`,
          message,
        }),
      }
    );

    if (!response.ok) {
      console.error('Failed to send WhatsApp alert:', await response.text());
    } else {
      console.log('WhatsApp alert sent for negative profit');
    }
  } catch (error) {
    console.error('Error sending WhatsApp alert:', error);
  }
}

export const meetingsRouter = Router();

meetingsRouter.use(authenticate);

// List meetings
meetingsRouter.get('/', async (req, res, next) => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const date = req.query.date as string | undefined;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const status = req.query.status as string | undefined;
    let instructorId = req.query.instructorId as string | undefined;
    const cycleId = req.query.cycleId as string | undefined;
    const branchId = req.query.branchId as string | undefined;

    // If user is an instructor, only show their meetings
    if (req.user!.role === 'instructor') {
      const instructor = await prisma.instructor.findUnique({
        where: { userId: req.user!.userId },
        select: { id: true },
      });
      if (instructor) {
        instructorId = instructor.id;
      }
    }

    const where = {
      ...(date && { scheduledDate: new Date(date) }),
      ...(from && to && {
        scheduledDate: {
          gte: new Date(from),
          lte: new Date(to),
        },
      }),
      ...(status && { status: status as any }),
      ...(instructorId && { instructorId }),
      ...(cycleId && { cycleId }),
      ...(branchId && { cycle: { branchId } }),
    };

    const [meetings, total] = await Promise.all([
      prisma.meeting.findMany({
        where,
        include: {
          cycle: {
            include: {
              course: { select: { id: true, name: true } },
              branch: { select: { id: true, name: true } },
            },
          },
          instructor: { select: { id: true, name: true, phone: true } },
          _count: { select: { attendance: true } },
        },
        orderBy: [
          { scheduledDate: 'asc' },
          { startTime: 'asc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.meeting.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);
    res.json({
      data: meetings,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Get meeting by ID
meetingsRouter.get('/:id', async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);

    const meeting = await prisma.meeting.findUnique({
      where: { id },
      include: {
        cycle: {
          include: {
            course: true,
            branch: true,
            registrations: {
              where: { status: { in: ['registered', 'active'] } },
              include: {
                student: {
                  include: {
                    customer: { select: { id: true, name: true, phone: true } },
                  },
                },
              },
            },
          },
        },
        instructor: true,
        attendance: {
          include: {
            registration: {
              include: {
                student: { select: { id: true, name: true } },
              },
            },
            recordedBy: { select: { id: true, name: true } },
          },
        },
        statusUpdatedBy: { select: { id: true, name: true } },
        rescheduledTo: { select: { id: true, scheduledDate: true } },
        rescheduledFrom: { select: { id: true, scheduledDate: true } },
      },
    });

    if (!meeting) {
      throw new AppError(404, 'Meeting not found');
    }

    res.json(meeting);
  } catch (error) {
    next(error);
  }
});

// Create exceptional/ad-hoc meeting for a cycle
meetingsRouter.post('/', managerOrAdmin, async (req, res, next) => {
  try {
    const { cycleId, instructorId, scheduledDate, startTime, endTime, withZoom, activityType, topic, notes } = req.body;

    if (!cycleId || !instructorId || !scheduledDate || !startTime || !endTime) {
      throw new AppError(400, 'Missing required fields: cycleId, instructorId, scheduledDate, startTime, endTime');
    }

    // Get cycle details for revenue calculation
    const cycle = await prisma.cycle.findUnique({
      where: { id: cycleId },
      include: { 
        course: true,
        registrations: {
          where: { status: { in: ['registered', 'active'] } },
        },
      },
    });

    if (!cycle) {
      throw new AppError(404, 'Cycle not found');
    }

    // Get instructor for cost calculation
    const instructor = await prisma.instructor.findUnique({
      where: { id: instructorId },
    });

    if (!instructor) {
      throw new AppError(404, 'Instructor not found');
    }

    // Calculate duration in minutes
    const [startHour, startMin] = startTime.split(':').map(Number);
    const [endHour, endMin] = endTime.split(':').map(Number);
    const durationMinutes = (endHour * 60 + endMin) - (startHour * 60 + startMin);

    // Calculate revenue based on cycle type
    let revenue = 0;
    if (cycle.type === 'institutional_fixed' && cycle.meetingRevenue) {
      revenue = Number(cycle.meetingRevenue);
    } else if (cycle.type === 'institutional_per_child' && cycle.pricePerStudent) {
      const studentCount = cycle.studentCount || cycle.registrations.length;
      revenue = Number(cycle.pricePerStudent) * studentCount;
    } else if (cycle.type === 'private' && cycle.pricePerStudent) {
      revenue = Number(cycle.pricePerStudent) * cycle.registrations.length;
    }

    // Calculate instructor payment based on activity type
    const meetingActivityType = activityType || cycle.activityType || 'frontal';
    let hourlyRate = 0;
    if (meetingActivityType === 'online') {
      hourlyRate = Number(instructor.rateOnline) || Number(instructor.rateFrontal) || 0;
    } else if (meetingActivityType === 'private_lesson') {
      hourlyRate = Number(instructor.ratePrivate) || Number(instructor.rateFrontal) || 0;
    } else {
      hourlyRate = Number(instructor.rateFrontal) || 0;
    }
    const instructorPayment = Math.round(hourlyRate * (durationMinutes / 60));
    const profit = revenue - instructorPayment;

    // Create the meeting
    const meeting = await prisma.meeting.create({
      data: {
        cycleId,
        instructorId,
        scheduledDate: new Date(scheduledDate),
        startTime: new Date(`1970-01-01T${startTime}:00Z`),
        endTime: new Date(`1970-01-01T${endTime}:00Z`),
        status: 'scheduled',
        activityType: activityType || cycle.activityType || 'frontal',
        topic,
        notes,
        revenue,
        instructorPayment,
        profit,
      },
      include: {
        cycle: { include: { course: true, branch: true } },
        instructor: true,
      },
    });

    // Create Zoom meeting if requested
    if (withZoom) {
      try {
        const meetingDate = new Date(scheduledDate);
        const [sHour, sMin] = startTime.split(':').map(Number);
        meetingDate.setUTCHours(sHour, sMin, 0, 0);

        // Find an available Zoom user
        const availableUser = await zoomService.findAvailableUser(meetingDate, durationMinutes);
        if (availableUser) {
          const zoomMeeting = await zoomService.createMeeting(availableUser.id, {
            topic: `${cycle.course?.name || cycle.name} - פגישה חריגה`,
            startTime: meetingDate,
            duration: durationMinutes,
          });

          // Update meeting with Zoom details
          await prisma.meeting.update({
            where: { id: meeting.id },
            data: {
              zoomMeetingId: zoomMeeting.id?.toString(),
              zoomJoinUrl: zoomMeeting.join_url,
              zoomStartUrl: zoomMeeting.start_url,
              zoomPassword: zoomMeeting.password,
              zoomHostKey: zoomMeeting.host_key,
              zoomHostEmail: availableUser.email,
            },
          });

          // Merge Zoom details into response
          Object.assign(meeting, {
            zoomMeetingId: zoomMeeting.id?.toString(),
            zoomJoinUrl: zoomMeeting.join_url,
            zoomStartUrl: zoomMeeting.start_url,
            zoomPassword: zoomMeeting.password,
            zoomHostKey: zoomMeeting.host_key,
            zoomHostEmail: availableUser.email,
          });
        } else {
          console.warn('No available Zoom user found for meeting');
        }
      } catch (zoomError) {
        console.error('Failed to create Zoom meeting:', zoomError);
        // Continue without Zoom - don't fail the entire request
      }
    }

    // Update cycle meeting counts
    await prisma.cycle.update({
      where: { id: cycleId },
      data: {
        totalMeetings: { increment: 1 },
        remainingMeetings: { increment: 1 },
      },
    });

    // Log audit
    await logAudit({
      action: 'CREATE',
      entity: 'meeting',
      entityId: meeting.id,
      userId: (req.user as any)?.id,
      newValue: meeting as any,
      req,
    });

    res.status(201).json(meeting);
  } catch (error) {
    next(error);
  }
});

// Update meeting (status, notes, etc.)
meetingsRouter.put('/:id', async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const data = updateMeetingSchema.parse(req.body);

    // Check if user can update this meeting
    const existingMeeting = await prisma.meeting.findUnique({
      where: { id },
      include: { cycle: true },
    });

    if (!existingMeeting) {
      throw new AppError(404, 'Meeting not found');
    }

    // Instructors can only update on the meeting day
    if (req.user!.role === 'instructor') {
      const today = new Date().toISOString().split('T')[0];
      const meetingDate = existingMeeting.scheduledDate.toISOString().split('T')[0];
      
      if (today !== meetingDate) {
        throw new AppError(403, 'Instructors can only update meetings on the scheduled day');
      }
    }

    const updateData: any = { ...data };
    
    // Handle date and time updates
    if (data.scheduledDate) {
      updateData.scheduledDate = new Date(data.scheduledDate);
    }
    if (data.startTime) {
      updateData.startTime = new Date(`1970-01-01T${data.startTime}:00Z`);
    }
    if (data.endTime) {
      updateData.endTime = new Date(`1970-01-01T${data.endTime}:00Z`);
    }
    
    // Track status change
    if (data.status && data.status !== existingMeeting.status) {
      updateData.statusUpdatedAt = new Date();
      updateData.statusUpdatedById = req.user!.userId;
      
      // Update cycle counters and calculate financials when completed
      if (data.status === 'completed') {
        // Get full cycle data with registrations and instructor
        const cycleData = await prisma.cycle.findUnique({
          where: { id: existingMeeting.cycleId },
          include: {
            registrations: {
              where: { status: { in: ['registered', 'active'] } },
            },
            instructor: true,
          },
        });

        if (cycleData) {
          // Calculate revenue based on cycle type
          let revenue = 0;
          const activeRegistrations = cycleData.registrations.filter(reg => reg.status === 'active');
          
          if (cycleData.type === 'private') {
            // Sum all registration amounts and divide by total meetings
            const totalRegistrationAmount = cycleData.registrations.reduce(
              (sum, reg) => sum + (reg.amount ? Number(reg.amount) : 0),
              0
            );
            revenue = Math.round(totalRegistrationAmount / cycleData.totalMeetings);
          } else if (cycleData.type === 'institutional_per_child') {
            // Price per student × number of students (use studentCount if set, otherwise count registrations)
            const pricePerStudent = Number(cycleData.pricePerStudent || 0);
            const studentCount = cycleData.studentCount || activeRegistrations.length;
            revenue = Math.round(pricePerStudent * studentCount);
          } else if (cycleData.type === 'institutional_fixed') {
            // Fixed meeting revenue
            revenue = Number(cycleData.meetingRevenue || 0);
          }

          // Calculate instructor payment based on rate and duration
          // Use the MEETING's instructor (might be different from cycle default)
          const meetingInstructorId = data.instructorId || existingMeeting.instructorId;
          const instructor = await prisma.instructor.findUnique({ where: { id: meetingInstructorId } });
          
          let instructorPayment = 0;
          if (instructor) {
            // Determine rate based on activity type
            // Priority: meeting.activityType > cycle.activityType > fallback to cycle.isOnline
            const activityType = data.activityType || existingMeeting.activityType || cycleData.activityType || 
              (cycleData.isOnline ? 'online' : (cycleData.type === 'private' ? 'private_lesson' : 'frontal'));
            
            let hourlyRate = 0;
            switch (activityType) {
              case 'online':
                hourlyRate = Number(instructor.rateOnline || instructor.rateFrontal || 0);
                break;
              case 'private_lesson':
                hourlyRate = Number(instructor.ratePrivate || instructor.rateFrontal || 0);
                break;
              case 'frontal':
              default:
                hourlyRate = Number(instructor.rateFrontal || 0);
                break;
            }
            
            // Calculate duration from meeting's actual times, or fall back to cycle default
            const meetingStart = existingMeeting.startTime;
            const meetingEnd = existingMeeting.endTime;
            let durationMinutes = cycleData.durationMinutes;
            
            if (meetingStart && meetingEnd) {
              // Calculate from actual meeting times
              const startMs = meetingStart.getTime();
              const endMs = meetingEnd.getTime();
              durationMinutes = (endMs - startMs) / (1000 * 60);
            }
            
            const durationHours = durationMinutes / 60;
            instructorPayment = Math.round(hourlyRate * durationHours);
          }

          // Calculate profit
          const profit = revenue - instructorPayment;

          updateData.revenue = revenue;
          updateData.instructorPayment = instructorPayment;
          updateData.profit = profit;

          // Update cycle counters - recalculate from totalMeetings
          const updatedCompleted = cycleData.completedMeetings + 1;
          await prisma.cycle.update({
            where: { id: existingMeeting.cycleId },
            data: {
              completedMeetings: updatedCompleted,
              remainingMeetings: cycleData.totalMeetings - updatedCompleted,
            },
          });

          // Send WhatsApp alert if profit is negative
          if (profit < 0) {
            const cycleWithDetails = await prisma.cycle.findUnique({
              where: { id: existingMeeting.cycleId },
              include: {
                course: { select: { name: true } },
                branch: { select: { name: true } },
                instructor: { select: { name: true } },
              },
            });

            if (cycleWithDetails) {
              sendNegativeProfitAlert({
                cycleName: cycleWithDetails.name,
                courseName: cycleWithDetails.course.name,
                branchName: cycleWithDetails.branch.name,
                instructorName: cycleWithDetails.instructor.name,
                date: existingMeeting.scheduledDate.toLocaleDateString('he-IL'),
                revenue,
                cost: instructorPayment,
                profit,
              }).catch(err => console.error('WhatsApp alert error:', err));
            }
          }
        }
      }
      
      // Handle status change FROM completed to something else (decrement counters)
      if (existingMeeting.status === 'completed' && data.status !== 'completed') {
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
    }

    const meeting = await prisma.meeting.update({
      where: { id },
      data: updateData,
      include: {
        cycle: {
          include: {
            course: { select: { name: true } },
            branch: { select: { name: true } },
          },
        },
        instructor: { select: { id: true, name: true } },
      },
    });

    // Audit log for status changes
    if (data.status && data.status !== existingMeeting.status) {
      await logAudit({
        userId: req.user?.userId,
        action: 'UPDATE',
        entity: 'Meeting',
        entityId: meeting.id,
        oldValue: { status: existingMeeting.status },
        newValue: { status: data.status },
        req,
      });
    }

    res.json(meeting);
  } catch (error) {
    next(error);
  }
});

// Postpone meeting
meetingsRouter.post('/:id/postpone', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const data = postponeMeetingSchema.parse(req.body);

    const existingMeeting = await prisma.meeting.findUnique({
      where: { id },
      include: { cycle: true },
    });

    if (!existingMeeting) {
      throw new AppError(404, 'Meeting not found');
    }

    if (existingMeeting.status !== 'scheduled') {
      throw new AppError(400, 'Can only postpone scheduled meetings');
    }

    // Create new meeting
    const newMeeting = await prisma.meeting.create({
      data: {
        cycleId: existingMeeting.cycleId,
        instructorId: existingMeeting.instructorId,
        scheduledDate: new Date(data.newDate),
        startTime: data.newStartTime 
          ? new Date(`1970-01-01T${data.newStartTime}:00Z`)
          : existingMeeting.startTime,
        endTime: data.newEndTime
          ? new Date(`1970-01-01T${data.newEndTime}:00Z`)
          : existingMeeting.endTime,
        status: 'scheduled',
      },
    });

    // Update original meeting
    await prisma.meeting.update({
      where: { id },
      data: {
        status: 'postponed',
        statusUpdatedAt: new Date(),
        statusUpdatedById: req.user!.userId,
        rescheduledToId: newMeeting.id,
      },
    });

    // Audit log for postponement
    await logAudit({
      userId: req.user?.userId,
      action: 'UPDATE',
      entity: 'Meeting',
      entityId: id,
      oldValue: { status: existingMeeting.status },
      newValue: { status: 'postponed', rescheduledToId: newMeeting.id },
      req,
    });

    res.json({
      originalMeeting: { id, status: 'postponed' },
      newMeeting,
    });
  } catch (error) {
    next(error);
  }
});

// Get meeting attendance
meetingsRouter.get('/:id/attendance', async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);

    const attendance = await prisma.attendance.findMany({
      where: { meetingId: id },
      include: {
        registration: {
          include: {
            student: {
              include: {
                customer: { select: { name: true, phone: true } },
              },
            },
          },
        },
        recordedBy: { select: { id: true, name: true } },
      },
    });

    // Also get students who haven't been marked
    const meeting = await prisma.meeting.findUnique({
      where: { id },
      include: {
        cycle: {
          include: {
            registrations: {
              where: { status: { in: ['registered', 'active'] } },
              include: {
                student: {
                  include: {
                    customer: { select: { name: true, phone: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    const markedIds = new Set(attendance.map(a => a.registrationId));
    const unmarked = meeting?.cycle.registrations.filter(r => !markedIds.has(r.id)) || [];

    res.json({
      marked: attendance,
      unmarked,
    });
  } catch (error) {
    next(error);
  }
});

// Delete a single meeting
meetingsRouter.delete('/:id', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);

    const meeting = await prisma.meeting.findUnique({
      where: { id },
      select: { cycleId: true, status: true },
    });

    if (!meeting) {
      throw new AppError(404, 'Meeting not found');
    }

    // If meeting was completed, decrement cycle counters
    if (meeting.status === 'completed') {
      const cycleData = await prisma.cycle.findUnique({
        where: { id: meeting.cycleId },
      });
      
      if (cycleData && cycleData.completedMeetings > 0) {
        await prisma.cycle.update({
          where: { id: meeting.cycleId },
          data: {
            completedMeetings: { decrement: 1 },
            remainingMeetings: { increment: 1 },
          },
        });
      }
    }

    await prisma.meeting.delete({ where: { id } });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Recalculate meeting costs
meetingsRouter.post('/:id/recalculate', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const force = req.query.force === 'true' || req.body.force === true;

    const meeting = await prisma.meeting.findUnique({
      where: { id },
      include: {
        cycle: {
          include: {
            registrations: {
              where: { status: { in: ['registered', 'active'] } },
            },
          },
        },
        instructor: true,
      },
    });

    if (!meeting) {
      throw new AppError(404, 'Meeting not found');
    }

    if (meeting.status !== 'completed') {
      throw new AppError(400, 'Can only recalculate completed meetings');
    }

    // Skip if already has financials calculated (unless force=true)
    if (!force && meeting.revenue !== null && Number(meeting.revenue) > 0) {
      return res.json({
        success: true,
        skipped: true,
        message: 'Meeting already has financials. Use force=true to recalculate.',
        meeting,
      });
    }

    const cycleData = meeting.cycle;

    // Calculate revenue based on cycle type
    let revenue = 0;
    const activeRegistrations = cycleData.registrations.filter(reg => reg.status === 'active');

    if (cycleData.type === 'private') {
      const totalRegistrationAmount = cycleData.registrations.reduce(
        (sum, reg) => sum + (reg.amount ? Number(reg.amount) : 0),
        0
      );
      revenue = Math.round(totalRegistrationAmount / cycleData.totalMeetings);
    } else if (cycleData.type === 'institutional_per_child') {
      const pricePerStudent = Number(cycleData.pricePerStudent || 0);
      const studentCount = cycleData.studentCount || activeRegistrations.length;
      revenue = Math.round(pricePerStudent * studentCount);
    } else if (cycleData.type === 'institutional_fixed') {
      revenue = Number(cycleData.meetingRevenue || 0);
    }

    // Calculate instructor payment based on activity type
    const activityType = meeting.activityType || cycleData.activityType ||
      (cycleData.isOnline ? 'online' : (cycleData.type === 'private' ? 'private_lesson' : 'frontal'));

    const instructor = meeting.instructor;
    let instructorPayment = 0;
    if (instructor) {
      let hourlyRate = 0;
      switch (activityType) {
        case 'online':
          hourlyRate = Number(instructor.rateOnline || instructor.rateFrontal || 0);
          break;
        case 'private_lesson':
          hourlyRate = Number(instructor.ratePrivate || instructor.rateFrontal || 0);
          break;
        case 'frontal':
        default:
          hourlyRate = Number(instructor.rateFrontal || 0);
          break;
      }

      // Calculate duration from actual meeting times, or fall back to cycle default
      let durationMinutes = cycleData.durationMinutes;
      if (meeting.startTime && meeting.endTime) {
        const startMs = meeting.startTime.getTime();
        const endMs = meeting.endTime.getTime();
        const calculatedMinutes = (endMs - startMs) / (1000 * 60);
        // Only use calculated if it's positive and reasonable (< 24 hours)
        if (calculatedMinutes > 0 && calculatedMinutes < 1440) {
          durationMinutes = calculatedMinutes;
        }
      }
      
      const durationHours = durationMinutes / 60;
      instructorPayment = Math.round(hourlyRate * durationHours);
    }

    const profit = revenue - instructorPayment;

    // Update meeting
    const updatedMeeting = await prisma.meeting.update({
      where: { id },
      data: {
        revenue,
        instructorPayment,
        profit,
      },
      include: {
        cycle: {
          include: {
            course: { select: { name: true } },
            branch: { select: { name: true } },
          },
        },
        instructor: { select: { id: true, name: true } },
      },
    });

    res.json(updatedMeeting);
  } catch (error) {
    next(error);
  }
});

// Bulk recalculate meetings
meetingsRouter.post('/bulk-recalculate', managerOrAdmin, async (req, res, next) => {
  try {
    const { ids, force } = req.body;
    
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
                where: { status: { in: ['registered', 'active'] } },
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

      // Calculate revenue
      let revenue = 0;
      const activeRegistrations = cycleData.registrations.filter(reg => reg.status === 'active');

      if (cycleData.type === 'private') {
        const totalRegistrationAmount = cycleData.registrations.reduce(
          (sum, reg) => sum + (reg.amount ? Number(reg.amount) : 0),
          0
        );
        revenue = Math.round(totalRegistrationAmount / cycleData.totalMeetings);
      } else if (cycleData.type === 'institutional_per_child') {
        const pricePerStudent = Number(cycleData.pricePerStudent || 0);
        const studentCount = cycleData.studentCount || activeRegistrations.length;
        revenue = Math.round(pricePerStudent * studentCount);
      } else if (cycleData.type === 'institutional_fixed') {
        revenue = Number(cycleData.meetingRevenue || 0);
      }

      // Calculate instructor payment
      const activityType = meeting.activityType || cycleData.activityType ||
        (cycleData.isOnline ? 'online' : (cycleData.type === 'private' ? 'private_lesson' : 'frontal'));

      const instructor = meeting.instructor;
      let instructorPayment = 0;
      if (instructor) {
        let hourlyRate = 0;
        switch (activityType) {
          case 'online':
            hourlyRate = Number(instructor.rateOnline || instructor.rateFrontal || 0);
            break;
          case 'private_lesson':
            hourlyRate = Number(instructor.ratePrivate || instructor.rateFrontal || 0);
            break;
          case 'frontal':
          default:
            hourlyRate = Number(instructor.rateFrontal || 0);
            break;
        }

        // Calculate duration from actual meeting times, or fall back to cycle default
        let durationMinutes = cycleData.durationMinutes;
        if (meeting.startTime && meeting.endTime) {
          const startMs = meeting.startTime.getTime();
          const endMs = meeting.endTime.getTime();
          const calculatedMinutes = (endMs - startMs) / (1000 * 60);
          // Only use calculated if it's positive and reasonable (< 24 hours)
          if (calculatedMinutes > 0 && calculatedMinutes < 1440) {
            durationMinutes = calculatedMinutes;
          }
        }
        
        const durationHours = durationMinutes / 60;
        instructorPayment = Math.round(hourlyRate * durationHours);
      }

      const profit = revenue - instructorPayment;

      await prisma.meeting.update({
        where: { id },
        data: { revenue, instructorPayment, profit },
      });

      recalculated++;
    }

    res.json({ success: true, recalculated, skipped });
  } catch (error) {
    next(error);
  }
});

// Bulk update meeting status
meetingsRouter.post('/bulk-update-status', managerOrAdmin, async (req, res, next) => {
  try {
    const { ids, status } = req.body;
    
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
          statusUpdatedById: req.user!.userId,
        };

        // Handle status change to completed - calculate financials
        if (status === 'completed' && existingMeeting.status !== 'completed') {
          const cycleData = await prisma.cycle.findUnique({
            where: { id: existingMeeting.cycleId },
            include: {
              registrations: {
                where: { status: { in: ['registered', 'active'] } },
              },
              instructor: true,
            },
          });

          if (cycleData) {
            // Calculate revenue based on cycle type
            let revenue = 0;
            const activeRegistrations = cycleData.registrations.filter(reg => reg.status === 'active');
            
            if (cycleData.type === 'private') {
              const totalRegistrationAmount = cycleData.registrations.reduce(
                (sum, reg) => sum + (reg.amount ? Number(reg.amount) : 0),
                0
              );
              revenue = Math.round(totalRegistrationAmount / cycleData.totalMeetings);
            } else if (cycleData.type === 'institutional_per_child') {
              const pricePerStudent = Number(cycleData.pricePerStudent || 0);
              const studentCount = cycleData.studentCount || activeRegistrations.length;
              revenue = Math.round(pricePerStudent * studentCount);
            } else if (cycleData.type === 'institutional_fixed') {
              revenue = Number(cycleData.meetingRevenue || 0);
            }

            // Calculate instructor payment
            const meetingInstructorId = existingMeeting.instructorId;
            const instructor = await prisma.instructor.findUnique({ where: { id: meetingInstructorId } });
            
            let instructorPayment = 0;
            if (instructor) {
              const activityType = existingMeeting.activityType || cycleData.activityType || 
                (cycleData.isOnline ? 'online' : (cycleData.type === 'private' ? 'private_lesson' : 'frontal'));
              
              let hourlyRate = 0;
              switch (activityType) {
                case 'online':
                  hourlyRate = Number(instructor.rateOnline || instructor.rateFrontal || 0);
                  break;
                case 'private_lesson':
                  hourlyRate = Number(instructor.ratePrivate || instructor.rateFrontal || 0);
                  break;
                case 'frontal':
                default:
                  hourlyRate = Number(instructor.rateFrontal || 0);
                  break;
              }
              
              let durationMinutes = cycleData.durationMinutes;
              if (existingMeeting.startTime && existingMeeting.endTime) {
                const startMs = existingMeeting.startTime.getTime();
                const endMs = existingMeeting.endTime.getTime();
                durationMinutes = (endMs - startMs) / (1000 * 60);
              }
              
              const durationHours = durationMinutes / 60;
              instructorPayment = Math.round(hourlyRate * durationHours);
            }

            const profit = revenue - instructorPayment;

            updateData.revenue = revenue;
            updateData.instructorPayment = instructorPayment;
            updateData.profit = profit;

            // Update cycle counters
            const updatedCompleted = cycleData.completedMeetings + 1;
            await prisma.cycle.update({
              where: { id: existingMeeting.cycleId },
              data: {
                completedMeetings: updatedCompleted,
                remainingMeetings: cycleData.totalMeetings - updatedCompleted,
              },
            });
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

        await prisma.meeting.update({
          where: { id },
          data: updateData,
        });

        // Audit log
        await logAudit({
          userId: req.user?.userId,
          action: 'UPDATE',
          entity: 'Meeting',
          entityId: id,
          oldValue: { status: existingMeeting.status },
          newValue: { status },
          req,
        });

        updated++;
      } catch (error: any) {
        errors.push(`Meeting ${id}: ${error.message}`);
      }
    }

    res.json({ 
      success: true, 
      updated, 
      errors: errors.length > 0 ? errors : undefined 
    });
  } catch (error) {
    next(error);
  }
});

// Bulk update meetings (multiple fields)
meetingsRouter.post('/bulk-update', managerOrAdmin, async (req, res, next) => {
  try {
    const { ids, data } = req.body;
    
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new AppError(400, 'ids array is required');
    }
    
    if (!data || Object.keys(data).length === 0) {
      throw new AppError(400, 'data object is required');
    }

    // Allowed fields for bulk update
    const allowedFields = ['status', 'activityType', 'topic', 'notes', 'scheduledDate', 'startTime', 'endTime', 'instructorId'];
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

    if (Object.keys(updateData).length === 0) {
      throw new AppError(400, 'No valid fields to update');
    }

    let updated = 0;
    let errors: string[] = [];
    const shouldRecalculate = updateData.status === 'completed';

    for (const id of ids) {
      try {
        const existingMeeting = await prisma.meeting.findUnique({
          where: { id },
        });

        if (!existingMeeting) {
          errors.push(`Meeting ${id} not found`);
          continue;
        }

        // If status changing to completed and wasn't completed before, add timestamps
        if (updateData.status === 'completed' && existingMeeting.status !== 'completed') {
          updateData.statusUpdatedAt = new Date();
          updateData.statusUpdatedById = req.user!.userId;
        }

        await prisma.meeting.update({
          where: { id },
          data: updateData,
        });

        // Recalculate financials if status changed to completed
        if (shouldRecalculate && existingMeeting.status !== 'completed') {
          const meeting = await prisma.meeting.findUnique({
            where: { id },
            include: {
              cycle: {
                include: {
                  registrations: { where: { status: { in: ['registered', 'active'] } } },
                },
              },
              instructor: true,
            },
          });

          if (meeting) {
            const cycleData = meeting.cycle;
            let revenue = 0;
            const activeRegistrations = cycleData.registrations.filter(reg => reg.status === 'active');

            if (cycleData.type === 'private') {
              const totalAmount = cycleData.registrations.reduce((sum, reg) => sum + (reg.amount ? Number(reg.amount) : 0), 0);
              revenue = Math.round(totalAmount / cycleData.totalMeetings);
            } else if (cycleData.type === 'institutional_per_child') {
              revenue = Math.round(Number(cycleData.pricePerStudent || 0) * (cycleData.studentCount || activeRegistrations.length));
            } else if (cycleData.type === 'institutional_fixed') {
              revenue = Number(cycleData.meetingRevenue || 0);
            }

            const activityType = meeting.activityType || cycleData.activityType || 'frontal';
            let instructorPayment = 0;
            if (meeting.instructor) {
              let rate = 0;
              switch (activityType) {
                case 'online': rate = Number(meeting.instructor.rateOnline || meeting.instructor.rateFrontal || 0); break;
                case 'private_lesson': rate = Number(meeting.instructor.ratePrivate || meeting.instructor.rateFrontal || 0); break;
                default: rate = Number(meeting.instructor.rateFrontal || 0);
              }
              instructorPayment = Math.round(rate * (cycleData.durationMinutes / 60));
            }

            await prisma.meeting.update({
              where: { id },
              data: { revenue, instructorPayment, profit: revenue - instructorPayment },
            });
          }
        }

        updated++;
      } catch (err: any) {
        errors.push(`Meeting ${id}: ${err.message}`);
      }
    }

    res.json({ 
      success: true, 
      updated, 
      errors: errors.length > 0 ? errors : undefined 
    });
  } catch (error) {
    next(error);
  }
});

// Bulk delete meetings
meetingsRouter.post('/bulk-delete', managerOrAdmin, async (req, res, next) => {
  try {
    const { ids } = req.body;
    
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new AppError(400, 'ids array is required');
    }

    // Get meetings to check their status and cycle
    const meetings = await prisma.meeting.findMany({
      where: { id: { in: ids } },
      select: { id: true, cycleId: true, status: true },
    });

    // Group completed meetings by cycle to update counters
    const completedByCycle = meetings
      .filter(m => m.status === 'completed')
      .reduce((acc, m) => {
        acc[m.cycleId] = (acc[m.cycleId] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

    // Update cycle counters
    for (const [cycleId, count] of Object.entries(completedByCycle)) {
      await prisma.cycle.update({
        where: { id: cycleId },
        data: {
          completedMeetings: { decrement: count },
          remainingMeetings: { increment: count },
        },
      });
    }

    // Delete all meetings
    const result = await prisma.meeting.deleteMany({
      where: { id: { in: ids } },
    });

    res.json({ success: true, deleted: result.count });
  } catch (error) {
    next(error);
  }
});
