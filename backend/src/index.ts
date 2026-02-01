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

const app = express();

// Security middleware - relaxed for serving frontend
app.use(helmet({
  contentSecurityPolicy: false, // Allow inline scripts from Vite build
}));
app.use(cors({
  origin: config.corsOrigins,
  credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10000, // limit each IP to 10000 requests per windowMs (increased for migration)
  message: { error: 'Too many requests, please try again later' },
});
app.use('/api', limiter);

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
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
app.use('/api/cycles', cyclesRouter);
app.use('/api/meetings', meetingsRouter);
app.use('/api/registrations', registrationsRouter);
app.use('/api/attendance', attendanceRouter);
app.use('/api/webhook', webhookRouter);

// Error handling for API routes
app.use('/api', errorHandler);

// Serve static frontend files
const frontendPath = path.join(process.cwd(), 'frontend-dist');
app.use(express.static(frontendPath));

// SPA fallback - serve index.html for all non-API routes
app.get('*', (_req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Start server
const start = async () => {
  try {
    // Test database connection
    await prisma.$connect();
    console.log('✅ Database connected');

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
