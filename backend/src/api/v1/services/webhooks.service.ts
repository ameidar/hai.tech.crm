import crypto from 'crypto';
import { prisma } from '../../../utils/prisma.js';
import { NotFoundError } from '../../../common/errors/index.js';
import { CreateWebhookInput, UpdateWebhookInput, WebhookEvent, WEBHOOK_EVENTS } from '../validators/webhooks.js';
import { logger } from '../middleware/logger.js';

/**
 * Webhook response type
 */
export interface WebhookResponse {
  id: string;
  name: string;
  url: string;
  events: string[];
  status: string;
  headers: Record<string, string> | null;
  createdBy: {
    id: string;
    email: string;
    name: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Webhook delivery payload
 */
export interface WebhookPayload {
  id: string;
  event: WebhookEvent;
  timestamp: string;
  data: Record<string, any>;
}

/**
 * Generate HMAC signature for webhook payload
 */
function generateSignature(payload: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
}

/**
 * Generate a random secret for webhooks
 */
function generateSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Webhooks Service - Business logic for webhook management and delivery
 */
export class WebhooksService {
  /**
   * Create a new webhook
   */
  async create(userId: string, input: CreateWebhookInput): Promise<WebhookResponse> {
    const webhook = await prisma.webhook.create({
      data: {
        name: input.name,
        url: input.url,
        events: input.events,
        secret: input.secret || generateSecret(),
        headers: input.headers ? input.headers : undefined,
        status: input.status,
        createdById: userId,
      },
      include: {
        createdBy: {
          select: { id: true, email: true, name: true },
        },
      },
    });

    return this.formatWebhook(webhook);
  }

  /**
   * Get webhook by ID
   */
  async findById(id: string): Promise<WebhookResponse & { secret: string }> {
    const webhook = await prisma.webhook.findUnique({
      where: { id },
      include: {
        createdBy: {
          select: { id: true, email: true, name: true },
        },
      },
    });

    if (!webhook) {
      throw new NotFoundError('Webhook');
    }

    return {
      ...this.formatWebhook(webhook),
      secret: webhook.secret || '',
    };
  }

  /**
   * Get all webhooks with pagination
   */
  async findAll(filters: { status?: string; event?: string }, pagination: { limit: number; offset: number }) {
    const where: any = {};
    
    if (filters.status) {
      where.status = filters.status;
    }
    
    if (filters.event) {
      where.events = { has: filters.event };
    }

    const [items, total] = await Promise.all([
      prisma.webhook.findMany({
        where,
        include: {
          createdBy: {
            select: { id: true, email: true, name: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: pagination.limit,
        skip: pagination.offset,
      }),
      prisma.webhook.count({ where }),
    ]);

    return {
      items: items.map(w => this.formatWebhook(w)),
      total,
      pagination,
    };
  }

  /**
   * Update a webhook
   */
  async update(id: string, input: UpdateWebhookInput): Promise<WebhookResponse> {
    const existing = await prisma.webhook.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError('Webhook');
    }

    const webhook = await prisma.webhook.update({
      where: { id },
      data: {
        name: input.name,
        url: input.url,
        events: input.events,
        secret: input.secret,
        headers: input.headers,
        status: input.status,
      },
      include: {
        createdBy: {
          select: { id: true, email: true, name: true },
        },
      },
    });

    return this.formatWebhook(webhook);
  }

  /**
   * Delete a webhook
   */
  async delete(id: string): Promise<void> {
    const existing = await prisma.webhook.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError('Webhook');
    }

    await prisma.webhook.delete({ where: { id } });
  }

  /**
   * Test webhook by sending a test payload
   */
  async test(id: string, event: WebhookEvent, payload?: Record<string, any>): Promise<{
    success: boolean;
    responseCode?: number;
    responseBody?: string;
    error?: string;
  }> {
    const webhook = await prisma.webhook.findUnique({ where: { id } });
    if (!webhook) {
      throw new NotFoundError('Webhook');
    }

    const testPayload: WebhookPayload = {
      id: crypto.randomUUID(),
      event,
      timestamp: new Date().toISOString(),
      data: payload || { test: true, message: 'This is a test webhook delivery' },
    };

    return this.deliverWebhook(webhook, testPayload);
  }

  /**
   * Emit an event to all subscribed webhooks
   */
  async emitEvent(event: WebhookEvent, data: Record<string, any>): Promise<void> {
    // Find all active webhooks subscribed to this event
    const webhooks = await prisma.webhook.findMany({
      where: {
        status: 'active',
        events: { has: event },
      },
    });

    if (webhooks.length === 0) {
      return;
    }

    const payload: WebhookPayload = {
      id: crypto.randomUUID(),
      event,
      timestamp: new Date().toISOString(),
      data,
    };

    // Deliver to all webhooks in parallel
    const deliveries = webhooks.map(webhook => 
      this.deliverWebhook(webhook, payload).catch(error => {
        logger.error({ error, webhookId: webhook.id }, 'Webhook delivery failed');
        return { success: false, error: error.message };
      })
    );

    await Promise.all(deliveries);
  }

  /**
   * Deliver webhook payload with retry logic
   */
  private async deliverWebhook(
    webhook: { id: string; url: string; secret: string | null; headers: any },
    payload: WebhookPayload
  ): Promise<{ success: boolean; responseCode?: number; responseBody?: string; error?: string }> {
    const payloadString = JSON.stringify(payload);
    
    // Prepare headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Webhook-ID': webhook.id,
      'X-Webhook-Event': payload.event,
      'X-Webhook-Delivery': payload.id,
      'X-Webhook-Timestamp': payload.timestamp,
    };

    // Add HMAC signature if secret is set
    if (webhook.secret) {
      headers['X-Webhook-Signature'] = `sha256=${generateSignature(payloadString, webhook.secret)}`;
    }

    // Add custom headers
    if (webhook.headers && typeof webhook.headers === 'object') {
      Object.assign(headers, webhook.headers);
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

      const response = await fetch(webhook.url, {
        method: 'POST',
        headers,
        body: payloadString,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const responseBody = await response.text().catch(() => '');
      const success = response.ok;

      // Record delivery
      await prisma.webhookDelivery.create({
        data: {
          webhookId: webhook.id,
          event: payload.event,
          payload: payload as any,
          responseCode: response.status,
          responseBody: responseBody.substring(0, 1000), // Limit response body size
          success,
          completedAt: new Date(),
        },
      });

      return {
        success,
        responseCode: response.status,
        responseBody: responseBody.substring(0, 500),
      };
    } catch (error: any) {
      const errorMessage = error.name === 'AbortError' 
        ? 'Request timeout' 
        : error.message || 'Unknown error';

      // Record failed delivery
      await prisma.webhookDelivery.create({
        data: {
          webhookId: webhook.id,
          event: payload.event,
          payload: payload as any,
          success: false,
          error: errorMessage,
          nextRetryAt: new Date(Date.now() + 5 * 60 * 1000), // Retry in 5 minutes
        },
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Get delivery history for a webhook
   */
  async getDeliveries(filters: {
    webhookId?: string;
    event?: string;
    success?: boolean;
  }, pagination: { limit: number; offset: number }) {
    const where: any = {};
    
    if (filters.webhookId) where.webhookId = filters.webhookId;
    if (filters.event) where.event = filters.event;
    if (filters.success !== undefined) where.success = filters.success;

    const [items, total] = await Promise.all([
      prisma.webhookDelivery.findMany({
        where,
        include: {
          webhook: {
            select: { id: true, name: true, url: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: pagination.limit,
        skip: pagination.offset,
      }),
      prisma.webhookDelivery.count({ where }),
    ]);

    return { items, total, pagination };
  }

  /**
   * Get available webhook events
   */
  getAvailableEvents() {
    return WEBHOOK_EVENTS;
  }

  /**
   * Format webhook for response (hide secret)
   */
  private formatWebhook(webhook: any): WebhookResponse {
    return {
      id: webhook.id,
      name: webhook.name,
      url: webhook.url,
      events: webhook.events,
      status: webhook.status,
      headers: webhook.headers as Record<string, string> | null,
      createdBy: webhook.createdBy,
      createdAt: webhook.createdAt,
      updatedAt: webhook.updatedAt,
    };
  }
}

export const webhooksService = new WebhooksService();
