/**
 * Lesson AI Routes
 * POST /api/lesson-ai/generate   — generate lesson plan
 * GET  /api/lesson-ai/logs       — admin: view usage logs
 */

import { Router } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { generateLessonPlan } from '../services/lesson-ai.service.js';
import { z } from 'zod';

export const lessonAiRouter = Router();

lessonAiRouter.use(authenticate);

const generateSchema = z.object({
  courseId: z.string().optional(),
  courseName: z.string().min(1),
  ageGroup: z.string().min(1),
  cycleName: z.string().optional(),
  topic: z.string().optional(),
});

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
