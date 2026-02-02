// Audit logging utility - stub for now
// TODO: Implement proper audit logging with database storage

import { Request } from 'express';

export interface AuditLogParams {
  userId?: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  entity: string;
  entityId: string;
  oldValue?: Record<string, any>;
  newValue?: Record<string, any>;
  req?: Request;
}

export async function logAudit(params: AuditLogParams): Promise<void> {
  // For now, just log to console
  // TODO: Save to database when AuditLog model is added
  console.log('[AUDIT]', {
    timestamp: new Date().toISOString(),
    userId: params.userId,
    action: params.action,
    entity: params.entity,
    entityId: params.entityId,
    oldValue: params.oldValue,
    newValue: params.newValue,
    ip: params.req?.ip,
  });
}
