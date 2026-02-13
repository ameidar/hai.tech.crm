import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { 
  queueEmail, 
  queueBulkEmails, 
  getQueueStats, 
  EmailPriority,
  EmailJobData 
} from '../services/email/queue.js';
import { sendTestEmail } from '../services/email/sender.js';
import { listTemplates, getTemplate, TemplateId } from '../services/email/templates.js';
import {
  triggerInstructorReminders,
  triggerParentReminders,
  triggerManagementSummary,
} from '../services/email/scheduler.js';

const router = Router();

// All email routes require authentication
router.use(authenticate);

// Validation schemas
const sendEmailSchema = z.object({
  to: z.union([z.string().email(), z.array(z.string().email())]),
  subject: z.string().min(1),
  html: z.string().optional(),
  text: z.string().optional(),
  templateId: z.enum(['instructor-reminder', 'parent-reminder', 'management-summary', 'newsletter']).optional(),
  templateData: z.record(z.any()).optional(),
  priority: z.enum(['high', 'normal', 'low']).optional(),
});

const bulkEmailSchema = z.object({
  recipients: z.array(z.object({
    email: z.string().email(),
    name: z.string().optional(),
    data: z.record(z.any()).optional(),
  })),
  subject: z.string().min(1),
  templateId: z.enum(['instructor-reminder', 'parent-reminder', 'management-summary', 'newsletter']),
  priority: z.enum(['high', 'normal', 'low']).optional(),
});

// Priority mapping
const priorityMap: Record<string, EmailPriority> = {
  high: EmailPriority.HIGH,
  normal: EmailPriority.NORMAL,
  low: EmailPriority.LOW,
};

/**
 * POST /api/email/send
 * Send a single email
 */
router.post('/send', async (req, res) => {
  try {
    const data = sendEmailSchema.parse(req.body);

    // Validate content
    if (!data.html && !data.text && !data.templateId) {
      return res.status(400).json({ 
        error: 'Email must have html, text, or templateId' 
      });
    }

    // Generate HTML from template if provided
    let html = data.html;
    if (data.templateId && data.templateData) {
      html = getTemplate(data.templateId as TemplateId, data.templateData);
    }

    const emailData: EmailJobData = {
      to: data.to,
      subject: data.subject,
      html,
      text: data.text,
      priority: data.priority ? priorityMap[data.priority] : EmailPriority.NORMAL,
      templateId: data.templateId,
    };

    const job = await queueEmail(emailData);

    res.json({
      success: true,
      message: 'Email queued successfully',
      jobId: job.id,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    console.error('Error queueing email:', error);
    res.status(500).json({ error: 'Failed to queue email' });
  }
});

/**
 * POST /api/email/bulk
 * Send bulk emails
 */
router.post('/bulk', async (req, res) => {
  try {
    const data = bulkEmailSchema.parse(req.body);

    const emails: EmailJobData[] = data.recipients.map(recipient => ({
      to: recipient.email,
      subject: data.subject,
      html: getTemplate(data.templateId as TemplateId, {
        ...recipient.data,
        recipientName: recipient.name,
      }),
      priority: data.priority ? priorityMap[data.priority] : EmailPriority.NORMAL,
      templateId: data.templateId,
      metadata: { recipientName: recipient.name },
    }));

    const jobs = await queueBulkEmails(emails);

    res.json({
      success: true,
      message: `${jobs.length} emails queued successfully`,
      jobIds: jobs.map(j => j.id),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    console.error('Error queueing bulk emails:', error);
    res.status(500).json({ error: 'Failed to queue bulk emails' });
  }
});

/**
 * GET /api/email/queue/status
 * Get queue statistics
 */
router.get('/queue/status', async (_req, res) => {
  try {
    const stats = await getQueueStats();
    res.json(stats);
  } catch (error) {
    console.error('Error getting queue stats:', error);
    res.status(500).json({ error: 'Failed to get queue stats' });
  }
});

/**
 * GET /api/email/templates
 * List available templates
 */
router.get('/templates', (_req, res) => {
  const templates = listTemplates();
  res.json(templates);
});

/**
 * POST /api/email/test
 * Send a test email
 */
router.post('/test', async (req, res) => {
  try {
    const { to } = req.body;

    if (!to || typeof to !== 'string') {
      return res.status(400).json({ error: 'Email address required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const result = await sendTestEmail(to);

    if (result.success) {
      res.json({
        success: true,
        message: 'Test email sent successfully',
        messageId: result.messageId,
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error || 'Failed to send test email',
      });
    }
  } catch (error) {
    console.error('Error sending test email:', error);
    res.status(500).json({ error: 'Failed to send test email' });
  }
});

/**
 * POST /api/email/trigger/:job
 * Manually trigger scheduled email jobs (for testing)
 */
router.post('/trigger/:job', async (req, res) => {
  const { job } = req.params;

  try {
    switch (job) {
      case 'instructor-reminders':
        await triggerInstructorReminders();
        break;
      case 'parent-reminders':
        await triggerParentReminders();
        break;
      case 'management-summary':
        await triggerManagementSummary();
        break;
      default:
        return res.status(400).json({ 
          error: 'Invalid job name',
          validJobs: ['instructor-reminders', 'parent-reminders', 'management-summary'],
        });
    }

    res.json({
      success: true,
      message: `${job} job triggered successfully`,
    });
  } catch (error) {
    console.error(`Error triggering ${job}:`, error);
    res.status(500).json({ error: `Failed to trigger ${job}` });
  }
});

export const emailRouter = router;
