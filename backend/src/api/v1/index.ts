import { Router } from 'express';
import { requestIdMiddleware, httpLogger, apiErrorHandler } from './middleware/index.js';
import { rateLimit } from './middleware/rate-limit.js';
import { auditMiddleware } from './middleware/audit.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { customersRouter } from './routes/customers.js';
import { studentsRouter } from './routes/students.js';
import { coursesRouter } from './routes/courses.js';
import { branchesRouter } from './routes/branches.js';
import { instructorsRouter } from './routes/instructors.js';
import { cyclesRouter } from './routes/cycles.js';
import { meetingsRouter } from './routes/meetings.js';
import { registrationsRouter } from './routes/registrations.js';
import { attendanceRouter } from './routes/attendance.js';
import apiKeysRouter from './routes/api-keys.js';
import webhooksRouter from './routes/webhooks.js';
import reportsRouter from './routes/reports.js';

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

// Rate limiting (per user/API key/IP)
router.use(rateLimit);

// Audit logging for mutations
router.use(auditMiddleware);

// =============================================================================
// Routes
// =============================================================================

// Health checks (public)
router.use('/health', healthRouter);

// Authentication (public + protected)
router.use('/auth', authRouter);

// Core CRUD endpoints (protected)
router.use('/customers', customersRouter);
router.use('/students', studentsRouter);
router.use('/courses', coursesRouter);
router.use('/branches', branchesRouter);
router.use('/instructors', instructorsRouter);
router.use('/cycles', cyclesRouter);
router.use('/meetings', meetingsRouter);
router.use('/registrations', registrationsRouter);
router.use('/attendance', attendanceRouter);

// Security & Admin endpoints (protected, admin only)
router.use('/api-keys', apiKeysRouter);
router.use('/webhooks', webhooksRouter);
router.use('/reports', reportsRouter);

// Future routes will be added here:
// router.use('/institutional-orders', institutionalOrdersRouter);

// =============================================================================
// Error Handler (must be last)
// =============================================================================
router.use(apiErrorHandler);

export { router as apiV1Router };
