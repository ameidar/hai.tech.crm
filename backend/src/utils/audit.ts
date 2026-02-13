// Audit logging utility
import { Request } from 'express';
import { prisma } from './prisma.js';

export interface AuditLogParams {
  userId?: string;
  userName?: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  entity: string;
  entityId: string;
  oldValue?: Record<string, any>;
  newValue?: Record<string, any>;
  req?: Request;
}

// Fields to exclude from audit logs (internal/system fields)
const EXCLUDED_FIELDS = ['updatedAt', 'createdAt', 'passwordHash', 'refreshToken'];

/**
 * Compute the differences between two objects
 * Returns { oldValue, newValue } with only the changed fields
 */
export function computeChanges(
  oldObj: Record<string, any> | null | undefined,
  newObj: Record<string, any> | null | undefined,
  fieldsToInclude?: string[]
): { oldValue: Record<string, any>; newValue: Record<string, any>; hasChanges: boolean } {
  const oldValue: Record<string, any> = {};
  const newValue: Record<string, any> = {};

  if (!oldObj && !newObj) {
    return { oldValue, newValue, hasChanges: false };
  }

  // For CREATE - just return new values
  if (!oldObj && newObj) {
    const filteredNew: Record<string, any> = {};
    for (const key of Object.keys(newObj)) {
      if (EXCLUDED_FIELDS.includes(key)) continue;
      if (fieldsToInclude && !fieldsToInclude.includes(key)) continue;
      if (newObj[key] !== undefined && newObj[key] !== null) {
        filteredNew[key] = newObj[key];
      }
    }
    return { oldValue: {}, newValue: filteredNew, hasChanges: Object.keys(filteredNew).length > 0 };
  }

  // For DELETE - just return old values
  if (oldObj && !newObj) {
    const filteredOld: Record<string, any> = {};
    for (const key of Object.keys(oldObj)) {
      if (EXCLUDED_FIELDS.includes(key)) continue;
      if (fieldsToInclude && !fieldsToInclude.includes(key)) continue;
      if (oldObj[key] !== undefined && oldObj[key] !== null) {
        filteredOld[key] = oldObj[key];
      }
    }
    return { oldValue: filteredOld, newValue: {}, hasChanges: Object.keys(filteredOld).length > 0 };
  }

  // For UPDATE - compare and return only changed fields
  const allKeys = new Set([...Object.keys(oldObj!), ...Object.keys(newObj!)]);

  for (const key of allKeys) {
    if (EXCLUDED_FIELDS.includes(key)) continue;
    if (fieldsToInclude && !fieldsToInclude.includes(key)) continue;

    const oldVal = oldObj![key];
    const newVal = newObj![key];

    // Compare values (handle dates, objects, arrays)
    const oldStr = JSON.stringify(oldVal);
    const newStr = JSON.stringify(newVal);

    if (oldStr !== newStr) {
      oldValue[key] = oldVal;
      newValue[key] = newVal;
    }
  }

  return { oldValue, newValue, hasChanges: Object.keys(oldValue).length > 0 };
}

/**
 * Log an audit entry with automatic user info extraction from request
 */
export async function logAudit(params: AuditLogParams): Promise<void> {
  try {
    // Extract user info from request if available
    const user = (params.req as any)?.user;
    const userId = params.userId || user?.userId;
    const userName = params.userName || user?.name || user?.email;

    await prisma.auditLog.create({
      data: {
        userId,
        userName,
        action: params.action,
        entity: params.entity,
        entityId: params.entityId,
        oldValue: params.oldValue ?? undefined,
        newValue: params.newValue ?? undefined,
        ipAddress: params.req?.ip || params.req?.socket?.remoteAddress,
        userAgent: params.req?.get('user-agent'),
      },
    });
  } catch (error) {
    // Log error but don't fail the main operation
    console.error('[AUDIT ERROR]', error);
  }
}

/**
 * Convenience function for logging updates with automatic change detection
 */
export async function logUpdateAudit(params: {
  entity: string;
  entityId: string;
  oldRecord: Record<string, any>;
  newRecord: Record<string, any>;
  fieldsToInclude?: string[];
  req?: Request;
}): Promise<void> {
  const { oldValue, newValue, hasChanges } = computeChanges(
    params.oldRecord,
    params.newRecord,
    params.fieldsToInclude
  );

  // Don't log if nothing changed
  if (!hasChanges) return;

  await logAudit({
    action: 'UPDATE',
    entity: params.entity,
    entityId: params.entityId,
    oldValue,
    newValue,
    req: params.req,
  });
}

export async function getAuditLogs(options: {
  entity?: string;
  entityId?: string;
  userId?: string;
  action?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}) {
  const where: any = {};
  
  if (options.entity) where.entity = options.entity;
  if (options.entityId) where.entityId = options.entityId;
  if (options.userId) where.userId = options.userId;
  if (options.action) where.action = options.action;
  
  if (options.from || options.to) {
    where.createdAt = {};
    if (options.from) where.createdAt.gte = options.from;
    if (options.to) where.createdAt.lte = options.to;
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: options.limit || 50,
      skip: options.offset || 0,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { logs, total };
}
