import { Response, NextFunction } from 'express';
import { RateLimitError } from '../../../common/errors/index.js';
import { ApiKeyRequest } from './api-key-auth.js';
import { AuthRequest } from './auth.js';

/**
 * In-memory rate limit storage
 * In production, use Redis for distributed systems
 */
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Get rate limit key from request
 * Uses API key ID, user ID, or IP address
 */
function getRateLimitKey(req: ApiKeyRequest & AuthRequest): string {
  if (req.apiKey) {
    return `apikey:${req.apiKey.id}`;
  }
  if (req.user) {
    return `user:${req.user.userId}`;
  }
  // Fall back to IP
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded 
    ? (typeof forwarded === 'string' ? forwarded : forwarded[0]).split(',')[0].trim()
    : req.socket.remoteAddress || 'unknown';
  return `ip:${ip}`;
}

/**
 * Get rate limit for request
 * API keys have their own limit, users get default
 */
function getRateLimit(req: ApiKeyRequest & AuthRequest): number {
  if (req.apiKey) {
    return req.apiKey.rateLimit;
  }
  // Default rate limits per hour
  if (req.user?.role === 'admin') {
    return 10000;
  }
  if (req.user?.role === 'manager') {
    return 5000;
  }
  if (req.user?.role === 'instructor') {
    return 2000;
  }
  // Anonymous/IP-based
  return 100;
}

/**
 * Rate limiting middleware
 * Tracks requests per hour per identity (API key, user, or IP)
 */
export function rateLimit(req: ApiKeyRequest & AuthRequest, res: Response, next: NextFunction) {
  const key = getRateLimitKey(req);
  const limit = getRateLimit(req);
  const windowMs = 60 * 60 * 1000; // 1 hour
  const now = Date.now();

  let entry = rateLimitStore.get(key);

  // Create new entry if doesn't exist or expired
  if (!entry || entry.resetAt < now) {
    entry = {
      count: 0,
      resetAt: now + windowMs,
    };
    rateLimitStore.set(key, entry);
  }

  // Increment count
  entry.count++;

  // Calculate remaining
  const remaining = Math.max(0, limit - entry.count);
  const resetTimestamp = Math.ceil(entry.resetAt / 1000);

  // Set headers
  res.setHeader('X-RateLimit-Limit', limit);
  res.setHeader('X-RateLimit-Remaining', remaining);
  res.setHeader('X-RateLimit-Reset', resetTimestamp);

  // Check if over limit
  if (entry.count > limit) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    res.setHeader('Retry-After', retryAfter);
    
    return next(new RateLimitError(retryAfter, 
      `Rate limit exceeded. Try again in ${retryAfter} seconds`
    ));
  }

  next();
}

/**
 * Stricter rate limit for sensitive endpoints (login, etc.)
 * Uses shorter window and lower limit
 */
export function strictRateLimit(limit: number = 10, windowMinutes: number = 15) {
  const limitStore = new Map<string, RateLimitEntry>();

  // Clean up expired entries
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of limitStore.entries()) {
      if (entry.resetAt < now) {
        limitStore.delete(key);
      }
    }
  }, windowMinutes * 60 * 1000);

  return (req: ApiKeyRequest & AuthRequest, res: Response, next: NextFunction) => {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded 
      ? (typeof forwarded === 'string' ? forwarded : forwarded[0]).split(',')[0].trim()
      : req.socket.remoteAddress || 'unknown';
    
    const key = `${req.path}:${ip}`;
    const windowMs = windowMinutes * 60 * 1000;
    const now = Date.now();

    let entry = limitStore.get(key);

    if (!entry || entry.resetAt < now) {
      entry = {
        count: 0,
        resetAt: now + windowMs,
      };
      limitStore.set(key, entry);
    }

    entry.count++;

    const remaining = Math.max(0, limit - entry.count);
    const resetTimestamp = Math.ceil(entry.resetAt / 1000);

    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', resetTimestamp);

    if (entry.count > limit) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      
      return next(new RateLimitError(retryAfter,
        `Too many attempts. Try again in ${Math.ceil(retryAfter / 60)} minutes`
      ));
    }

    next();
  };
}
