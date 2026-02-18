import { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { ApiError } from '../../../common/errors/index.js';
import { sendError } from '../../../common/utils/response.js';
import { logger } from './logger.js';

/**
 * Format Zod validation errors into a consistent structure
 */
function formatZodErrors(error: ZodError) {
  return error.errors.map((e) => ({
    field: e.path.join('.'),
    message: e.message,
    code: e.code,
  }));
}

/**
 * Handle Prisma errors and convert to API errors
 */
function handlePrismaError(error: Prisma.PrismaClientKnownRequestError) {
  switch (error.code) {
    case 'P2002': {
      // Unique constraint violation
      const target = error.meta?.target as string[] | undefined;
      const field = target?.join(', ') || 'field';
      return {
        statusCode: 409,
        code: 'CONFLICT',
        message: `A record with this ${field} already exists`,
        details: { field },
      };
    }
    case 'P2025':
      // Record not found
      return {
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Record not found',
      };
    case 'P2003':
      // Foreign key constraint violation
      return {
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Invalid reference: related record does not exist',
      };
    case 'P2014':
      // Relation violation
      return {
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Cannot perform this action due to related records',
      };
    default:
      return {
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        message: 'Database error',
      };
  }
}

/**
 * API v1 Error Handler Middleware
 * 
 * Handles all errors and formats them according to the API standard:
 * {
 *   error: { code, message, details? },
 *   meta: { requestId, timestamp }
 * }
 */
export const apiErrorHandler: ErrorRequestHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const requestId = res.locals.requestId || 'unknown';
  
  // Log the error
  logger.error({
    err,
    requestId,
    method: req.method,
    url: req.url,
    userId: res.locals.userId,
  }, 'Request error');
  
  // Already sent response (shouldn't happen, but safety check)
  if (res.headersSent) {
    return;
  }
  
  // Handle Zod validation errors
  if (err instanceof ZodError) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Invalid input', formatZodErrors(err));
    return;
  }
  
  // Handle our custom API errors
  if (err instanceof ApiError) {
    sendError(res, err.statusCode, err.code, err.message, err.details);
    return;
  }
  
  // Handle Prisma errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const { statusCode, code, message, details } = handlePrismaError(err);
    sendError(res, statusCode, code, message, details);
    return;
  }
  
  if (err instanceof Prisma.PrismaClientValidationError) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Invalid data format');
    return;
  }
  
  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    sendError(res, 401, 'UNAUTHORIZED', 'Invalid token');
    return;
  }
  
  if (err.name === 'TokenExpiredError') {
    sendError(res, 401, 'UNAUTHORIZED', 'Token expired');
    return;
  }
  
  // Handle syntax errors (e.g., malformed JSON)
  if (err instanceof SyntaxError && 'body' in err) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Invalid JSON');
    return;
  }
  
  // Default: Internal server error
  // Don't expose internal error details in production
  const message = process.env.NODE_ENV === 'development' 
    ? err.message 
    : 'Internal server error';
    
  sendError(res, 500, 'INTERNAL_ERROR', message);
};
