import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { config } from '../config.js';
import { sendWelcomeNotifications, notifyAdminNewLead } from '../services/notifications.js';
import { logAudit } from '../utils/audit.js';
import { initiateVapiCall } from '../services/vapi.js';

export const webhookRouter = Router();

// API Key authentication middleware
const apiKeyAuth = (req: Request, _res: Response, next: NextFunction) => {
  const apiKey = req.headers['x-api-key'] as string;
  
  if (!apiKey) {
    return next(new AppError(401, 'API key required'));
  }
  
  if (apiKey !== config.apiKey) {
    return next(new AppError(401, 'Invalid API key'));
  }
  
  next();
};

webhookRouter.use(apiKeyAuth);

// Search cycles by name
// GET /api/webhook/cycles/search?name=xxx
webhookRouter.get('/cycles/search', async (req, res, next) => {
  try {
    const name = req.query.name as string;
    
    if (!name) {
      throw new AppError(400, 'name query parameter is required');
    }

    const cycles = await prisma.cycle.findMany({
      where: {
        name: {
          contains: name,
          mode: 'insensitive',
        },
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        status: true,
        startDate: true,
        endDate: true,
        type: true,
        course: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        instructor: { select: { id: true, name: true } },
        _count: { select: { meetings: true } },
      },
      orderBy: { startDate: 'desc' },
      take: 10,
    });

    res.json({
      success: true,
      count: cycles.length,
      cycles: cycles.map(c => ({
        id: c.id,
        name: c.name,
        status: c.status,
        startDate: c.startDate,
        endDate: c.endDate,
        type: c.type,
        courseName: c.course?.name,
        branchName: c.branch?.name,
        instructorName: c.instructor?.name,
        meetingsCount: c._count.meetings,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// Get meeting for a cycle by date (defaults to today)
// GET /api/webhook/cycles/:id/meeting?date=2026-02-07 (optional, defaults to today)
webhookRouter.get('/cycles/:id/meeting', async (req, res, next) => {
  try {
    const cycleId = req.params.id;
    const dateParam = req.query.date as string;
    
    // Parse date or use today
    let targetDate: Date;
    if (dateParam) {
      targetDate = new Date(dateParam);
    } else {
      targetDate = new Date();
    }
    targetDate.setHours(0, 0, 0, 0);
    
    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const meeting = await prisma.meeting.findFirst({
      where: {
        cycleId,
        scheduledDate: {
          gte: targetDate,
          lt: nextDay,
        },
      },
      select: {
        id: true,
        scheduledDate: true,
        startTime: true,
        endTime: true,
        status: true,
        zoomJoinUrl: true,
      },
    });

    if (!meeting) {
      res.json({
        success: true,
        meeting: null,
        message: `No meeting found for date ${targetDate.toISOString().split('T')[0]}`,
      });
      return;
    }

    res.json({
      success: true,
      meeting: {
        id: meeting.id,
        scheduledDate: meeting.scheduledDate.toISOString().split('T')[0],
        startTime: meeting.startTime,
        endTime: meeting.endTime,
        status: meeting.status,
        hasZoomLink: !!meeting.zoomJoinUrl,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Get next scheduled meeting for a cycle
// GET /api/webhook/cycles/:id/next-meeting
webhookRouter.get('/cycles/:id/next-meeting', async (req, res, next) => {
  try {
    const cycleId = req.params.id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const meeting = await prisma.meeting.findFirst({
      where: {
        cycleId,
        status: 'scheduled',
        scheduledDate: { gte: today },
      },
      orderBy: { scheduledDate: 'asc' },
      select: {
        id: true,
        scheduledDate: true,
        startTime: true,
        endTime: true,
        status: true,
        zoomJoinUrl: true,
      },
    });

    if (!meeting) {
      res.json({
        success: true,
        meeting: null,
        message: 'No upcoming scheduled meetings found',
      });
      return;
    }

    res.json({
      success: true,
      meeting: {
        id: meeting.id,
        scheduledDate: meeting.scheduledDate.toISOString().split('T')[0],
        startTime: meeting.startTime,
        endTime: meeting.endTime,
        status: meeting.status,
        hasZoomLink: !!meeting.zoomJoinUrl,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Update meeting Zoom link
// POST /api/webhook/meetings/:id/zoom
webhookRouter.post('/meetings/:id/zoom', async (req, res, next) => {
  try {
    const meetingId = req.params.id;
    const { zoomMeetingId, zoomJoinUrl, zoomStartUrl } = req.body;

    if (!zoomJoinUrl) {
      throw new AppError(400, 'zoomJoinUrl is required');
    }

    const meeting = await prisma.meeting.update({
      where: { id: meetingId },
      data: {
        zoomMeetingId: zoomMeetingId || null,
        zoomJoinUrl,
        zoomStartUrl: zoomStartUrl || null,
      },
      select: {
        id: true,
        zoomMeetingId: true,
        zoomJoinUrl: true,
        zoomStartUrl: true,
      },
    });

    res.json({
      success: true,
      meeting,
    });
  } catch (error) {
    next(error);
  }
});

// Bulk update Zoom links for a cycle
// POST /api/webhook/cycles/:id/zoom
webhookRouter.post('/cycles/:id/zoom', async (req, res, next) => {
  try {
    const cycleId = req.params.id;
    const { meetings } = req.body;

    if (!Array.isArray(meetings)) {
      throw new AppError(400, 'meetings array is required');
    }

    const updates = await Promise.all(
      meetings.map(async (m: { meetingId: string; zoomMeetingId?: string; zoomJoinUrl: string; zoomStartUrl?: string }) => {
        return prisma.meeting.update({
          where: { 
            id: m.meetingId,
            cycleId, // Ensure meeting belongs to cycle
          },
          data: {
            zoomMeetingId: m.zoomMeetingId || null,
            zoomJoinUrl: m.zoomJoinUrl,
            zoomStartUrl: m.zoomStartUrl || null,
          },
        });
      })
    );

    res.json({
      success: true,
      updated: updates.length,
    });
  } catch (error) {
    next(error);
  }
});

// Get cycle meetings for Zoom creation
// GET /api/webhook/cycles/:id/meetings
webhookRouter.get('/cycles/:id/meetings', async (req, res, next) => {
  try {
    const cycleId = req.params.id;

    const cycle = await prisma.cycle.findUnique({
      where: { id: cycleId },
      include: {
        course: { select: { name: true } },
        instructor: { select: { name: true, email: true } },
        meetings: {
          where: { status: 'scheduled' },
          orderBy: { scheduledDate: 'asc' },
          select: {
            id: true,
            scheduledDate: true,
            startTime: true,
            endTime: true,
            zoomJoinUrl: true,
          },
        },
      },
    });

    if (!cycle) {
      throw new AppError(404, 'Cycle not found');
    }

    res.json({
      cycle: {
        id: cycle.id,
        name: cycle.name,
        courseName: cycle.course.name,
        instructorName: cycle.instructor.name,
        instructorEmail: cycle.instructor.email,
        isOnline: cycle.isOnline,
      },
      meetings: cycle.meetings.map(m => ({
        id: m.id,
        scheduledDate: m.scheduledDate.toISOString().split('T')[0],
        startTime: m.startTime,
        endTime: m.endTime,
        hasZoomLink: !!m.zoomJoinUrl,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// Create a lead/customer from external website
// POST /api/webhook/leads
webhookRouter.post('/leads', async (req, res, next) => {
  try {
    const { 
      name, 
      phone, 
      email, 
      city,
      notes,
      source = 'website',
      students, // Optional: array of { name, birthDate?, grade? }
      // New fields from website form
      childName,
      childAge,
      interest,
      message,
    } = req.body;

    if (!name) {
      throw new AppError(400, 'name is required');
    }

    if (!phone && !email) {
      throw new AppError(400, 'Either phone or email is required');
    }

    // Check if customer already exists by phone or email
    let existingCustomer = null;
    if (phone) {
      existingCustomer = await prisma.customer.findFirst({
        where: { phone },
      });
    }
    if (!existingCustomer && email) {
      existingCustomer = await prisma.customer.findFirst({
        where: { email },
      });
    }

    // Build notes from all available info
    const buildNotes = () => {
      const parts = [];
      if (interest) parts.push(`תחום עניין: ${interest}`);
      if (message) parts.push(`הודעה: ${message}`);
      if (notes) parts.push(notes);
      if (childName && childAge) parts.push(`ילד/ה: ${childName}, גיל ${childAge}`);
      else if (childName) parts.push(`ילד/ה: ${childName}`);
      return parts.length > 0 ? parts.join(' | ') : 'פנייה חדשה';
    };

    if (existingCustomer) {
      // Update existing customer with any new info
      const noteText = buildNotes();
      const customer = await prisma.customer.update({
        where: { id: existingCustomer.id },
        data: {
          notes: existingCustomer.notes 
            ? `${existingCustomer.notes}\n---\n[${new Date().toISOString()}] ${source}: ${noteText}`
            : `[${new Date().toISOString()}] ${source}: ${noteText}`,
        },
        include: {
          students: true,
        },
      });

      // If childName provided, check if student exists and create if not
      if (childName) {
        const existingStudent = await prisma.student.findFirst({
          where: { customerId: existingCustomer.id, name: childName },
        });
        if (!existingStudent) {
          await prisma.student.create({
            data: {
              customerId: existingCustomer.id,
              name: childName,
              notes: childAge ? `גיל: ${childAge}${interest ? ` | תחום עניין: ${interest}` : ''}` : (interest ? `תחום עניין: ${interest}` : undefined),
            },
          });
        }
      }

      // Trigger Vapi AI call for returning customer with phone
      if (customer.phone) {
        initiateVapiCall({
          customerId: customer.id,
          customerName: customer.name,
          customerPhone: customer.phone,
          customerEmail: customer.email || undefined,
          childName: childName || undefined,
          interest: interest || undefined,
          source,
        }).catch(err => console.error('[WEBHOOK] Failed to initiate Vapi call:', err));
      }

      res.json({
        success: true,
        isNew: false,
        customer: {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          email: customer.email,
        },
        message: 'Customer already exists, notes updated',
      });
      return;
    }

    // Build student data from either students array or childName/childAge
    let studentsToCreate: Array<{ name: string; birthDate?: Date | null; grade?: string | null; notes?: string }> = [];
    
    if (students && Array.isArray(students) && students.length > 0) {
      studentsToCreate = students.map((s: { name: string; birthDate?: string; grade?: string }) => ({
        name: s.name,
        birthDate: s.birthDate ? new Date(s.birthDate) : null,
        grade: s.grade || null,
      }));
    } else if (childName) {
      studentsToCreate = [{
        name: childName,
        notes: childAge ? `גיל: ${childAge}${interest ? ` | תחום עניין: ${interest}` : ''}` : (interest ? `תחום עניין: ${interest}` : undefined),
      }];
    }

    const noteText = buildNotes();

    // Create new customer
    const customer = await prisma.customer.create({
      data: {
        name,
        phone: phone || null,
        email: email || null,
        city: city || null,
        notes: `[${new Date().toISOString()}] ${source}: ${noteText}`,
        students: studentsToCreate.length > 0 
          ? { create: studentsToCreate }
          : undefined,
      },
      include: {
        students: true,
      },
    });

    // Send welcome notifications (async, don't block response)
    sendWelcomeNotifications({
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
    }).catch(err => console.error('[WEBHOOK] Failed to send welcome notifications:', err));

    // Notify admin about new lead
    notifyAdminNewLead({
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      childName: childName || undefined,
      interest: interest || undefined,
      source,
    }).catch(err => console.error('[WEBHOOK] Failed to notify admin:', err));

    // Trigger Vapi AI call for new customer with phone
    if (customer.phone) {
      initiateVapiCall({
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phone,
        customerEmail: customer.email || undefined,
        childName: childName || undefined,
        interest: interest || undefined,
        source,
      }).catch(err => console.error('[WEBHOOK] Failed to initiate Vapi call:', err));
    }

    // Create audit log
    logAudit({
      userId: 'system',
      userName: 'Website Lead',
      action: 'CREATE',
      entity: 'customer',
      entityId: customer.id,
      newValue: {
        source,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        childName,
        interest,
      },
    }).catch(err => console.error('[WEBHOOK] Failed to create audit log:', err));

    res.status(201).json({
      success: true,
      isNew: true,
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        students: customer.students.map(s => ({
          id: s.id,
          name: s.name,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
});

// Generic meeting update
// Helper function to recalculate meeting financials
async function recalculateMeetingFinancials(meetingId: string) {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
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
    return null;
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

    const durationMinutes = cycleData.durationMinutes;
    const durationHours = durationMinutes / 60;
    instructorPayment = Math.round(hourlyRate * durationHours);
  }

  const profit = revenue - instructorPayment;

  // Update meeting with calculated values
  return prisma.meeting.update({
    where: { id: meetingId },
    data: {
      revenue,
      instructorPayment,
      profit,
    },
  });
}

// PATCH /api/webhook/meetings/:id
webhookRouter.patch('/meetings/:id', async (req, res, next) => {
  try {
    const meetingId = req.params.id;
    const allowedFields = ['zoomMeetingId', 'zoomJoinUrl', 'zoomStartUrl', 'topic', 'notes', 'status'];
    const validStatuses = ['scheduled', 'completed', 'cancelled', 'postponed'];
    
    const updateData: Record<string, any> = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        // Validate status value
        if (field === 'status' && !validStatuses.includes(req.body[field])) {
          throw new AppError(400, `Invalid status. Must be one of: ${validStatuses.join(', ')}`);
        }
        updateData[field] = req.body[field];
      }
    }

    if (Object.keys(updateData).length === 0) {
      throw new AppError(400, 'No valid fields to update');
    }

    let meeting = await prisma.meeting.update({
      where: { id: meetingId },
      data: updateData,
    });

    // If status changed to completed, automatically recalculate financials
    if (updateData.status === 'completed') {
      const recalculated = await recalculateMeetingFinancials(meetingId);
      if (recalculated) {
        meeting = recalculated;
      }
    }

    res.json({
      success: true,
      meeting,
    });
  } catch (error) {
    next(error);
  }
});
