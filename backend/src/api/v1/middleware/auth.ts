import { Request, Response, NextFunction, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../../../config.js';
import { UnauthorizedError, ForbiddenError } from '../../../common/errors/index.js';
import { UserRole } from '@prisma/client';
import { apiKeysService, ValidatedApiKey } from '../services/api-keys.service.js';

/**
 * JWT Payload structure
 */
export interface JwtPayload {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
  instructorId?: string;
}

/**
 * Extended request with user and API key info
 */
export interface AuthRequest extends Request {
  user?: JwtPayload;
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
 * Authentication middleware
 * Supports both JWT tokens and API keys
 * - JWT: Authorization: Bearer <token>
 * - API Key: X-API-Key: <key> OR Authorization: Bearer haitech_<key>
 */
export const authenticate: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;
  const apiKeyHeader = req.headers['x-api-key'] as string;

  try {
    // Check for API key in X-API-Key header first
    if (apiKeyHeader) {
      const validated = await apiKeysService.validateKey(apiKeyHeader, getClientIp(req));
      (req as AuthRequest).apiKey = validated;
      (req as AuthRequest).authType = 'apiKey';
      // Create a pseudo user from the API key creator
      req.user = {
        userId: validated.createdBy.id,
        email: validated.createdBy.email,
        name: validated.createdBy.name,
        role: validated.createdBy.role as UserRole,
      };
      res.locals.userId = validated.createdBy.id;
      res.locals.userRole = validated.createdBy.role;
      res.locals.apiKeyId = validated.id;
      next();
      return;
    }

    // Check Authorization header
    if (!authHeader?.startsWith('Bearer ')) {
      next(new UnauthorizedError('No token provided'));
      return;
    }

    const token = authHeader.substring(7);

    // Check if it's an API key (starts with haitech_)
    if (token.startsWith('haitech_')) {
      const validated = await apiKeysService.validateKey(token, getClientIp(req));
      (req as AuthRequest).apiKey = validated;
      (req as AuthRequest).authType = 'apiKey';
      req.user = {
        userId: validated.createdBy.id,
        email: validated.createdBy.email,
        name: validated.createdBy.name,
        role: validated.createdBy.role as UserRole,
      };
      res.locals.userId = validated.createdBy.id;
      res.locals.userRole = validated.createdBy.role;
      res.locals.apiKeyId = validated.id;
      next();
      return;
    }

    // Otherwise, treat as JWT
    const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
    req.user = decoded;
    (req as AuthRequest).authType = 'jwt';
    res.locals.userId = decoded.userId;
    res.locals.userRole = decoded.role;
    res.locals.instructorId = decoded.instructorId;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      next(new UnauthorizedError('Token expired'));
      return;
    }
    if (error instanceof UnauthorizedError) {
      next(error);
      return;
    }
    next(new UnauthorizedError('Invalid token or API key'));
  }
};

/**
 * Authorization middleware factory
 * Checks if user has one of the allowed roles
 */
export const authorize = (...roles: UserRole[]): RequestHandler => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError('Not authenticated'));
      return;
    }

    if (!roles.includes(req.user.role)) {
      next(new ForbiddenError('Insufficient permissions'));
      return;
    }

    next();
  };
};

/**
 * Admin only middleware
 */
export const adminOnly = authorize('admin');

/**
 * Manager or admin middleware
 */
export const managerOrAdmin = authorize('admin', 'manager');

/**
 * Optional authentication - doesn't fail if no token
 */
export const optionalAuth: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;
  const apiKeyHeader = req.headers['x-api-key'] as string;

  try {
    // Check for API key
    if (apiKeyHeader) {
      const validated = await apiKeysService.validateKey(apiKeyHeader, getClientIp(req));
      (req as AuthRequest).apiKey = validated;
      (req as AuthRequest).authType = 'apiKey';
      req.user = {
        userId: validated.createdBy.id,
        email: validated.createdBy.email,
        name: validated.createdBy.name,
        role: validated.createdBy.role as UserRole,
      };
      res.locals.userId = validated.createdBy.id;
      res.locals.userRole = validated.createdBy.role;
      res.locals.apiKeyId = validated.id;
      next();
      return;
    }

    if (!authHeader?.startsWith('Bearer ')) {
      next();
      return;
    }

    const token = authHeader.substring(7);

    // Check if it's an API key
    if (token.startsWith('haitech_')) {
      const validated = await apiKeysService.validateKey(token, getClientIp(req));
      (req as AuthRequest).apiKey = validated;
      (req as AuthRequest).authType = 'apiKey';
      req.user = {
        userId: validated.createdBy.id,
        email: validated.createdBy.email,
        name: validated.createdBy.name,
        role: validated.createdBy.role as UserRole,
      };
      res.locals.userId = validated.createdBy.id;
      res.locals.userRole = validated.createdBy.role;
      res.locals.apiKeyId = validated.id;
      next();
      return;
    }

    // Try JWT
    const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
    req.user = decoded;
    (req as AuthRequest).authType = 'jwt';
    res.locals.userId = decoded.userId;
    res.locals.userRole = decoded.role;
    res.locals.instructorId = decoded.instructorId;
  } catch {
    // Token/key invalid, but that's okay for optional auth
  }
  
  next();
};
