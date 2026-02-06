import { Response } from 'express';

/**
 * Pagination metadata for list responses
 */
export interface PaginationMeta {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Response metadata included in all responses
 */
export interface ResponseMeta {
  requestId: string;
  timestamp: string;
}

/**
 * Standard success response with single item
 */
export interface SingleResponse<T> {
  data: T;
  meta: ResponseMeta;
}

/**
 * Standard success response with list of items
 */
export interface ListResponse<T> {
  data: T[];
  pagination: PaginationMeta;
  meta: ResponseMeta;
}

/**
 * Standard error response
 */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta: ResponseMeta;
}

/**
 * Get request ID from response locals (set by requestId middleware)
 */
function getRequestId(res: Response): string {
  return res.locals.requestId || 'unknown';
}

/**
 * Create response metadata
 */
function createMeta(res: Response): ResponseMeta {
  return {
    requestId: getRequestId(res),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Send a successful response with a single data item
 */
export function sendSuccess<T>(res: Response, data: T, statusCode = 200): void {
  const response: SingleResponse<T> = {
    data,
    meta: createMeta(res),
  };
  res.status(statusCode).json(response);
}

/**
 * Send a successful response for resource creation
 */
export function sendCreated<T>(res: Response, data: T): void {
  sendSuccess(res, data, 201);
}

/**
 * Send a successful list response with pagination
 */
export function sendList<T>(
  res: Response,
  data: T[],
  pagination: { total: number; limit: number; offset: number },
  statusCode = 200
): void {
  const response: ListResponse<T> = {
    data,
    pagination: {
      ...pagination,
      hasMore: pagination.offset + data.length < pagination.total,
    },
    meta: createMeta(res),
  };
  res.status(statusCode).json(response);
}

/**
 * Send a no-content response (204)
 */
export function sendNoContent(res: Response): void {
  res.status(204).send();
}

/**
 * Send an error response
 */
export function sendError(
  res: Response,
  statusCode: number,
  code: string,
  message: string,
  details?: unknown
): void {
  const error: ErrorResponse['error'] = {
    code,
    message,
  };
  if (details !== undefined) {
    error.details = details;
  }
  const response: ErrorResponse = {
    error,
    meta: createMeta(res),
  };
  res.status(statusCode).json(response);
}
