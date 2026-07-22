import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth.js';
import { getOperationsControlToday } from '../services/operations-control.service.js';

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
  ]).optional(),
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
