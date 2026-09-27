/**
 * Lesson AI Routes
 * POST /api/lesson-ai/generate   — generate lesson plan
 * GET  /api/lesson-ai/logs       — admin: view usage logs
 */

import { Router } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { generateLessonPlan } from '../services/lesson-ai.service.js';
import {
  generateLessonQuizForMeeting,
  getMeetingQuiz,
  getPublicLessonQuiz,
  sendLessonQuizToParent,
  submitLessonQuiz,
} from '../services/lesson-quiz.js';
import { processRecallBot, scheduleRecallBotForMeeting, scheduleRecallBotsForCycle } from '../services/recall-ai.js';
import { logAudit } from '../utils/audit.js';
import { z } from 'zod';

export const lessonAiRouter = Router();

const generateSchema = z.object({
  courseId: z.string().optional(),
  courseName: z.string().min(1),
  ageGroup: z.string().min(1),
  cycleName: z.string().optional(),
  topic: z.string().optional(),
});

const scheduleRecallSchema = z.object({
  joinEarlyMinutes: z.number().int().min(0).max(30).optional(),
});

const recallWebhookSchema = z.object({
  bot_id: z.string().optional(),
  bot: z.object({ id: z.string().optional() }).optional(),
  data: z.object({ bot_id: z.string().optional(), bot: z.object({ id: z.string().optional() }).optional() }).optional(),
});

const submitQuizSchema = z.object({
  answers: z.record(z.number().int().min(0).max(3)),
});

// POST /api/lesson-ai/recall-webhook - Recall webhook receiver.
// Configure RECALL_WEBHOOK_SECRET and send it as x-haitech-recall-secret.
lessonAiRouter.post('/recall-webhook', async (req, res, next) => {
  try {
    const expectedSecret = process.env.RECALL_WEBHOOK_SECRET;
    if (expectedSecret && req.get('x-haitech-recall-secret') !== expectedSecret) {
      return res.status(401).json({ error: 'Invalid Recall webhook secret' });
    }
    if (!expectedSecret && process.env.NODE_ENV === 'production') {
      return res.status(503).json({ error: 'Recall webhook secret is not configured' });
    }

    const body = recallWebhookSchema.passthrough().parse(req.body || {});
    const botId = body.bot_id || body.bot?.id || body.data?.bot_id || body.data?.bot?.id;
    if (!botId) return res.status(202).json({ success: true, skipped: 'missing_bot_id' });

    processRecallBot(botId).catch((error) => {
      console.error('[RecallAI] Failed to process webhook bot:', error);
    });

    res.json({ success: true, accepted: true, botId });
  } catch (error) {
    next(error);
  }
});

// GET /api/lesson-ai/quiz/:token - public child quiz page data
lessonAiRouter.get('/quiz/:token', async (req, res, next) => {
  try {
    const token = z.string().min(16).parse(req.params.token);
    const quiz = await getPublicLessonQuiz(token);
    if (!quiz) return res.status(404).json({ error: 'החידון לא נמצא' });
    res.json({ data: quiz });
  } catch (error) {
    next(error);
  }
});

// POST /api/lesson-ai/quiz/:token/submit - submit public child quiz answers
lessonAiRouter.post('/quiz/:token/submit', async (req, res, next) => {
  try {
    const token = z.string().min(16).parse(req.params.token);
    const body = submitQuizSchema.parse(req.body || {});
    const result = await submitLessonQuiz(token, body.answers);
    await logAudit({
      action: 'UPDATE',
      entity: 'lesson_quiz',
      entityId: result.id,
      newValue: {
        meetingId: result.meetingId,
        status: 'submitted',
        score: result.score,
        totalQuestions: result.totalQuestions,
        submittedAt: result.submittedAt,
      },
      req,
    });
    res.json({
      success: true,
      score: result.score,
      totalQuestions: result.totalQuestions,
      questions: result.questions,
    });
  } catch (error: any) {
    if (error.message === 'Quiz not found') return res.status(404).json({ error: 'החידון לא נמצא' });
    if (error.message === 'Quiz already submitted') return res.status(409).json({ error: 'החידון כבר הוגש' });
    next(error);
  }
});

lessonAiRouter.use(authenticate);

// POST /api/lesson-ai/generate
lessonAiRouter.post('/generate', async (req, res, next) => {
  try {
    const body = generateSchema.parse(req.body);
    const user = (req as any).user;

    // Get materialsFolderId from course if courseId provided
    let materialsFolderId: string | null = null;
    if (body.courseId) {
      const course = await prisma.course.findUnique({
        where: { id: body.courseId },
        select: { materialsFolderId: true },
      });
      materialsFolderId = course?.materialsFolderId ?? null;
    }

    const result = await generateLessonPlan({
      ...body,
      materialsFolderId,
      userId: user.userId,
      userName: user.name,
    });

    res.json({
      content: result.content,
      usedDrive: result.usedDrive,
      driveFiles: result.driveFiles,
      logId: result.logId,
      driveFileId: result.driveFileId,
      driveFileUrl: result.driveFileUrl,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/lesson-ai/meetings/:meetingId/recall-bot - schedule a Recall bot for a CRM meeting
lessonAiRouter.post('/meetings/:meetingId/recall-bot', managerOrAdmin, async (req, res, next) => {
  try {
    const meetingId = z.string().uuid().parse(req.params.meetingId);
    const body = scheduleRecallSchema.parse(req.body || {});
    const bot = await scheduleRecallBotForMeeting({
      meetingId,
      joinEarlyMinutes: body.joinEarlyMinutes,
    });

    res.json({
      success: true,
      botId: bot.id,
      joinAt: bot.join_at,
      status: bot.status_changes?.at(-1)?.code || 'scheduled',
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/lesson-ai/cycles/:cycleId/recall-bots - schedule Recall bots for future Google Meet meetings in a cycle
lessonAiRouter.post('/cycles/:cycleId/recall-bots', managerOrAdmin, async (req, res, next) => {
  try {
    const cycleId = z.string().uuid().parse(req.params.cycleId);
    const body = scheduleRecallSchema.parse(req.body || {});
    const result = await scheduleRecallBotsForCycle({
      cycleId,
      joinEarlyMinutes: body.joinEarlyMinutes,
    });

    res.json({
      success: true,
      scheduled: result.scheduled,
      skipped: result.skipped,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/lesson-ai/meetings/:meetingId/recall-process - manually pull Recall outputs into CRM
lessonAiRouter.post('/meetings/:meetingId/recall-process', managerOrAdmin, async (req, res, next) => {
  try {
    const meetingId = z.string().uuid().parse(req.params.meetingId);
    const meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { recallBotId: true },
    });
    if (!meeting?.recallBotId) {
      return res.status(400).json({ error: 'לפגישה אין Recall bot משויך' });
    }

    const result = await processRecallBot(meeting.recallBotId);
    res.json({
      success: true,
      processed: result.processed,
      meeting: result.meeting,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/lesson-ai/meetings/:meetingId/report - read the AI lesson report for a meeting
lessonAiRouter.get('/meetings/:meetingId/report', managerOrAdmin, async (req, res, next) => {
  try {
    const meetingId = z.string().uuid().parse(req.params.meetingId);
    const meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
      select: {
        id: true,
        recallBotId: true,
        recallBotStatus: true,
        recallRecordingId: true,
        recallRecordingUrl: true,
        recallTranscriptUrl: true,
        lessonTranscript: true,
        lessonSummary: true,
        lessonReportStatus: true,
        lessonReportGeneratedAt: true,
        lessonReportError: true,
      },
    });
    if (!meeting) return res.status(404).json({ error: 'פגישה לא נמצאה' });
    res.json({ data: meeting });
  } catch (error) {
    next(error);
  }
});

// GET /api/lesson-ai/meetings/:meetingId/quiz - read lesson quiz status/link for a meeting
lessonAiRouter.get('/meetings/:meetingId/quiz', managerOrAdmin, async (req, res, next) => {
  try {
    const meetingId = z.string().uuid().parse(req.params.meetingId);
    const quiz = await getMeetingQuiz(meetingId);
    res.json({ data: quiz });
  } catch (error) {
    next(error);
  }
});

// POST /api/lesson-ai/meetings/:meetingId/quiz - generate or regenerate a lesson quiz
lessonAiRouter.post('/meetings/:meetingId/quiz', managerOrAdmin, async (req, res, next) => {
  try {
    const meetingId = z.string().uuid().parse(req.params.meetingId);
    const quiz = await generateLessonQuizForMeeting(meetingId);
    const data = await getMeetingQuiz(quiz.meetingId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// POST /api/lesson-ai/meetings/:meetingId/quiz/send-parent - send the quiz link to the parent via WhatsApp
lessonAiRouter.post('/meetings/:meetingId/quiz/send-parent', managerOrAdmin, async (req, res, next) => {
  try {
    const meetingId = z.string().uuid().parse(req.params.meetingId);
    const result = await sendLessonQuizToParent(meetingId);
    await logAudit({
      userId: (req as any).user?.id,
      userName: (req as any).user?.name || (req as any).user?.email,
      action: 'CREATE',
      entity: 'lesson_quiz_parent_whatsapp',
      entityId: result.quiz.id,
      newValue: {
        meetingId,
        phone: result.phone,
        messageId: result.messageId,
        messagePreview: result.message.slice(0, 200),
      },
      req,
    });
    const data = await getMeetingQuiz(meetingId);
    res.json({ success: true, data, messageId: result.messageId });
  } catch (error: any) {
    if (error.message === 'Quiz not found') return res.status(404).json({ error: 'החידון לא נמצא' });
    if (error.message === 'Parent phone is missing') return res.status(400).json({ error: 'אין טלפון הורה לשליחת החידון' });
    next(error);
  }
});

// GET /api/lesson-ai/logs — admin only
lessonAiRouter.get('/logs', managerOrAdmin, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;

    const [logs, total] = await Promise.all([
      prisma.aiLessonLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.aiLessonLog.count(),
    ]);

    res.json({
      data: logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
});
