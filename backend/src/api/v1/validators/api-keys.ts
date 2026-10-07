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
  'read:leads',
  'write:leads',
  'read:payments',
  // Ops/admin API (v1.62.0)
  'read:institutional_orders',
  'write:institutional_orders',
  'read:paying_bodies',
  'write:paying_bodies',
  'read:instructor_additions',
  'write:instructor_additions',
  'read:bot_config',        // explicit-only (see EXPLICIT_ONLY_SCOPES)
  'write:bot_config',       // explicit-only
  'read:salary_reports',    // explicit-only
] as const;

export type ApiKeyScope = typeof AVAILABLE_SCOPES[number];

/**
 * Sensitive scopes that are NEVER implied by a broad scope ('*', 'read:*', 'write:*').
 * A key (or role) gets them only when they are listed explicitly — so the existing
 * broad-scope integration keys don't silently gain access to the WhatsApp bot's
 * prompt/knowledge base or to instructor salaries.
 */
export const EXPLICIT_ONLY_SCOPES: ReadonlySet<string> = new Set([
  'read:bot_config',
  'write:bot_config',
  'read:salary_reports',
]);

/**
 * Single source of truth for scope matching (API keys and role permission lists).
 * - exact match always grants
 * - '*' and '<action>:*' grant everything of that action EXCEPT explicit-only scopes
 */
export function scopesGrant(granted: readonly string[], required: string): boolean {
  if (granted.includes(required)) return true;
  if (EXPLICIT_ONLY_SCOPES.has(required)) return false;
  if (granted.includes('*')) return true;
  const [action] = required.split(':');
  return granted.includes(`${action}:*`);
}

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
