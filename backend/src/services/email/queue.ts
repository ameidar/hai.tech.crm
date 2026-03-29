import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { sendEmail, EmailOptions } from './sender.js';

// Redis connection config
const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

// Email priority levels
export enum EmailPriority {
  HIGH = 1,
  NORMAL = 5,
  LOW = 10,
}

// Email job data interface
export interface EmailJobData extends EmailOptions {
  priority?: EmailPriority;
  templateId?: string;
  metadata?: Record<string, any>;
}

// Email job result
export interface EmailJobResult {
  success: boolean;
  messageId?: string;
  error?: string;
  sentAt?: Date;
}

// Daily email counter for rate limiting (2000/day max)
let dailyEmailCount = 0;
let lastResetDate = new Date().toDateString();

const resetDailyCounterIfNeeded = () => {
  const today = new Date().toDateString();
  if (today !== lastResetDate) {
    dailyEmailCount = 0;
    lastResetDate = today;
  }
};

// Create email queue with rate limiting
export const emailQueue = new Queue<EmailJobData, EmailJobResult>('email-queue', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000, // Start with 5 seconds
    },
    removeOnComplete: {
      count: 1000, // Keep last 1000 completed jobs
    },
    removeOnFail: {
      count: 500, // Keep last 500 failed jobs
    },
  },
});

// Queue events for monitoring
export const queueEvents = new QueueEvents('email-queue', { connection });

// Create worker with rate limiting: 20 emails/sec
export const emailWorker = new Worker<EmailJobData, EmailJobResult>(
  'email-queue',
  async (job: Job<EmailJobData, EmailJobResult>) => {
    const { to, subject, html, text, priority } = job.data;

    // Check daily limit
    resetDailyCounterIfNeeded();
    if (dailyEmailCount >= 2000) {
      throw new Error('Daily email limit (2000) reached');
    }

    console.log(`📧 Processing email job ${job.id} to ${to} (priority: ${priority || 'normal'})`);

    try {
      const result = await sendEmail({ to, subject, html, text });
      dailyEmailCount++;

      console.log(`✅ Email sent successfully to ${to} (${dailyEmailCount}/2000 today)`);

      return {
        success: true,
        messageId: result.messageId,
        sentAt: new Date(),
      };
    } catch (error) {
      console.error(`❌ Failed to send email to ${to}:`, error);
      throw error; // Will trigger retry
    }
  },
  {
    connection,
    concurrency: 5, // Process 5 emails concurrently
    limiter: {
      max: 20, // 20 emails per second
      duration: 1000,
    },
  }
);

// Worker event handlers
emailWorker.on('completed', (job) => {
  console.log(`📬 Email job ${job.id} completed`);
});

emailWorker.on('failed', (job, err) => {
  console.error(`💥 Email job ${job?.id} failed:`, err.message);
});

emailWorker.on('error', (err) => {
  console.error('Worker error:', err);
});

// Add email to queue
export const queueEmail = async (
  emailData: EmailJobData
): Promise<Job<EmailJobData, EmailJobResult>> => {
  const priority = emailData.priority || EmailPriority.NORMAL;

  const job = await emailQueue.add('send-email', emailData, {
    priority,
    delay: 0,
  });

  console.log(`📥 Email queued: ${job.id} to ${emailData.to} (priority: ${priority})`);
  return job;
};

// Bulk queue emails
export const queueBulkEmails = async (
  emails: EmailJobData[]
): Promise<Job<EmailJobData, EmailJobResult>[]> => {
  const jobs = await Promise.all(
    emails.map((email) => queueEmail(email))
  );
  console.log(`📥 Bulk queued ${jobs.length} emails`);
  return jobs;
};

// Get queue statistics
export const getQueueStats = async () => {
  resetDailyCounterIfNeeded();

  const [waiting, active, completed, failed, delayed] = await Promise.all([
    emailQueue.getWaitingCount(),
    emailQueue.getActiveCount(),
    emailQueue.getCompletedCount(),
    emailQueue.getFailedCount(),
    emailQueue.getDelayedCount(),
  ]);

  return {
    waiting,
    active,
    completed,
    failed,
    delayed,
    dailyCount: dailyEmailCount,
    dailyLimit: 2000,
    dailyRemaining: 2000 - dailyEmailCount,
    rateLimitPerSecond: 20,
  };
};

// Initialize queue (call on app start)
export const initEmailQueue = () => {
  console.log('📧 Email queue initialized');
  console.log(`   Rate limit: 20/sec, 2000/day`);
  console.log(`   Retries: 3 attempts with exponential backoff`);

  // Handle graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('Closing email queue...');
    await emailWorker.close();
    await emailQueue.close();
    await queueEvents.close();
  });
};
