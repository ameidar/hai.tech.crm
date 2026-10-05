import { Response, NextFunction } from 'express';
import { ForbiddenError } from '../../../common/errors/index.js';
import { AuthRequest } from './auth.js';
import { ApiKeyScope, AVAILABLE_SCOPES, scopesGrant } from '../validators/api-keys.js';
import { UnauthorizedError } from '../../../common/errors/index.js';
import type { UserRole } from '@prisma/client';

/**
 * Permission matrix for role-based access control
 * Maps roles to their allowed scopes
 */
const ROLE_PERMISSIONS: Record<string, ApiKeyScope[]> = {
  admin: ['*'], // Full access
  manager: [
    'read:*',
    'write:customers',
    'write:students', 
    'write:courses',
    'write:branches',
    'write:cycles',
    'write:meetings',
    'write:registrations',
    'write:attendance',
    'read:reports',
    'read:leads',
    'write:leads',
  ],
  instructor: [
    'read:cycles',
    'read:meetings',
    'read:students',
    'read:attendance',
    'write:meetings',      // Can update meeting status
    'write:attendance',    // Can record attendance
  ],
  sales: [
    'read:leads',
    'write:leads',
  ],
};

/**
 * Check if a set of scopes includes a required scope.
 * Delegates to the shared matcher so explicit-only scopes (bot config, salary reports)
 * are never implied by '*', 'read:*' or 'write:*'.
 */
function hasScope(scopes: string[], requiredScope: ApiKeyScope): boolean {
  return scopesGrant(scopes, requiredScope);
}

/**
 * Middleware to check if the request has the required scope
 * Works with both JWT auth (role-based) and API key auth (scope-based)
 */
export function requireScope(scope: ApiKeyScope) {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    // Check API key scopes first (if authenticated via API key)
    if (req.apiKey) {
      if (!hasScope(req.apiKey.scopes, scope)) {
        return next(new ForbiddenError(`Missing required scope: ${scope}`));
      }
      return next();
    }

    // Check user role (JWT auth)
    if (req.user) {
      const roleScopes = ROLE_PERMISSIONS[req.user.role] || [];
      if (!hasScope(roleScopes, scope)) {
        return next(new ForbiddenError(`Your role does not have permission for: ${scope}`));
      }
      return next();
    }

    // No authentication
    return next(new ForbiddenError('Authentication required'));
  };
}

/**
 * Authorization for the ops/admin endpoints (v1.62.0).
 *
 * - API key: the key's own scopes decide. The creator's role is deliberately ignored —
 *   a key is a machine identity with exactly the permissions it was granted.
 * - JWT user: the same roles the equivalent internal (/api/...) route allows, so the v1
 *   endpoint never widens human access compared to the UI.
 */
export function requireScopeOrRole(scope: ApiKeyScope, roles: readonly UserRole[]) {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    if (req.apiKey) {
      if (!scopesGrant(req.apiKey.scopes, scope)) {
        return next(new ForbiddenError(`Missing required scope: ${scope}`));
      }
      return next();
    }
    if (req.user) {
      if (!roles.includes(req.user.role)) {
        return next(new ForbiddenError(`Your role does not have permission for: ${scope}`));
      }
      return next();
    }
    return next(new UnauthorizedError('Authentication required'));
  };
}

/**
 * Middleware to require any of the given scopes
 */
export function requireAnyScope(...scopes: ApiKeyScope[]) {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    // Check API key scopes
    if (req.apiKey) {
      for (const scope of scopes) {
        if (hasScope(req.apiKey.scopes, scope)) {
          return next();
        }
      }
      return next(new ForbiddenError(`Missing one of required scopes: ${scopes.join(', ')}`));
    }

    // Check user role
    if (req.user) {
      const roleScopes = ROLE_PERMISSIONS[req.user.role] || [];
      for (const scope of scopes) {
        if (hasScope(roleScopes, scope)) {
          return next();
        }
      }
      return next(new ForbiddenError(`Your role does not have permission for any of: ${scopes.join(', ')}`));
    }

    return next(new ForbiddenError('Authentication required'));
  };
}

/**
 * Middleware to require all of the given scopes
 */
export function requireAllScopes(...scopes: ApiKeyScope[]) {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    // Check API key scopes
    if (req.apiKey) {
      for (const scope of scopes) {
        if (!hasScope(req.apiKey.scopes, scope)) {
          return next(new ForbiddenError(`Missing required scope: ${scope}`));
        }
      }
      return next();
    }

    // Check user role
    if (req.user) {
      const roleScopes = ROLE_PERMISSIONS[req.user.role] || [];
      for (const scope of scopes) {
        if (!hasScope(roleScopes, scope)) {
          return next(new ForbiddenError(`Your role does not have permission for: ${scope}`));
        }
      }
      return next();
    }

    return next(new ForbiddenError('Authentication required'));
  };
}

/**
 * Get allowed scopes for a role
 */
export function getRoleScopes(role: string): ApiKeyScope[] {
  return ROLE_PERMISSIONS[role] || [];
}

/**
 * Check if a role has a specific scope
 */
export function roleHasScope(role: string, scope: ApiKeyScope): boolean {
  const roleScopes = ROLE_PERMISSIONS[role] || [];
  return hasScope(roleScopes, scope);
}

export { ROLE_PERMISSIONS, AVAILABLE_SCOPES };
