import { z } from 'zod';

/**
 * Available scopes for API keys
 */
export const AVAILABLE_SCOPES = [
  '*',                    // Full access
  'read:*',              // Read all entities
  'write:*',             // Write all entities
  'read:customers',
  'write:customers',
  'read:students',
  'write:students',
  'read:courses',
  'write:courses',
  'read:branches',
  'write:branches',
  'read:instructors',
  'write:instructors',
  'read:cycles',
  'write:cycles',
  'read:meetings',
  'write:meetings',
  'read:registrations',
  'write:registrations',
  'read:attendance',
  'write:attendance',
  'read:reports',
] as const;

export type ApiKeyScope = typeof AVAILABLE_SCOPES[number];

/**
 * Create API key input
 */
export const createApiKeySchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  scopes: z.array(z.enum(AVAILABLE_SCOPES)).default(['read:*']),
  rateLimit: z.number().int().min(10).max(100000).default(1000),
  expiresAt: z.string().datetime().optional().nullable(),
});

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;

/**
 * Update API key input
 */
export const updateApiKeySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  scopes: z.array(z.enum(AVAILABLE_SCOPES)).optional(),
  rateLimit: z.number().int().min(10).max(100000).optional(),
  isActive: z.boolean().optional(),
  expiresAt: z.string().datetime().optional().nullable(),
});

export type UpdateApiKeyInput = z.infer<typeof updateApiKeySchema>;

/**
 * API key query params
 */
export const apiKeyQuerySchema = z.object({
  isActive: z.enum(['true', 'false']).optional().transform(v => v === 'true'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ApiKeyQueryParams = z.infer<typeof apiKeyQuerySchema>;
