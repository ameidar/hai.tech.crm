import { Router, Request, Response } from 'express';
import { prisma } from '../../../utils/prisma.js';
import { sendSuccess, sendError } from '../../../common/utils/response.js';

const router = Router();

/**
 * Health check response type
 */
interface HealthStatus {
  status: 'ok' | 'degraded' | 'error';
  version: string;
  uptime: number;
  checks?: {
    database?: 'connected' | 'disconnected';
  };
}

/**
 * @route   GET /api/v1/health
 * @desc    Basic health check - returns 200 if server is running
 * @access  Public
 */
router.get('/', (_req: Request, res: Response) => {
  const health: HealthStatus = {
    status: 'ok',
    version: '1.0.0',
    uptime: process.uptime(),
  };
  
  sendSuccess(res, health);
});

/**
 * @route   GET /api/v1/health/ready
 * @desc    Readiness check - verifies database connectivity
 * @access  Public
 * 
 * Used by load balancers and orchestrators (K8s, etc.) to determine
 * if the service is ready to accept traffic.
 */
router.get('/ready', async (_req: Request, res: Response) => {
  const health: HealthStatus = {
    status: 'ok',
    version: '1.0.0',
    uptime: process.uptime(),
    checks: {
      database: 'disconnected',
    },
  };
  
  try {
    // Test database connectivity with a simple query
    await prisma.$queryRaw`SELECT 1`;
    health.checks!.database = 'connected';
    
    sendSuccess(res, health);
  } catch (error) {
    health.status = 'error';
    health.checks!.database = 'disconnected';
    
    sendError(
      res,
      503,
      'SERVICE_UNAVAILABLE',
      'Service not ready',
      { checks: health.checks }
    );
  }
});

/**
 * @route   GET /api/v1/health/live
 * @desc    Liveness check - basic check that the process is running
 * @access  Public
 * 
 * Used by orchestrators to determine if the container should be restarted.
 * This should only fail if the process is truly dead/unresponsive.
 */
router.get('/live', (_req: Request, res: Response) => {
  sendSuccess(res, { status: 'alive' });
});

export { router as healthRouter };
