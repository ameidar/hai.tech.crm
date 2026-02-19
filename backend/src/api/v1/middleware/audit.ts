// @ts-nocheck
import { Response, NextFunction } from 'express';
import { prisma } from '../../../utils/prisma.js';
import { ApiKeyRequest } from './api-key-auth.js';
import { AuthRequest } from './auth.js';
import { logger } from './logger.js';

type CombinedRequest = ApiKeyRequest & AuthRequest;

/**
 * Extract entity info from request path
 * e.g., /api/v1/customers/123 -> { entity: 'Customer', entityId: '123' }
 */
function extractEntityInfo(path: string): { entity: string; entityId?: string } | null {
  // Match patterns like /api/v1/entity or /api/v1/entity/:id
  const match = path.match(/\/api\/v1\/([a-z-]+)(?:\/([a-f0-9-]+))?/i);
  
  if (!match) return null;

  // Map route to entity name
  const entityMap: Record<string, string> = {
    'customers': 'Customer',
    'students': 'Student',
    'courses': 'Course',
    'branches': 'Branch',
    'instructors': 'Instructor',
    'cycles': 'Cycle',
    'meetings': 'Meeting',
    'registrations': 'Registration',
    'attendance': 'Attendance',
    'api-keys': 'ApiKey',
  };

  const entity = entityMap[match[1]];
  if (!entity) return null;

  return {
    entity,
    entityId: match[2],
  };
}

/**
 * Determine action from HTTP method
 */
function getAction(method: string): string {
  switch (method.toUpperCase()) {
    case 'POST':
      return 'CREATE';
    case 'PUT':
    case 'PATCH':
      return 'UPDATE';
    case 'DELETE':
      return 'DELETE';
    default:
      return 'READ';
  }
}

/**
 * Get client IP from request
 */
function getClientIp(req: CombinedRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = (typeof forwarded === 'string' ? forwarded : forwarded[0]).split(',');
    return ips[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

/**
 * Create audit log entry
 */
export async function createAuditLog(options: {
  userId?: string;
  userName?: string;
  apiKeyId?: string;
  action: string;
  entity: string;
  entityId: string;
  oldValue?: any;
  newValue?: any;
  ipAddress?: string;
  userAgent?: string;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: options.userId,
        userName: options.userName,
        apiKeyId: options.apiKeyId,
        action: options.action,
        entity: options.entity,
        entityId: options.entityId,
        oldValue: options.oldValue,
        newValue: options.newValue,
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
      },
    });
  } catch (error) {
    // Log but don't fail the request
    logger.error({ error }, 'Failed to create audit log');
  }
}

/**
 * Middleware that automatically logs mutations (POST, PUT, PATCH, DELETE)
 * Should be placed after auth middleware
 */
export function auditMiddleware(req: CombinedRequest, res: Response, next: NextFunction) {
  const method = req.method.toUpperCase();
  
  // Only audit mutations
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return next();
  }

  const entityInfo = extractEntityInfo(req.path);
  if (!entityInfo) {
    return next();
  }

  // Store original send to intercept response
  const originalSend = res.send.bind(res);
  let responseBody: any;

  res.send = function(body: any) {
    responseBody = body;
    return originalSend(body);
  };

  // Log after response is sent
  res.on('finish', async () => {
    // Only log successful mutations
    if (res.statusCode >= 200 && res.statusCode < 300) {
      try {
        const parsedResponse = typeof responseBody === 'string' 
          ? JSON.parse(responseBody) 
          : responseBody;

        // Get entity ID from response or params
        let entityId = entityInfo.entityId;
        if (!entityId && parsedResponse?.data?.id) {
          entityId = parsedResponse.data.id;
        }

        if (entityId) {
          await createAuditLog({
            userId: req.user?.userId,
            userName: req.user?.email,
            apiKeyId: req.apiKey?.id,
            action: getAction(method),
            entity: entityInfo.entity,
            entityId,
            newValue: method !== 'DELETE' ? req.body : undefined,
            ipAddress: getClientIp(req),
            userAgent: req.headers['user-agent'],
          });
        }
      } catch (error) {
        logger.error({ error }, 'Failed to process audit log');
      }
    }
  });

  next();
}

/**
 * Query audit logs
 */
export async function getAuditLogs(options: {
  entity?: string;
  entityId?: string;
  userId?: string;
  apiKeyId?: string;
  action?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}) {
  const where: any = {};

  if (options.entity) where.entity = options.entity;
  if (options.entityId) where.entityId = options.entityId;
  if (options.userId) where.userId = options.userId;
  if (options.apiKeyId) where.apiKeyId = options.apiKeyId;
  if (options.action) where.action = options.action;
  
  if (options.startDate || options.endDate) {
    where.createdAt = {};
    if (options.startDate) where.createdAt.gte = options.startDate;
    if (options.endDate) where.createdAt.lte = options.endDate;
  }

  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: {
        apiKey: {
          select: {
            id: true,
            name: true,
            keyPrefix: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: options.limit || 50,
      skip: options.offset || 0,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { items, total };
}
