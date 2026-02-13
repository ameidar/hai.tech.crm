import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { prisma } from './utils/prisma.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authRouter } from './routes/auth.js';
import { customersRouter } from './routes/customers.js';
import { studentsRouter } from './routes/students.js';
import { coursesRouter } from './routes/courses.js';
import { branchesRouter } from './routes/branches.js';
import { instructorsRouter } from './routes/instructors.js';
import { inviteRouter } from './routes/invite.js';
import { cyclesRouter } from './routes/cycles.js';
import { meetingsRouter } from './routes/meetings.js';
import { registrationsRouter } from './routes/registrations.js';
import { attendanceRouter } from './routes/attendance.js';
import { webhookRouter } from './routes/webhook.js';
import { publicMeetingRouter } from './routes/public-meeting.js';
import { auditRouter } from './routes/audit.js';
import { viewsRouter } from './routes/views.js';
import { communicationRouter } from './routes/communication.js';
import zoomRouter from './routes/zoom.js';
import zoomWebhookRouter from './routes/zoom-webhook.js';
import { instructorMagicRouter } from './routes/instructor-magic.js';
import { parentAppRouter } from './routes/parent-app.js';
import { messagingRouter } from './routes/messaging.js';
import expensesRouter from './routes/expenses.js';
import { emailRouter } from './routes/email.js';
import { initEmailQueue } from './services/email/queue.js';
import { initEmailScheduler } from './services/email/scheduler.js';

const app = express();

// Security middleware with proper CSP
// Disable security headers in development for HTTP testing
if (process.env.NODE_ENV === 'production') {
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "https:"],
        fontSrc: ["'self'", "https:", "data:"],
        connectSrc: ["'self'", "https:"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: [],
      },
    },
  }));
} else {
  // Minimal security in development - allow HTTP
  app.use(helmet({
    contentSecurityPolicy: false,
    strictTransportSecurity: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
  }));
}
// Permissive CORS for webhook routes (API key protected)
app.use('/api/webhook', cors({
  origin: '*',
  credentials: false,
  allowedHeaders: ['Content-Type', 'X-API-Key'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));

// Regular CORS for other routes
app.use(cors({
  origin: config.corsOrigins,
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));

// Rate limiting with per-user tracking when authenticated
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10000, // limit each IP/user to 1000 requests per windowMs
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  // Use userId when available for more accurate rate limiting
  keyGenerator: (req) => {
    // Check for authenticated user in JWT
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const token = authHeader.substring(7);
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, config.jwt.secret) as { userId: string };
        if (decoded.userId) {
          return `user:${decoded.userId}`;
        }
      } catch {
        // Token invalid or expired, fall back to IP
      }
    }
    return req.ip || req.socket.remoteAddress || 'unknown';
  },
});
app.use('/api', limiter);

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check with database connectivity test
app.get('/api/health', async (_req, res) => {
  const health: {
    status: 'ok' | 'degraded' | 'error';
    timestamp: string;
    version: string;
    database: 'connected' | 'disconnected';
  } = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    database: 'disconnected',
  };

  try {
    // Test database connectivity with a simple query
    await prisma.$queryRaw`SELECT 1`;
    health.database = 'connected';
  } catch (error) {
    health.status = 'degraded';
    health.database = 'disconnected';
    console.error('Health check: Database connection failed', error);
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/invite', inviteRouter); // Public invite endpoints
app.use('/api/meeting-status', publicMeetingRouter); // Public meeting status updates
app.use('/api/customers', customersRouter);
app.use('/api/students', studentsRouter);
app.use('/api/courses', coursesRouter);
app.use('/api/branches', branchesRouter);
app.use('/api/instructors', instructorsRouter);
app.use('/api/messaging', messagingRouter);
app.use('/api/cycles', cyclesRouter);
app.use('/api/meetings', meetingsRouter);
app.use('/api/registrations', registrationsRouter);
app.use('/api/attendance', attendanceRouter);
app.use('/api/audit', auditRouter);
app.use('/api/views', viewsRouter);
app.use('/api/webhook', webhookRouter);
app.use('/api/communication', communicationRouter);
app.use('/api/zoom', zoomRouter);
app.use('/api/zoom-webhook', zoomWebhookRouter);
app.use('/api/instructor-magic', instructorMagicRouter);
app.use('/api/parent', parentAppRouter); // Parent mobile app API
app.use('/api/expenses', expensesRouter); // Expense tracking
app.use('/api/email', emailRouter); // Email service

// Error handling for API routes
app.use('/api', errorHandler);

// Serve static frontend files
const frontendPath = path.join(process.cwd(), 'frontend-dist');
app.use(express.static(frontendPath, {
  index: false, // Disable auto index.html serving, we handle it in SPA fallback
  setHeaders: (res, filePath) => {
    // Don't cache HTML files
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, private');
      res.setHeader('CDN-Cache-Control', 'no-store');
      res.setHeader('Cloudflare-CDN-Cache-Control', 'no-store');
      res.setHeader('Surrogate-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// SPA fallback - serve index.html for all non-API routes (no cache!)
// Generate unique ETag based on server start time to force cache invalidation
const serverStartTime = Date.now().toString(36);
app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, private');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Cloudflare-CDN-Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('ETag', `"${serverStartTime}"`);
  res.setHeader('Last-Modified', new Date().toUTCString());
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Start server
const start = async () => {
  try {
    // Test database connection
    await prisma.$connect();
    console.log('✅ Database connected');

    // Initialize email services
    initEmailQueue();
    initEmailScheduler();

    app.listen(config.port, () => {
      console.log(`🚀 HaiTech CRM API running on port ${config.port}`);
      console.log(`📍 Health check: http://localhost:${config.port}/api/health`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});

start();
