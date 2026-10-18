/**
 * viewerReadOnly middleware
 *
 * Users with the `viewer` role can see everything an admin sees, but may not
 * change anything: every write request (POST/PUT/PATCH/DELETE) is rejected,
 * except token refresh and logout so the session keeps working.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { JwtPayload } from './auth.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const ALLOWED_WRITE_PATHS = new Set(['/api/auth/refresh', '/api/auth/logout']);

export const VIEWER_READ_ONLY_MESSAGE = 'משתמש לצפייה בלבד — אין הרשאה לבצע שינויים';

export const viewerReadOnly = (req: Request, res: Response, next: NextFunction) => {
  if (!WRITE_METHODS.has(req.method)) return next();
  if (ALLOWED_WRITE_PATHS.has(req.path)) return next();

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return next();

  let role: string | undefined;
  try {
    role = (jwt.verify(authHeader.substring(7), config.jwt.secret) as JwtPayload).role;
  } catch {
    return next(); // invalid tokens are rejected by the route's own auth
  }

  if (role !== 'viewer') return next();

  return res.status(403).json({ error: VIEWER_READ_ONLY_MESSAGE, code: 'READ_ONLY_USER' });
};
