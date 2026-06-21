import { Router } from 'express';
import { z } from 'zod';
import { Prisma, TaskPriority, TaskStatus, UserRole } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { config } from '../config.js';
import { sendWhatsApp } from '../services/messaging.js';
import { sendEmail } from '../services/email/sender.js';
import { rebuildTaskReminders } from '../services/task-reminders.js';

export const tasksRouter = Router();

tasksRouter.use(authenticate);

const visibleToAllRoles: UserRole[] = ['admin', 'manager', 'operations'];

const taskInclude = {
  createdBy: { select: { id: true, name: true, email: true, phone: true, role: true } },
  assignee: { select: { id: true, name: true, email: true, phone: true, role: true } },
  completedBy: { select: { id: true, name: true, email: true, role: true } },
} satisfies Prisma.TaskInclude;

const createTaskSchema = z.object({
  title: z.string().trim().min(2, 'כותרת המשימה היא שדה חובה'),
  description: z.string().trim().optional().nullable(),
  status: z.nativeEnum(TaskStatus).optional(),
  priority: z.nativeEnum(TaskPriority).optional(),
  dueDate: z.string().datetime().optional().nullable(),
  assigneeId: z.string().uuid().optional().nullable(),
});

const updateTaskSchema = z.object({
  title: z.string().trim().min(2).optional(),
  description: z.string().trim().optional().nullable(),
  status: z.nativeEnum(TaskStatus).optional(),
  priority: z.nativeEnum(TaskPriority).optional(),
  dueDate: z.string().datetime().optional().nullable(),
  assigneeId: z.string().uuid().optional().nullable(),
});

function canSeeAll(role: UserRole) {
  return visibleToAllRoles.includes(role);
}

function canModifyTask(task: { createdById: string; assigneeId: string | null }, user: Express.Request['user']) {
  if (!user) return false;
  return canSeeAll(user.role) || task.createdById === user.userId || task.assigneeId === user.userId;
}

async function assertActiveAssignee(assigneeId?: string | null) {
  if (!assigneeId) return;
  const assignee = await prisma.user.findFirst({
    where: { id: assigneeId, isActive: true },
    select: { id: true },
  });
  if (!assignee) {
    throw new AppError(400, 'המשתמש שהוקצה למשימה לא נמצא או אינו פעיל');
  }
}

function taskUrl(id: string) {
  const base = config.frontendUrl && config.frontendUrl !== '*' ? config.frontendUrl : 'https://crm.orma-ai.com';
  return `${base}/tasks?task=${id}`;
}

async function notifyAssignment(taskId: string, previousAssigneeId?: string | null) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: taskInclude,
  });
  if (!task?.assignee || task.assigneeId === previousAssigneeId) return;

  const due = task.dueDate ? new Date(task.dueDate).toLocaleDateString('he-IL') : 'לא נקבע';
  const message = [
    `הוקצתה לך משימה חדשה ב-HaiTech CRM: ${task.title}`,
    `עדיפות: ${priorityLabels[task.priority]}`,
    `יעד: ${due}`,
    taskUrl(task.id),
  ].join('\n');

  if (task.assignee.phone) {
    sendWhatsApp({ phone: task.assignee.phone, message }).catch((error) => {
      console.error('[Tasks] failed to send WhatsApp assignment notification:', error);
    });
  }

  if (task.assignee.email) {
    sendEmail({
      to: task.assignee.email,
      subject: `משימה חדשה: ${task.title}`,
      text: message,
      html: `<div dir="rtl" style="font-family: Arial, sans-serif; line-height: 1.6;">
        <h2>הוקצתה לך משימה חדשה</h2>
        <p><strong>${escapeHtml(task.title)}</strong></p>
        <p>עדיפות: ${priorityLabels[task.priority]}</p>
        <p>יעד: ${due}</p>
        <p><a href="${taskUrl(task.id)}">פתיחת המשימה ב-CRM</a></p>
      </div>`,
    }).catch((error) => {
      console.error('[Tasks] failed to send email assignment notification:', error);
    });
  }
}

async function notifyCompletion(taskId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: taskInclude,
  });
  if (!task || task.createdById === task.completedById || !task.createdBy.email) return;

  const message = `המשימה "${task.title}" הושלמה על ידי ${task.completedBy?.name || 'משתמש במערכת'}.\n${taskUrl(task.id)}`;
  sendEmail({
    to: task.createdBy.email,
    subject: `משימה הושלמה: ${task.title}`,
    text: message,
    html: `<div dir="rtl" style="font-family: Arial, sans-serif; line-height: 1.6;">
      <h2>משימה הושלמה</h2>
      <p>המשימה <strong>${escapeHtml(task.title)}</strong> הושלמה על ידי ${escapeHtml(task.completedBy?.name || 'משתמש במערכת')}.</p>
      <p><a href="${taskUrl(task.id)}">פתיחת המשימה ב-CRM</a></p>
    </div>`,
  }).catch((error) => {
    console.error('[Tasks] failed to send completion email:', error);
  });
}

const priorityLabels: Record<TaskPriority, string> = {
  low: 'נמוכה',
  normal: 'רגילה',
  high: 'גבוהה',
  urgent: 'דחופה',
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string
  ));
}

function parseDate(value?: string | null) {
  if (!value) return null;
  return new Date(value);
}

// GET /api/tasks/users - assignable users
tasksRouter.get('/users', async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, email: true, phone: true, role: true },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
    res.json(users);
  } catch (error) {
    next(error);
  }
});

// GET /api/tasks
tasksRouter.get('/', async (req, res, next) => {
  try {
    const {
      status,
      priority,
      assigneeId,
      createdById,
      search,
      dueFrom,
      dueTo,
    } = req.query;

    const where: Prisma.TaskWhereInput = { deletedAt: null };

    if (!canSeeAll(req.user!.role)) {
      where.OR = [{ assigneeId: req.user!.userId }, { createdById: req.user!.userId }];
    }

    if (typeof status === 'string' && status) where.status = status as TaskStatus;
    if (typeof priority === 'string' && priority) where.priority = priority as TaskPriority;
    if (typeof assigneeId === 'string' && assigneeId) where.assigneeId = assigneeId;
    if (typeof createdById === 'string' && createdById) where.createdById = createdById;
    if (typeof search === 'string' && search.trim()) {
      const term = search.trim();
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : []),
        {
          OR: [
            { title: { contains: term, mode: 'insensitive' } },
            { description: { contains: term, mode: 'insensitive' } },
          ],
        },
      ];
    }
    if (typeof dueFrom === 'string' || typeof dueTo === 'string') {
      where.dueDate = {};
      if (typeof dueFrom === 'string' && dueFrom) where.dueDate.gte = new Date(dueFrom);
      if (typeof dueTo === 'string' && dueTo) where.dueDate.lte = new Date(dueTo);
    }

    const tasks = await prisma.task.findMany({
      where,
      include: taskInclude,
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
    });

    res.json(tasks);
  } catch (error) {
    next(error);
  }
});

// GET /api/tasks/:id
tasksRouter.get('/:id', async (req, res, next) => {
  try {
    const task = await prisma.task.findFirst({
      where: { id: req.params.id, deletedAt: null },
      include: taskInclude,
    });
    if (!task) throw new AppError(404, 'משימה לא נמצאה');
    if (!canSeeAll(req.user!.role) && task.createdById !== req.user!.userId && task.assigneeId !== req.user!.userId) {
      throw new AppError(403, 'אין הרשאה לצפות במשימה זו');
    }
    res.json(task);
  } catch (error) {
    next(error);
  }
});

// POST /api/tasks
tasksRouter.post('/', async (req, res, next) => {
  try {
    const data = createTaskSchema.parse(req.body);
    await assertActiveAssignee(data.assigneeId);

    const task = await prisma.task.create({
      data: {
        title: data.title,
        description: data.description || null,
        status: data.status || 'new',
        priority: data.priority || 'normal',
        dueDate: parseDate(data.dueDate),
        createdById: req.user!.userId,
        assigneeId: data.assigneeId || null,
        ...(data.status === 'completed' && {
          completedAt: new Date(),
          completedById: req.user!.userId,
        }),
      },
      include: taskInclude,
    });

    notifyAssignment(task.id).catch(() => {});
    rebuildTaskReminders(task.id).catch((error) => {
      console.error('[Tasks] failed to rebuild reminders:', error);
    });
    if (task.status === 'completed') notifyCompletion(task.id).catch(() => {});
    res.status(201).json(task);
  } catch (error) {
    next(error);
  }
});

// PATCH /api/tasks/:id
tasksRouter.patch('/:id', async (req, res, next) => {
  try {
    const data = updateTaskSchema.parse(req.body);
    await assertActiveAssignee(data.assigneeId);

    const existing = await prisma.task.findFirst({
      where: { id: req.params.id, deletedAt: null },
    });
    if (!existing) throw new AppError(404, 'משימה לא נמצאה');
    if (!canModifyTask(existing, req.user)) throw new AppError(403, 'אין הרשאה לערוך משימה זו');

    const isCompleting = data.status === 'completed' && existing.status !== 'completed';
    const isReopening = data.status && data.status !== 'completed' && existing.status === 'completed';

    const task = await prisma.task.update({
      where: { id: existing.id },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.description !== undefined && { description: data.description || null }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.priority !== undefined && { priority: data.priority }),
        ...(data.dueDate !== undefined && { dueDate: parseDate(data.dueDate) }),
        ...(data.assigneeId !== undefined && { assigneeId: data.assigneeId || null }),
        ...(isCompleting && { completedAt: new Date(), completedById: req.user!.userId }),
        ...(isReopening && { completedAt: null, completedById: null }),
      },
      include: taskInclude,
    });

    notifyAssignment(task.id, existing.assigneeId).catch(() => {});
    rebuildTaskReminders(task.id).catch((error) => {
      console.error('[Tasks] failed to rebuild reminders:', error);
    });
    if (isCompleting) notifyCompletion(task.id).catch(() => {});
    res.json(task);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/tasks/:id
tasksRouter.delete('/:id', async (req, res, next) => {
  try {
    if (!canSeeAll(req.user!.role)) throw new AppError(403, 'אין הרשאה למחוק משימות');
    const task = await prisma.task.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!task) throw new AppError(404, 'משימה לא נמצאה');

    await prisma.task.update({
      where: { id: task.id },
      data: { deletedAt: new Date() },
    });
    await prisma.taskReminder.deleteMany({
      where: { taskId: task.id, status: 'pending' },
    });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
