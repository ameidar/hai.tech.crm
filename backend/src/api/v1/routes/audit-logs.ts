import { Router, Response, NextFunction } from 'express';
import { authenticate, adminOnly, AuthRequest } from '../middleware/auth.js';
import { validateQuery } from '../middleware/validate.js';
import { getAuditLogs } from '../middleware/audit.js';
import { sendSuccess, sendList } from '../../../common/utils/response.js';
import { z } from 'zod';

const router = Router();

// All routes require authentication + admin
router.use(authenticate);
router.use(adminOnly);

/**
 * Audit log query schema
 */
const auditLogQuerySchema = z.object({
  entity: z.string().optional(),
  entityId: z.string().optional(),
  userId: z.string().optional(),
  apiKeyId: z.string().optional(),
  action: z.enum(['CREATE', 'UPDATE', 'DELETE']).optional(),
  from: z.string().optional().transform((val) => val ? new Date(val) : undefined),
  to: z.string().optional().transform((val) => val ? new Date(val) : undefined),
  limit: z.string().optional().transform((val) => val ? parseInt(val, 10) : 50),
  offset: z.string().optional().transform((val) => val ? parseInt(val, 10) : 0),
});

type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

/**
 * GET /audit-logs
 * List audit logs with filters
 */
router.get('/', validateQuery(auditLogQuerySchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const query = req.query as unknown as AuditLogQuery;
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    
    const result = await getAuditLogs({
      entity: query.entity,
      entityId: query.entityId,
      userId: query.userId,
      apiKeyId: query.apiKeyId,
      action: query.action,
      startDate: query.from,
      endDate: query.to,
      limit,
      offset,
    });

    sendList(res, result.items, {
      total: result.total,
      limit,
      offset,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /audit-logs/entities
 * Get list of entities that have audit logs
 */
router.get('/entities', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { prisma } = await import('../../../utils/prisma.js');
    
    const entities = await prisma.auditLog.groupBy({
      by: ['entity'],
      _count: { entity: true },
      orderBy: { _count: { entity: 'desc' } },
    });

    sendSuccess(res, entities.map(e => ({
      entity: e.entity,
      count: e._count.entity,
    })));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /audit-logs/stats
 * Get audit log statistics
 */
router.get('/stats', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { prisma } = await import('../../../utils/prisma.js');
    
    const [byAction, byEntity, byApiKey, total] = await Promise.all([
      prisma.auditLog.groupBy({
        by: ['action'],
        _count: { action: true },
      }),
      prisma.auditLog.groupBy({
        by: ['entity'],
        _count: { entity: true },
        orderBy: { _count: { entity: 'desc' } },
        take: 10,
      }),
      prisma.auditLog.groupBy({
        by: ['apiKeyId'],
        where: { apiKeyId: { not: null } },
        _count: { apiKeyId: true },
        orderBy: { _count: { apiKeyId: 'desc' } },
        take: 10,
      }),
      prisma.auditLog.count(),
    ]);

    sendSuccess(res, {
      total,
      byAction: byAction.map(a => ({ action: a.action, count: a._count.action })),
      byEntity: byEntity.map(e => ({ entity: e.entity, count: e._count.entity })),
      byApiKey: byApiKey.map(k => ({ apiKeyId: k.apiKeyId, count: k._count.apiKeyId })),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
