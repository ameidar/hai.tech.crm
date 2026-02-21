/**
 * devReadOnly middleware
 *
 * In non-production environments, restricts all write operations (POST/PUT/PATCH/DELETE)
 * to admin users only. Read operations (GET) are always allowed.
 *
 * Public routes (auth, invite, webhooks, public-*) are exempt.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { JwtPayload } from './auth.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Routes exempt from this restriction (public / webhook / auth)
const EXEMPT_PREFIXES = [
  '/api/auth',
  '/api/invite',
  '/api/meeting-status',
  '/api/webhook',
  '/api/zoom-webhook',
  '/api/vapi-webhook',
  '/api/vapi-tools',
  '/api/public',
  '/api/health',
];

function getUserFromRequest(req: Request): JwtPayload | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(authHeader.substring(7), config.jwt.secret) as JwtPayload;
  } catch {
    return null;
  }
}

export const devReadOnly = (req: Request, res: Response, next: NextFunction) => {
  // Only active in non-production environments
  if (process.env.NODE_ENV === 'production') return next();

  // Allow all GET/HEAD/OPTIONS
  if (!WRITE_METHODS.has(req.method)) return next();

  // Allow exempt routes
  if (EXEMPT_PREFIXES.some(prefix => req.path.startsWith(prefix))) return next();

  // Require admin role for write operations
  const user = getUserFromRequest(req);
  if (user?.role === 'admin') return next();

  return res.status(403).json({
    error: 'Dev environment is read-only for non-admin users. Please use production: https://crm.orma-ai.com',
  });
};
