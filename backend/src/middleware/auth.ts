import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { AppError } from './errorHandler.js';
import { UserRole } from '@prisma/client';
import { prisma } from '../utils/prisma.js';

// Throttle last_active updates: update at most every 60s per user
const lastActiveUpdated = new Map<string, number>();

export interface JwtPayload {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export const authenticate = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return next(new AppError(401, 'No token provided'));
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
    req.user = decoded;

    // Update last_active (throttled: once per 60s per user, fire-and-forget)
    const now = Date.now();
    const lastUpdate = lastActiveUpdated.get(decoded.userId) || 0;
    if (now - lastUpdate > 60_000) {
      lastActiveUpdated.set(decoded.userId, now);
      prisma.user.update({
        where: { id: decoded.userId },
        data: { lastActive: new Date() }
      }).catch(() => {}); // silent fail
    }

    next();
  } catch (error) {
    return next(new AppError(401, 'Invalid or expired token'));
  }
};

export const authorize = (...roles: UserRole[]) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError(401, 'Not authenticated'));
    }

    if (!roles.includes(req.user.role)) {
      return next(new AppError(403, 'Insufficient permissions'));
    }

    next();
  };
};

// Middleware for admin-only routes
export const adminOnly = authorize('admin');

// Middleware for admin or manager routes
export const managerOrAdmin = authorize('admin', 'manager');

// Middleware for sales + above (all non-instructor roles)
export const salesOrAbove = authorize('admin', 'manager', 'sales');
