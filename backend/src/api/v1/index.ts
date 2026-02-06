import { Router } from 'express';
import { requestIdMiddleware, httpLogger, apiErrorHandler } from './middleware/index.js';
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

// Future routes will be added here:
// router.use('/institutional-orders', institutionalOrdersRouter);

// =============================================================================
// Error Handler (must be last)
// =============================================================================
router.use(apiErrorHandler);

export { router as apiV1Router };
