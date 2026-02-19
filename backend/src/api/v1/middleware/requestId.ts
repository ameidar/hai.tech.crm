import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

/**
 * Request ID Middleware
 * 
 * Generates a unique request ID for each incoming request.
 * The ID is:
 * - Stored in res.locals.requestId for use in handlers
 * - Added to response headers as X-Request-ID
 * - Used for log correlation
 * 
 * If a request already has an X-Request-ID header (from a proxy or client),
 * it will be preserved.
 */
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Check if request already has a request ID (from proxy, client, etc.)
  const existingId = req.headers['x-request-id'];
  const requestId = typeof existingId === 'string' ? existingId : uuidv4();
  
  // Store in res.locals for use in handlers and response formatter
  res.locals.requestId = requestId;
  
  // Add to response headers
  res.setHeader('X-Request-ID', requestId);
  
  next();
}
