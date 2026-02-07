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
    // Log incoming request for debugging
    console.log('[WEBHOOK /leads] Received:', JSON.stringify(req.body, null, 2));
    
    // Support multiple field name variations
    const body = req.body;
    const name = body.name || body.parentName || body.parent_name;
    const phone = body.phone || body.telephone || body.tel;
    const email = body.email || body.mail;
    const city = body.city;
    const notes = body.notes;
    const message = body.message || body.הודעה;
    const source = body.source || 'website';
    const students = body.students;
    // Child fields - support multiple naming conventions
    const childName = body.childName || body.child_name || body.studentName || body.student_name || body['שם הילד/ה'] || body['שם_הילד'];
    const childAge = body.childAge || body.child_age || body.age || body['גיל הילד/ה'] || body['גיל_הילד'];
    const childGrade = body.childGrade || body.child_grade || body.grade;
    const interest = body.interest || body.topic || body['תחום עניין'] || body['תחום_עניין'] || body.subject;

    if (!name) {
      throw new AppError(400, 'name is required');
    }

    if (!phone && !email) {
      throw new AppError(400, 'Either phone or email is required');
    }

    // Israel timezone timestamp
    const israelTime = new Date().toLocaleString('he-IL', { 
      timeZone: 'Asia/Jerusalem',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    // Build notes with all info
    const noteParts: string[] = [];
    noteParts.push(`[${israelTime}] מקור: ${source}`);
    if (interest) noteParts.push(`תחום עניין: ${interest}`);
    if (message) noteParts.push(`הודעה: ${message}`);
    if (notes) noteParts.push(notes);
    const fullNotes = noteParts.join('\n');

    // Build students array - support both array and single child fields
    let studentsToCreate: Array<{ name: string; birthDate?: Date | null; age?: number | null; grade?: string | null }> = [];
    
    if (students && Array.isArray(students) && students.length > 0) {
      studentsToCreate = students.map((s: { name: string; birthDate?: string; grade?: string; age?: number }) => ({
        name: s.name,
        birthDate: s.birthDate ? new Date(s.birthDate) : null,
        age: s.age || null,
        grade: s.grade || null,
      }));
    } else if (childName) {
      // Single child from direct fields
      studentsToCreate = [{
        name: childName,
        birthDate: null,
        age: childAge || null,
        grade: childGrade || null,
      }];
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
      const updateData: any = {
        notes: existingCustomer.notes 
          ? `${existingCustomer.notes}\n---\n${fullNotes}`
          : fullNotes,
      };

      // Add new students if provided and they don't exist
      if (studentsToCreate.length > 0) {
        const existingStudentNames = (await prisma.student.findMany({
          where: { customerId: existingCustomer.id },
          select: { name: true },
        })).map(s => s.name.toLowerCase());

        const newStudents = studentsToCreate.filter(
          s => !existingStudentNames.includes(s.name.toLowerCase())
        );

        if (newStudents.length > 0) {
          await prisma.student.createMany({
            data: newStudents.map(s => ({
              customerId: existingCustomer!.id,
              name: s.name,
              birthDate: s.birthDate,
              age: s.age,
              grade: s.grade,
            })),
          });
        }
      }

      const customer = await prisma.customer.update({
        where: { id: existingCustomer.id },
        data: updateData,
        include: {
          students: true,
        },
      });

      // Create audit log
      await prisma.auditLog.create({
        data: {
          action: 'LEAD_UPDATE',
          entity: 'Customer',
          entityId: customer.id,
          newValue: { source, interest, message, childName, childAge },
          ipAddress: req.ip || 'webhook',
        },
      }).catch(() => {}); // Don't fail if audit log fails

      res.json({
        success: true,
        isNew: false,
        customer: {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          email: customer.email,
          students: customer.students.map(s => ({ id: s.id, name: s.name })),
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
        notes: fullNotes,
        students: studentsToCreate.length > 0 
          ? {
              create: studentsToCreate,
            }
          : undefined,
      },
      include: {
        students: true,
      },
    });

    // Create audit log
    await prisma.auditLog.create({
      data: {
        action: 'LEAD_CREATE',
        entity: 'Customer',
        entityId: customer.id,
        newValue: { source, interest, message, childName, childAge, studentsCount: studentsToCreate.length },
        ipAddress: req.ip || 'webhook',
      },
    }).catch(() => {}); // Don't fail if audit log fails

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
