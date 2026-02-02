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

export async function logAudit(params: AuditLogParams): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        userName: params.userName,
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
