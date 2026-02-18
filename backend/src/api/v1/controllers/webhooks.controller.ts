import { Response, NextFunction } from 'express';
import { webhooksService } from '../services/webhooks.service.js';
import { 
  createWebhookSchema, 
  updateWebhookSchema, 
  webhookQuerySchema,
  deliveryQuerySchema,
  testWebhookSchema,
  WEBHOOK_EVENTS 
} from '../validators/webhooks.js';
import { sendSuccess, sendCreated, sendList } from '../../../common/utils/response.js';
import { ValidationError, ForbiddenError } from '../../../common/errors/index.js';
import { AuthRequest } from '../middleware/auth.js';

/**
 * List all webhooks
 */
export async function listWebhooks(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.user?.role !== 'admin') {
      throw new ForbiddenError('Only administrators can manage webhooks');
    }

    const parsed = webhookQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError('Invalid query parameters', parsed.error.errors);
    }

    const { status, event, limit, offset } = parsed.data;
    const result = await webhooksService.findAll({ status, event }, { limit, offset });

    return sendList(res, result.items, {
      total: result.total,
      limit,
      offset,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get a single webhook
 */
export async function getWebhook(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.user?.role !== 'admin') {
      throw new ForbiddenError('Only administrators can manage webhooks');
    }

    const webhook = await webhooksService.findById(req.params.id);
    return sendSuccess(res, webhook);
  } catch (error) {
    next(error);
  }
}

/**
 * Create a new webhook
 */
export async function createWebhook(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.user?.role !== 'admin') {
      throw new ForbiddenError('Only administrators can manage webhooks');
    }

    const parsed = createWebhookSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid input', parsed.error.errors);
    }

    const webhook = await webhooksService.create(req.user.userId, parsed.data);
    return sendCreated(res, webhook);
  } catch (error) {
    next(error);
  }
}

/**
 * Update a webhook
 */
export async function updateWebhook(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.user?.role !== 'admin') {
      throw new ForbiddenError('Only administrators can manage webhooks');
    }

    const parsed = updateWebhookSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid input', parsed.error.errors);
    }

    const webhook = await webhooksService.update(req.params.id, parsed.data);
    return sendSuccess(res, webhook);
  } catch (error) {
    next(error);
  }
}

/**
 * Delete a webhook
 */
export async function deleteWebhook(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.user?.role !== 'admin') {
      throw new ForbiddenError('Only administrators can manage webhooks');
    }

    await webhooksService.delete(req.params.id);
    return res.status(204).send();
  } catch (error) {
    next(error);
  }
}

/**
 * Test a webhook
 */
export async function testWebhook(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.user?.role !== 'admin') {
      throw new ForbiddenError('Only administrators can manage webhooks');
    }

    const parsed = testWebhookSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid input', parsed.error.errors);
    }

    const result = await webhooksService.test(req.params.id, parsed.data.event, parsed.data.payload);
    return sendSuccess(res, result);
  } catch (error) {
    next(error);
  }
}

/**
 * Get webhook deliveries
 */
export async function getDeliveries(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.user?.role !== 'admin') {
      throw new ForbiddenError('Only administrators can view webhook deliveries');
    }

    const parsed = deliveryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError('Invalid query parameters', parsed.error.errors);
    }

    const { webhookId, event, success, limit, offset } = parsed.data;
    const result = await webhooksService.getDeliveries(
      { webhookId, event, success },
      { limit, offset }
    );

    return sendList(res, result.items, {
      total: result.total,
      limit,
      offset,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get available webhook events
 */
export async function getAvailableEvents(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.user?.role !== 'admin') {
      throw new ForbiddenError('Only administrators can manage webhooks');
    }

    return sendSuccess(res, {
      events: WEBHOOK_EVENTS,
      categories: {
        customer: ['customer.created', 'customer.updated', 'customer.deleted'],
        student: ['student.created', 'student.updated', 'student.deleted'],
        registration: ['registration.created', 'registration.updated', 'registration.cancelled'],
        cycle: ['cycle.created', 'cycle.updated', 'cycle.completed', 'cycle.cancelled'],
        meeting: ['meeting.created', 'meeting.updated', 'meeting.completed', 'meeting.cancelled', 'meeting.postponed'],
        attendance: ['attendance.recorded'],
        lead: ['lead.received'],
      },
    });
  } catch (error) {
    next(error);
  }
}
