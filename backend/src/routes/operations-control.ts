import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth.js';
import { getOperationsControlToday, updateOperationsControlIssueStatus } from '../services/operations-control.service.js';

export const operationsControlRouter = Router();

const querySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  priority: z.enum(['urgent', 'high', 'normal']).optional(),
  type: z.enum([
    'past_scheduled_meeting',
    'missing_topic',
    'missing_attendance',
    'overdue_task',
    'low_profit',
    'student_absence_risk',
    'instructor_change_risk',
    'cycle_churn_risk',
    'low_enrollment',
  ]).optional(),
});

const issueStatusSchema = z.object({
  status: z.enum(['new', 'in_progress', 'waiting', 'closed']),
  note: z.string().trim().max(1000).optional().nullable(),
  snapshot: z.object({
    title: z.string().optional(),
    type: z.enum([
      'past_scheduled_meeting',
      'missing_topic',
      'missing_attendance',
      'overdue_task',
      'low_profit',
      'student_absence_risk',
      'instructor_change_risk',
      'cycle_churn_risk',
      'low_enrollment',
    ]).optional(),
    priority: z.enum(['urgent', 'high', 'normal']).optional(),
    entityType: z.enum(['meeting', 'cycle', 'task', 'instructor']).optional(),
    entityId: z.string().optional(),
  }).optional(),
});

operationsControlRouter.use(authenticate, authorize('admin', 'manager', 'operations', 'operations_control', 'operations_manager'));

operationsControlRouter.get('/today', async (req, res, next) => {
  try {
    const query = querySchema.parse(req.query);
    const data = await getOperationsControlToday(query);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

operationsControlRouter.patch('/issues/:issueKey/status', async (req, res, next) => {
  try {
    const issueKey = decodeURIComponent(req.params.issueKey);
    const body = issueStatusSchema.parse(req.body);
    const state = await updateOperationsControlIssueStatus({
      issueKey,
      status: body.status,
      note: body.note,
      updatedById: req.user?.userId || null,
      snapshot: body.snapshot,
    });
    res.json({ success: true, state });
  } catch (error) {
    next(error);
  }
});
