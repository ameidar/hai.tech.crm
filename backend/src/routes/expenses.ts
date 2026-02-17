import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth.js';
import { logAudit } from '../utils/audit.js';

const router = Router();
const prisma = new PrismaClient();

// ========== CYCLE EXPENSES ==========

// Get all expenses for a cycle
router.get('/cycle/:cycleId', authenticate, async (req: Request, res: Response) => {
  try {
    const { cycleId } = req.params;
    
    const expenses = await prisma.cycleExpense.findMany({
      where: { cycleId },
      orderBy: { createdAt: 'desc' },
      include: {
        instructor: {
          select: { id: true, name: true, ratePreparation: true, rateOnline: true, rateFrontal: true, employmentType: true },
        },
      },
    });
    
    res.json(expenses);
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

// Create cycle expense (admin only)
router.post('/cycle', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user || (user.role !== 'admin' && user.role !== 'manager')) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const { cycleId, type, description, amount, instructorId, isPercentage, percentage, hours, rateType } = req.body;
    
    // Validate: basic required fields
    if (!cycleId || !type) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    let calculatedAmount = amount ? Number(amount) : null;
    
    // For materials and wraparound_hours, calculate based on hours and rate
    if ((type === 'materials' || type === 'wraparound_hours') && hours && instructorId && rateType) {
      const instructor = await prisma.instructor.findUnique({
        where: { id: instructorId },
        select: { ratePreparation: true, rateOnline: true, rateFrontal: true, employmentType: true },
      });
      
      if (!instructor) {
        return res.status(404).json({ error: 'Instructor not found' });
      }
      
      let rate = 0;
      switch (rateType) {
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
      
      calculatedAmount = Number(hours) * rate;
      
      // Apply employer cost multiplier (1.3) for employees
      if (instructor.employmentType === 'employee') {
        calculatedAmount = calculatedAmount * 1.3;
      }
    } else if (isPercentage) {
      if (!percentage || Number(percentage) <= 0) {
        return res.status(400).json({ error: 'Percentage must be greater than 0' });
      }
      calculatedAmount = null;
    } else if (!calculatedAmount || calculatedAmount <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than 0' });
    }

    const expense = await prisma.cycleExpense.create({
      data: {
        cycle: { connect: { id: cycleId } },
        type,
        description,
        amount: isPercentage ? null : calculatedAmount,
        isPercentage: isPercentage || false,
        percentage: isPercentage ? Number(percentage) : null,
        hours: hours ? Number(hours) : null,
        rateType: rateType || null,
        createdBy: { connect: { id: user.userId } },
        ...(instructorId && { instructor: { connect: { id: instructorId } } }),
      },
      include: {
        instructor: {
          select: { id: true, name: true, ratePreparation: true, rateOnline: true, rateFrontal: true },
        },
      },
    });

    await logAudit({ action: 'CREATE', entity: 'CycleExpense', entityId: expense.id, newValue: { cycleId, type, amount: expense.amount, description }, req });

    res.status(201).json(expense);
  } catch (error) {
    console.error('Error creating cycle expense:', error);
    res.status(500).json({ error: 'Failed to create expense' });
  }
});

// Delete cycle expense (admin only)
router.delete('/cycle/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user || (user.role !== 'admin' && user.role !== 'manager')) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;

    const oldExpense = await prisma.cycleExpense.findUnique({ where: { id } });
    
    await prisma.cycleExpense.delete({
      where: { id },
    });

    if (oldExpense) {
      await logAudit({ action: 'DELETE', entity: 'CycleExpense', entityId: id, oldValue: { cycleId: oldExpense.cycleId, type: oldExpense.type, amount: oldExpense.amount }, req });
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting cycle expense:', error);
    res.status(500).json({ error: 'Failed to delete expense' });
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
router.post('/meeting', authenticate, async (req: Request, res: Response) => {
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
    }

    res.status(201).json(expense);
  } catch (error) {
    console.error('Error creating meeting expense:', error);
    res.status(500).json({ error: 'Failed to create expense' });
  }
});

// Delete meeting expense - also recalculates meeting profit if was approved
router.delete('/meeting/:id', authenticate, async (req: Request, res: Response) => {
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
      }
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting meeting expense:', error);
    res.status(500).json({ error: 'Failed to delete expense' });
  }
});

export default router;
