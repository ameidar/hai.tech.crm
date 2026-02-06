import { Router } from 'express';
import { requestIdMiddleware, httpLogger, apiErrorHandler } from './middleware/index.js';
import { healthRouter } from './routes/health.js';

/**
 * API v1 Router
 * 
 * This is the main entry point for API v1.
 * All routes are prefixed with /api/v1
 */
const router = Router();

// =============================================================================
// Middleware (applied to all v1 routes)
// =============================================================================

// Generate unique request ID for each request
router.use(requestIdMiddleware);

// HTTP request/response logging with correlation ID
router.use(httpLogger);

// =============================================================================
// Routes
// =============================================================================

// Health checks
router.use('/health', healthRouter);

// Future routes will be added here:
// router.use('/auth', authRouter);
// router.use('/customers', customersRouter);
// router.use('/students', studentsRouter);
// etc.

// =============================================================================
// Error Handler (must be last)
// =============================================================================
router.use(apiErrorHandler);

export { router as apiV1Router };
