import pino from 'pino';
import pinoHttp from 'pino-http';
import { Request, Response } from 'express';

/**
 * Create the base Pino logger instance
 */
export function createLogger(options?: { level?: string; pretty?: boolean }) {
  const level = options?.level || process.env.LOG_LEVEL || 'info';
  let pretty = options?.pretty ?? process.env.NODE_ENV === 'development';
  // pino-pretty may not be available in Docker production builds
  if (pretty) {
    try { require.resolve('pino-pretty'); } catch { pretty = false; }
  }

  return pino({
    level,
    ...(pretty && {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    }),
    ...(!pretty && {
      // Production: structured JSON logs
      formatters: {
        level: (label) => ({ level: label }),
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    }),
    // Redact sensitive fields
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers["x-api-key"]',
        'res.headers["set-cookie"]',
        'password',
        'token',
        'secret',
      ],
      censor: '[REDACTED]',
    },
  });
}

/**
 * Application logger instance
 */
export const logger = createLogger();

/**
 * Create pino-http middleware for request/response logging
 */
export function createHttpLogger() {
  return pinoHttp({
    logger,
    
    // Generate request ID from response locals (set by requestId middleware)
    genReqId: (req: Request, res: Response) => {
      return res.locals?.requestId || req.headers['x-request-id'] || undefined;
    },
    
    // Custom request serializer
    serializers: {
      req: (req) => ({
        method: req.method,
        url: req.url,
        query: req.query,
        // Don't log full headers for brevity
        userAgent: req.headers?.['user-agent'],
      }),
      res: (res) => ({
        statusCode: res.statusCode,
      }),
      err: pino.stdSerializers.err,
    },
    
    // Custom log level based on status code
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    
    // Custom success message
    customSuccessMessage: (req, res) => {
      return `${req.method} ${req.url} ${res.statusCode}`;
    },
    
    // Custom error message
    customErrorMessage: (req, res) => {
      return `${req.method} ${req.url} ${res.statusCode}`;
    },
    
    // Auto logging configuration
    autoLogging: {
      ignore: (req) => {
        // Don't log health check endpoints (too noisy)
        return req.url?.includes('/health') || false;
      },
    },
  });
}

/**
 * Export HTTP logger middleware instance
 */
export const httpLogger = createHttpLogger();

/**
 * Create a child logger with additional context
 */
export function createChildLogger(bindings: pino.Bindings) {
  return logger.child(bindings);
}
