import { Router } from 'express';
import { authenticate, adminOnly } from '../middleware/auth.js';
import { getAuditLogs } from '../utils/audit.js';

export const auditRouter = Router();

// All audit routes require admin
auditRouter.use(authenticate);
auditRouter.use(adminOnly);

// Get audit logs with filters
auditRouter.get('/', async (req, res, next) => {
  try {
    const {
      entity,
      entityId,
      userId,
      action,
      from,
      to,
      limit,
      offset,
    } = req.query;

    const result = await getAuditLogs({
      entity: entity as string,
      entityId: entityId as string,
      userId: userId as string,
      action: action as string,
      from: from ? new Date(from as string) : undefined,
      to: to ? new Date(to as string) : undefined,
      limit: limit ? parseInt(limit as string) : 50,
      offset: offset ? parseInt(offset as string) : 0,
    });

    res.json({
      data: result.logs,
      pagination: {
        total: result.total,
        limit: limit ? parseInt(limit as string) : 50,
        offset: offset ? parseInt(offset as string) : 0,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Get audit logs for specific entity
auditRouter.get('/:entity/:entityId', async (req, res, next) => {
  try {
    const { entity, entityId } = req.params;
    const { limit, offset } = req.query;

    const result = await getAuditLogs({
      entity,
      entityId,
      limit: limit ? parseInt(limit as string) : 50,
      offset: offset ? parseInt(offset as string) : 0,
    });

    res.json({
      data: result.logs,
      pagination: {
        total: result.total,
        limit: limit ? parseInt(limit as string) : 50,
        offset: offset ? parseInt(offset as string) : 0,
      },
    });
  } catch (error) {
    next(error);
  }
});
