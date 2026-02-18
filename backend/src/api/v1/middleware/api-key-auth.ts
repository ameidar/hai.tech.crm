import { Request, Response, NextFunction } from 'express';
import { apiKeysService, ValidatedApiKey } from '../services/api-keys.service.js';
import { ApiKeyScope } from '../validators/api-keys.js';
import { UnauthorizedError, ForbiddenError } from '../../../common/errors/index.js';

/**
 * Extended request with API key info
 */
export interface ApiKeyRequest extends Request {
  apiKey?: ValidatedApiKey;
  authType?: 'jwt' | 'apiKey';
}

/**
 * Get client IP from request
 */
function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = (typeof forwarded === 'string' ? forwarded : forwarded[0]).split(',');
    return ips[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

/**
 * Middleware to authenticate requests using API key
 * Looks for key in X-API-Key header or Authorization: Bearer header
 */
export function apiKeyAuth(req: ApiKeyRequest, _res: Response, next: NextFunction) {
  return (async () => {
    // Check for API key in headers
    const apiKeyHeader = req.headers['x-api-key'] as string;
    const authHeader = req.headers.authorization;

    let apiKey: string | undefined;

    // X-API-Key header takes priority
    if (apiKeyHeader) {
      apiKey = apiKeyHeader;
    }
    // Check Bearer token if it looks like an API key
    else if (authHeader?.startsWith('Bearer haitech_')) {
      apiKey = authHeader.substring(7);
    }

    if (!apiKey) {
      throw new UnauthorizedError('API key required. Provide X-API-Key header or Bearer token');
    }

    // Validate the API key
    const validated = await apiKeysService.validateKey(apiKey, getClientIp(req));

    // Attach to request
    req.apiKey = validated;
    req.authType = 'apiKey';

    next();
  })().catch(next);
}

/**
 * Middleware to check if request has required scope
 * Use after apiKeyAuth middleware
 */
export function requireScope(scope: ApiKeyScope) {
  return (req: ApiKeyRequest, _res: Response, next: NextFunction) => {
    if (!req.apiKey) {
      return next(new UnauthorizedError('API key authentication required'));
    }

    if (!apiKeysService.hasScope(req.apiKey, scope)) {
      return next(new ForbiddenError(`Missing required scope: ${scope}`));
    }

    next();
  };
}

/**
 * Middleware to allow either JWT or API key authentication
 * Tries API key first if present, otherwise falls back to JWT
 */
export function flexibleAuth(req: ApiKeyRequest, res: Response, next: NextFunction) {
  const apiKeyHeader = req.headers['x-api-key'] as string;
  const authHeader = req.headers.authorization;

  // If X-API-Key header is present, use API key auth
  if (apiKeyHeader) {
    return apiKeyAuth(req, res, next);
  }

  // If Bearer token looks like API key, use API key auth
  if (authHeader?.startsWith('Bearer haitech_')) {
    return apiKeyAuth(req, res, next);
  }

  // Otherwise, continue to next middleware (likely JWT auth)
  next();
}
