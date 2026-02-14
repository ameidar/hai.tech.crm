import { Router } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { sendWhatsApp, sendEmail, replacePlaceholders, formatTimeForDisplay } from '../services/messaging.js';
import { logAudit } from '../utils/audit.js';
import { config } from '../config.js';
import { z } from 'zod';

export const messagingRouter = Router();

messagingRouter.use(authenticate);
messagingRouter.use(managerOrAdmin);

// Schema for send message request
const sendMessageSchema = z.object({
  instructorId: z.string().uuid(),
  channel: z.enum(['whatsapp', 'email']),
  templateId: z.string().optional(),
  customMessage: z.string().optional(),
  customSubject: z.string().optional(),
  meetingId: z.string().uuid().optional(),
});

const bulkSendSchema = z.object({
  instructorIds: z.array(z.string().uuid()),
  channel: z.enum(['whatsapp', 'email']),
  templateId: z.string(),
  customMessage: z.string().optional(),
});

// Get all message templates
messagingRouter.get('/templates', async (_req, res, next) => {
  try {
    const templates = await prisma.$queryRaw`
      SELECT * FROM message_templates WHERE is_active = true ORDER BY name
    `;
    res.json(templates);
  } catch (error) {
    next(error);
  }
});

// Get message logs for an instructor
messagingRouter.get('/logs/:instructorId', async (req, res, next) => {
  try {
    const { instructorId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;
    
    const logs = await prisma.$queryRaw`
      SELECT * FROM message_logs 
      WHERE instructor_id = ${instructorId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    res.json(logs);
  } catch (error) {
    next(error);
  }
});

// Get all message logs (with filters)
messagingRouter.get('/logs', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 100, 1), 500);
    const channel = req.query.channel as string;
    
    let logs;
    if (channel) {
      logs = await prisma.$queryRaw`
        SELECT ml.*, i.name as instructor_name 
        FROM message_logs ml
        LEFT JOIN instructors i ON ml.instructor_id = i.id
        WHERE ml.channel = ${channel}
        ORDER BY ml.created_at DESC
        LIMIT ${limit}
      `;
    } else {
      logs = await prisma.$queryRaw`
        SELECT ml.*, i.name as instructor_name 
        FROM message_logs ml
        LEFT JOIN instructors i ON ml.instructor_id = i.id
        ORDER BY ml.created_at DESC
        LIMIT ${limit}
      `;
    }
    res.json(logs);
  } catch (error) {
    next(error);
  }
});

// Send message to instructor
messagingRouter.post('/send', async (req, res, next) => {
  try {
    const data = sendMessageSchema.parse(req.body);
    
    // Get instructor
    const instructor = await prisma.instructor.findUnique({
      where: { id: data.instructorId },
    });
    
    if (!instructor) {
      throw new AppError(404, 'Instructor not found');
    }
    
    // Get template if specified
    let template: any = null;
    if (data.templateId) {
      const templates = await prisma.$queryRaw<any[]>`
        SELECT * FROM message_templates WHERE id = ${data.templateId}
      `;
      template = templates[0];
    }
    
    // Build placeholder data
    const placeholderData: Record<string, string> = {
      instructor_name: instructor.name,
      custom_message: data.customMessage || '',
    };
    
    // If meeting specified, get meeting data
    if (data.meetingId) {
      const meeting = await prisma.meeting.findUnique({
        where: { id: data.meetingId },
        include: {
          cycle: {
            include: {
              branch: true,
              course: true,
            },
          },
        },
      });
      
      if (meeting) {
        placeholderData.cycle_name = meeting.cycle?.name || '';
        placeholderData.branch_name = meeting.cycle?.branch?.name || '';
        placeholderData.course_name = meeting.cycle?.course?.name || '';
        placeholderData.meeting_time = formatTimeForDisplay(meeting.startTime);
        placeholderData.meeting_date = meeting.scheduledDate 
          ? new Date(meeting.scheduledDate).toLocaleDateString('he-IL')
          : '';
        // Add meeting link
        const baseUrl = config.frontendUrl || 'http://localhost:3002';
        placeholderData.meeting_link = `${baseUrl}/instructor/meeting/${meeting.id}`;
      }
    }
    
    // Add instructor portal link
    const baseUrl = config.frontendUrl || 'http://localhost:3002';
    placeholderData.instructor_link = `${baseUrl}/instructor`;
    
    // Build message
    let messageBody = data.customMessage || '';
    let subject = data.customSubject || '';
    
    if (template) {
      messageBody = replacePlaceholders(template.body, placeholderData);
      subject = template.subject ? replacePlaceholders(template.subject, placeholderData) : '';
    }
    
    // Send message
    let result;
    let recipient = '';
    
    if (data.channel === 'whatsapp') {
      if (!instructor.phone) {
        throw new AppError(400, 'Instructor has no phone number');
      }
      recipient = instructor.phone;
      result = await sendWhatsApp({ phone: instructor.phone, message: messageBody });
    } else {
      if (!instructor.email) {
        throw new AppError(400, 'Instructor has no email');
      }
      recipient = instructor.email;
      result = await sendEmail({ to: instructor.email, subject, body: messageBody });
    }
    
    // Log the message
    const userId = (req.user as any)?.id || null;
    await prisma.$executeRaw`
      INSERT INTO message_logs (instructor_id, template_id, channel, recipient, subject, body, status, error_message, sent_by, meeting_id)
      VALUES (${data.instructorId}, ${data.templateId || null}, ${data.channel}, ${recipient}, ${subject || null}, ${messageBody}, ${result.success ? 'sent' : 'failed'}, ${result.error || null}, ${userId}, ${data.meetingId || null})
    `;
    
    if (!result.success) {
      throw new AppError(500, `Failed to send message: ${result.error}`);
    }
    
    // Log to audit
    await logAudit({
      userId: userId,
      userName: (req.user as any)?.name || (req.user as any)?.email,
      action: 'CREATE',
      entity: 'message',
      entityId: data.instructorId,
      newValue: {
        channel: data.channel,
        recipient,
        templateId: data.templateId,
        instructorName: instructor.name,
        subject: subject || undefined,
        bodyPreview: messageBody.substring(0, 100),
      },
      req,
    });
    
    res.json({ 
      success: true, 
      messageId: result.messageId,
      message: `Message sent successfully via ${data.channel}`,
    });
  } catch (error) {
    next(error);
  }
});

// Bulk send to multiple instructors
messagingRouter.post('/bulk-send', async (req, res, next) => {
  try {
    const data = bulkSendSchema.parse(req.body);
    
    const results = {
      sent: 0,
      failed: 0,
      errors: [] as string[],
    };
    
    // Get template
    const templates = await prisma.$queryRaw<any[]>`
      SELECT * FROM message_templates WHERE id = ${data.templateId}
    `;
    const template = templates[0];
    
    if (!template) {
      throw new AppError(404, 'Template not found');
    }
    
    // Get instructors
    const instructors = await prisma.instructor.findMany({
      where: { id: { in: data.instructorIds } },
    });
    
    for (const instructor of instructors) {
      try {
        const placeholderData: Record<string, string> = {
          instructor_name: instructor.name,
          custom_message: data.customMessage || '',
        };
        
        const messageBody = replacePlaceholders(template.body, placeholderData);
        const subject = template.subject ? replacePlaceholders(template.subject, placeholderData) : '';
        
        let result;
        let recipient = '';
        
        if (data.channel === 'whatsapp') {
          if (!instructor.phone) {
            results.failed++;
            results.errors.push(`${instructor.name}: no phone`);
            continue;
          }
          recipient = instructor.phone;
          result = await sendWhatsApp({ phone: instructor.phone, message: messageBody });
        } else {
          if (!instructor.email) {
            results.failed++;
            results.errors.push(`${instructor.name}: no email`);
            continue;
          }
          recipient = instructor.email;
          result = await sendEmail({ to: instructor.email, subject, body: messageBody });
        }
        
        // Log
        await prisma.$executeRaw`
          INSERT INTO message_logs (instructor_id, template_id, channel, recipient, subject, body, status, error_message, sent_by)
          VALUES (${instructor.id}, ${data.templateId}, ${data.channel}, ${recipient}, ${subject || null}, ${messageBody}, ${result.success ? 'sent' : 'failed'}, ${result.error || null}, ${(req.user as any)?.id || null})
        `;
        
        if (result.success) {
          results.sent++;
        } else {
          results.failed++;
          results.errors.push(`${instructor.name}: ${result.error}`);
        }
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (err: any) {
        results.failed++;
        results.errors.push(`${instructor.name}: ${err.message}`);
      }
    }
    
    // Log bulk send to audit
    if (results.sent > 0) {
      await logAudit({
        userId: (req.user as any)?.id,
        userName: (req.user as any)?.name || (req.user as any)?.email,
        action: 'CREATE',
        entity: 'bulk_message',
        entityId: data.templateId,
        newValue: {
          channel: data.channel,
          templateId: data.templateId,
          instructorCount: data.instructorIds.length,
          sent: results.sent,
          failed: results.failed,
        },
        req,
      });
    }
    
    res.json(results);
  } catch (error) {
    next(error);
  }
});

// Get today's meetings without status update (for reminder)
messagingRouter.get('/pending-status', async (_req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const meetings = await prisma.meeting.findMany({
      where: {
        scheduledDate: {
          gte: today,
          lt: tomorrow,
        },
        status: 'scheduled', // Still not marked as completed/cancelled
        endTime: {
          lt: new Date(), // Meeting time has passed
        },
      },
      include: {
        instructor: true,
        cycle: {
          include: {
            branch: true,
            course: true,
          },
        },
      },
    });
    
    res.json(meetings);
  } catch (error) {
    next(error);
  }
});
