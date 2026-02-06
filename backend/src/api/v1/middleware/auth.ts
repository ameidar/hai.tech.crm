import { Request, Response, NextFunction, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../../../config.js';
import { UnauthorizedError, ForbiddenError } from '../../../common/errors/index.js';
import { UserRole } from '@prisma/client';

/**
 * JWT Payload structure
 */
export interface JwtPayload {
  userId: string;
  email: string;
  role: UserRole;
  instructorId?: string;
}

/**
 * Authentication middleware
 * Verifies JWT token and attaches user info to request
 */
export const authenticate: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    next(new UnauthorizedError('No token provided'));
    return;
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
    req.user = decoded;
    res.locals.userId = decoded.userId;
    res.locals.userRole = decoded.role;
    res.locals.instructorId = decoded.instructorId;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      next(new UnauthorizedError('Token expired'));
      return;
    }
    next(new UnauthorizedError('Invalid token'));
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
export const optionalAuth: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    next();
    return;
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
    req.user = decoded;
    res.locals.userId = decoded.userId;
    res.locals.userRole = decoded.role;
    res.locals.instructorId = decoded.instructorId;
  } catch {
    // Token invalid, but that's okay for optional auth
  }
  
  next();
};
