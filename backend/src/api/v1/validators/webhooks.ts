import { z } from 'zod';

/**
 * Available webhook events
 */
export const WEBHOOK_EVENTS = [
  // Customer events
  'customer.created',
  'customer.updated',
  'customer.deleted',
  
  // Student events
  'student.created',
  'student.updated',
  'student.deleted',
  
  // Registration events
  'registration.created',
  'registration.updated',
  'registration.cancelled',
  
  // Cycle events
  'cycle.created',
  'cycle.updated',
  'cycle.completed',
  'cycle.cancelled',
  
  // Meeting events
  'meeting.created',
  'meeting.updated',
  'meeting.completed',
  'meeting.cancelled',
  'meeting.postponed',
  
  // Attendance events
  'attendance.recorded',
  
  // Lead events (from public endpoint)
  'lead.received',
] as const;

export type WebhookEvent = typeof WEBHOOK_EVENTS[number];

/**
 * Webhook status
 */
export const WEBHOOK_STATUSES = ['active', 'paused', 'disabled'] as const;
export type WebhookStatus = typeof WEBHOOK_STATUSES[number];

/**
 * Create webhook input
 */
export const createWebhookSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  url: z.string().url('Invalid URL'),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, 'At least one event required'),
  secret: z.string().min(16, 'Secret must be at least 16 characters').optional(),
  headers: z.record(z.string()).optional(), // Custom headers to send
  status: z.enum(WEBHOOK_STATUSES).default('active'),
});

export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;

/**
 * Update webhook input
 */
export const updateWebhookSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  url: z.string().url().optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
  secret: z.string().min(16).optional(),
  headers: z.record(z.string()).optional(),
  status: z.enum(WEBHOOK_STATUSES).optional(),
});

export type UpdateWebhookInput = z.infer<typeof updateWebhookSchema>;

/**
 * Webhook query params
 */
export const webhookQuerySchema = z.object({
  status: z.enum(WEBHOOK_STATUSES).optional(),
  event: z.enum(WEBHOOK_EVENTS).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type WebhookQueryParams = z.infer<typeof webhookQuerySchema>;

/**
 * Webhook delivery query params
 */
export const deliveryQuerySchema = z.object({
  webhookId: z.string().uuid().optional(),
  event: z.enum(WEBHOOK_EVENTS).optional(),
  success: z.enum(['true', 'false']).optional().transform(v => v === 'true'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type DeliveryQueryParams = z.infer<typeof deliveryQuerySchema>;

/**
 * Test webhook input
 */
export const testWebhookSchema = z.object({
  event: z.enum(WEBHOOK_EVENTS).default('customer.created'),
  payload: z.record(z.any()).optional(),
});

export type TestWebhookInput = z.infer<typeof testWebhookSchema>;
