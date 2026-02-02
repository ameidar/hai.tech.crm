import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { config } from '../config.js';
import { sendWelcomeNotifications } from '../services/notifications.js';

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
      students // Optional: array of { name, birthDate?, grade? }
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

    if (existingCustomer) {
      // Update existing customer with any new info
      const customer = await prisma.customer.update({
        where: { id: existingCustomer.id },
        data: {
          notes: existingCustomer.notes 
            ? `${existingCustomer.notes}\n---\n[${new Date().toISOString()}] ${source}: ${notes || 'פנייה חדשה'}`
            : `[${new Date().toISOString()}] ${source}: ${notes || 'פנייה חדשה'}`,
        },
        include: {
          students: true,
        },
      });

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

    // Create new customer
    const customer = await prisma.customer.create({
      data: {
        name,
        phone: phone || null,
        email: email || null,
        city: city || null,
        notes: notes ? `[${new Date().toISOString()}] ${source}: ${notes}` : `[${new Date().toISOString()}] ${source}: ליד חדש`,
        students: students && Array.isArray(students) && students.length > 0 
          ? {
              create: students.map((s: { name: string; birthDate?: string; grade?: string }) => ({
                name: s.name,
                birthDate: s.birthDate ? new Date(s.birthDate) : null,
                grade: s.grade || null,
              })),
            }
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
// PATCH /api/webhook/meetings/:id
webhookRouter.patch('/meetings/:id', async (req, res, next) => {
  try {
    const meetingId = req.params.id;
    const allowedFields = ['zoomMeetingId', 'zoomJoinUrl', 'zoomStartUrl', 'topic', 'notes'];
    
    const updateData: Record<string, any> = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    }

    if (Object.keys(updateData).length === 0) {
      throw new AppError(400, 'No valid fields to update');
    }

    const meeting = await prisma.meeting.update({
      where: { id: meetingId },
      data: updateData,
    });

    res.json({
      success: true,
      meeting,
    });
  } catch (error) {
    next(error);
  }
});
