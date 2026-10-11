import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { logAudit } from '../utils/audit.js';
import { checkAndSendNegativeProfitAlert } from '../services/negative-profit-alert.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  listCycleExpenses,
  createCycleExpense,
  updateCycleExpense,
  deleteCycleExpense,
  reviewCycleExpense,
} from '../services/cycle-expenses.service.js';

const router = Router();
const prisma = new PrismaClient();

// ========== CYCLE EXPENSES ==========

// Get all expenses for a cycle
router.get('/cycle/:cycleId', authenticate, async (req: Request, res: Response) => {
  try {
    res.json(await listCycleExpenses(req.params.cycleId));
  } catch (error) {
    console.error('Error fetching cycle expenses:', error);
    res.status(500).json({ error: 'Failed to fetch expenses' });
  }
});

// Calculate additional instructor cost for a cycle
router.get('/cycle/:cycleId/calculate-instructor-cost/:instructorId', authenticate, async (req: Request, res: Response) => {
  try {
    const { cycleId, instructorId } = req.params;
    
    // Get cycle details
    const cycle = await prisma.cycle.findUnique({
      where: { id: cycleId },
      select: {
        activityType: true,
        durationMinutes: true,
        totalMeetings: true,
      },
    });
    
    if (!cycle) {
      return res.status(404).json({ error: 'Cycle not found' });
    }
    
    // Get instructor rates
    const instructor = await prisma.instructor.findUnique({
      where: { id: instructorId },
      select: {
        rateFrontal: true,
        rateOnline: true,
        ratePrivate: true,
      },
    });
    
    if (!instructor) {
      return res.status(404).json({ error: 'Instructor not found' });
    }
    
    // Calculate hourly rate based on activity type
    let hourlyRate = 0;
    switch (cycle.activityType) {
      case 'online':
        hourlyRate = Number(instructor.rateOnline || instructor.rateFrontal || 0);
        break;
      case 'private_lesson':
        hourlyRate = Number(instructor.ratePrivate || instructor.rateFrontal || 0);
        break;
      case 'frontal':
      default:
        hourlyRate = Number(instructor.rateFrontal || 0);
        break;
    }
    
    // Calculate total cost: hourlyRate × (duration in hours) × number of meetings
    const costPerMeeting = Math.round(hourlyRate * (cycle.durationMinutes / 60));
    const totalCost = costPerMeeting * cycle.totalMeetings;
    
    res.json({
      hourlyRate,
      costPerMeeting,
      totalCost,
      durationMinutes: cycle.durationMinutes,
      totalMeetings: cycle.totalMeetings,
      activityType: cycle.activityType,
    });
  } catch (error) {
    console.error('Error calculating instructor cost:', error);
    res.status(500).json({ error: 'Failed to calculate cost' });
  }
});

// Cycle expense create / update / delete / review — logic lives in
// services/cycle-expenses.service.ts (shared with /api/v1/cycles/:id/expenses).
const sendServiceError = (res: Response, error: unknown, fallback: string, logLabel: string) => {
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({ error: error.message });
  }
  console.error(logLabel, error);
  return res.status(500).json({ error: fallback });
};

// Create cycle expense (admin only)
router.post('/cycle', authenticate, managerOrAdmin, async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user || (user.role !== 'admin' && user.role !== 'manager')) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    const { cycleId, ...body } = req.body ?? {};
    res.status(201).json(await createCycleExpense(cycleId, body, req));
  } catch (error) {
    sendServiceError(res, error, 'Failed to create expense', 'Error creating cycle expense:');
  }
});

// Update cycle expense
router.put('/cycle/:id', authenticate, managerOrAdmin, async (req: Request, res: Response) => {
  try {
    res.json(await updateCycleExpense(req.params.id, req.body ?? {}, req));
  } catch (error) {
    sendServiceError(res, error, 'Failed to update expense', 'Error updating cycle expense:');
  }
});

// Delete cycle expense (admin only)
router.delete('/cycle/:id', authenticate, managerOrAdmin, async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user || (user.role !== 'admin' && user.role !== 'manager')) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    await deleteCycleExpense(req.params.id, req);
    res.status(204).send();
  } catch (error) {
    sendServiceError(res, error, 'Failed to delete expense', 'Error deleting cycle expense:');
  }
});

// Approve / reject a cycle expense (admin or manager)
router.patch('/cycle/:id/review', authenticate, managerOrAdmin, async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user || (user.role !== 'admin' && user.role !== 'manager')) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    res.json(await reviewCycleExpense(req.params.id, req.body ?? {}, req));
  } catch (error) {
    sendServiceError(res, error, 'Failed to review expense', 'Error reviewing cycle expense:');
  }
});

// ========== MEETING EXPENSES ==========

// Get all expenses for a meeting
router.get('/meeting/:meetingId', authenticate, async (req: Request, res: Response) => {
  try {
    const { meetingId } = req.params;
    
    const expenses = await prisma.meetingExpense.findMany({
      where: { meetingId },
      orderBy: { createdAt: 'desc' },
      include: {
        instructor: {
          select: { id: true, name: true, ratePreparation: true, rateOnline: true, rateFrontal: true, employmentType: true },
        },
      },
    });
    
    res.json(expenses);
  } catch (error) {
    console.error('Error fetching meeting expenses:', error);
    res.status(500).json({ error: 'Failed to fetch expenses' });
  }
});

// Submit meeting expense (auto-approved, calculated for extra_instructor)
router.post('/meeting', authenticate, managerOrAdmin, async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { meetingId, type, description, amount, instructorId, rateType } = req.body;
    
    if (!meetingId || !type) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    let calculatedAmount = amount ? Number(amount) : 0;
    let hours: number | null = null;

    // For extra_instructor, calculate amount based on meeting hours and instructor rate
    if (type === 'extra_instructor' && instructorId) {
      // Get meeting details for hours (calculate from start/end time or use cycle duration)
      const meetingData = await prisma.meeting.findUnique({
        where: { id: meetingId },
        select: { 
          startTime: true, 
          endTime: true,
          cycle: { select: { durationMinutes: true } }
        },
      });
      
      // Get instructor rates
      const instructor = await prisma.instructor.findUnique({
        where: { id: instructorId },
        select: { ratePreparation: true, rateOnline: true, rateFrontal: true, employmentType: true },
      });
      
      if (!meetingData || !instructor) {
        return res.status(404).json({ error: 'Meeting or instructor not found' });
      }
      
      // Calculate hours from meeting times or use cycle duration
      let durationMinutes = meetingData.cycle?.durationMinutes || 60;
      if (meetingData.startTime && meetingData.endTime) {
        const start = new Date(meetingData.startTime);
        const end = new Date(meetingData.endTime);
        durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
      }
      hours = durationMinutes / 60;
      
      // Get rate based on rateType (default: preparation)
      let rate = 0;
      const selectedRateType = rateType || 'preparation';
      switch (selectedRateType) {
        case 'preparation':
          rate = Number(instructor.ratePreparation || 0);
          break;
        case 'online':
          rate = Number(instructor.rateOnline || 0);
          break;
        case 'frontal':
          rate = Number(instructor.rateFrontal || 0);
          break;
      }
      
      calculatedAmount = hours * rate;
      
      // Apply employer cost multiplier (1.3) for employees
      if (instructor.employmentType === 'employee') {
        calculatedAmount = calculatedAmount * 1.3;
      }
    } else if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than 0' });
    }

    const expense = await prisma.meetingExpense.create({
      data: {
        meeting: { connect: { id: meetingId } },
        type,
        description,
        amount: calculatedAmount,
        status: 'approved', // Auto-approved
        submittedBy: { connect: { id: user.userId } },
        ...(instructorId && { instructor: { connect: { id: instructorId } } }),
        rateType: type === 'extra_instructor' ? (rateType || 'preparation') : null,
        hours: hours,
      },
      include: {
        instructor: {
          select: { id: true, name: true, ratePreparation: true, rateOnline: true, rateFrontal: true, employmentType: true },
        },
      },
    });

    await logAudit({ action: 'CREATE', entity: 'MeetingExpense', entityId: expense.id, newValue: { meetingId, type, amount: expense.amount, description }, req });

    // Update meeting profit since expense is auto-approved
    const meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
    });

    if (meeting && meeting.revenue !== null && meeting.instructorPayment !== null) {
      const approvedExpenses = await prisma.meetingExpense.aggregate({
        where: {
          meetingId: meetingId,
          status: 'approved',
        },
        _sum: {
          amount: true,
        },
      });
      const expensesTotal = Number(approvedExpenses._sum.amount || 0);
      const newProfit = Number(meeting.revenue) - Number(meeting.instructorPayment) - expensesTotal;
      await prisma.meeting.update({
        where: { id: meetingId },
        data: { profit: newProfit },
      });
      await checkAndSendNegativeProfitAlert(meetingId, 'meeting-expense-create');
    }

    res.status(201).json(expense);
  } catch (error) {
    console.error('Error creating meeting expense:', error);
    res.status(500).json({ error: 'Failed to create expense' });
  }
});

// Delete meeting expense - also recalculates meeting profit if was approved
router.delete('/meeting/:id', authenticate, managerOrAdmin, async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;
    
    // Get the expense first to check permissions
    const expense = await prisma.meetingExpense.findUnique({
      where: { id },
    });

    if (!expense) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    // Only admin can delete
    const isAdmin = user.role === 'admin' || user.role === 'manager';
    
    if (!isAdmin) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const wasApproved = expense.status === 'approved';
    const meetingId = expense.meetingId;

    await logAudit({ action: 'DELETE', entity: 'MeetingExpense', entityId: id, oldValue: { meetingId: expense.meetingId, type: expense.type, amount: expense.amount }, req });

    await prisma.meetingExpense.delete({
      where: { id },
    });

    // If expense was approved, recalculate meeting profit
    if (wasApproved) {
      const meeting = await prisma.meeting.findUnique({
        where: { id: meetingId },
      });

      if (meeting && meeting.revenue !== null && meeting.instructorPayment !== null) {
        const approvedExpenses = await prisma.meetingExpense.aggregate({
          where: {
            meetingId: meetingId,
            status: 'approved',
          },
          _sum: {
            amount: true,
          },
        });
        const expensesTotal = Number(approvedExpenses._sum.amount || 0);
        const newProfit = Number(meeting.revenue) - Number(meeting.instructorPayment) - expensesTotal;
        await prisma.meeting.update({
          where: { id: meetingId },
          data: { profit: newProfit },
        });
        await checkAndSendNegativeProfitAlert(meetingId, 'meeting-expense-delete');
      }
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting meeting expense:', error);
    res.status(500).json({ error: 'Failed to delete expense' });
  }
});

export default router;
