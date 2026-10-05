// Who is performing a request — a human (JWT) or a machine identity (API key).
//
// The v1 API authenticates API keys and, for backward compatibility with older v1 routes,
// also sets `req.user` to the key's *creator*. That pseudo-user must never be recorded as
// the actor of an API-key write: audit rows and actor columns (statusUpdatedById,
// createdById, ...) belong to the key, not to whoever happened to mint it.

import type { Request } from 'express';

export interface RequestApiKey {
  id: string;
  name: string;
}

/** The authenticated API key on this request, if the request was API-key authenticated. */
export function getRequestApiKey(req?: Request | null): RequestApiKey | undefined {
  const key = (req as any)?.apiKey;
  if (key && typeof key.id === 'string') return { id: key.id, name: String(key.name ?? '') };
  return undefined;
}

/**
 * The human user id to store in actor columns (createdById, statusUpdatedById, recordedById...).
 * Returns undefined for API-key requests so the key's creator is never attributed.
 */
export function actorUserId(req?: Request | null): string | undefined {
  if (getRequestApiKey(req)) return undefined;
  return (req as any)?.user?.userId ?? undefined;
}

/** Human-readable actor label, e.g. for `updated_by` text columns. */
export function actorLabel(req?: Request | null): string {
  const key = getRequestApiKey(req);
  if (key) return `api-key:${key.name}`;
  const user = (req as any)?.user;
  return user?.email || user?.name || user?.userId || 'unknown';
}
