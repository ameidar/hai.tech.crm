import { Router } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { Decimal } from '@prisma/client/runtime/library';

export const forecastRouter = Router();

forecastRouter.use(authenticate);

// Helper: Calculate standard deviation
function calculateStdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squareDiffs = values.map(value => Math.pow(value - mean, 2));
  const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(avgSquareDiff);
}

// Helper: Convert Decimal to number
function toNumber(val: Decimal | number | null | undefined): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  return Number(val);
}

// Helper: Get month key (YYYY-MM)
function getMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// Helper: Get month name in Hebrew
function getMonthNameHebrew(monthKey: string): string {
  const [year, month] = monthKey.split('-');
  const monthNames = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 
                      'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  return `${monthNames[parseInt(month) - 1]} ${year}`;
}

interface MonthlyData {
  month: string;
  monthName: string;
  revenue: number;
  instructorPayments: number;
  cycleExpenses: number;
  meetingExpenses: number;
  totalExpenses: number;
  profit: number;
  meetingCount: number;
  isHistorical: boolean;
}

interface ExpensePattern {
  cycleId: string;
  cycleName: string;
  type: string;
  description: string | null;
  avgAmount: number;
  frequency: number; // How often this expense appears (0-1)
  months: string[];
}

interface ForecastResult {
  historical: MonthlyData[];
  forecast: MonthlyData[];
  patterns: ExpensePattern[];
  summary: {
    avgMonthlyRevenue: number;
    avgMonthlyExpenses: number;
    avgMonthlyProfit: number;
    revenueStdDev: number;
    expensesStdDev: number;
    profitStdDev: number;
    forecastConfidence: number; // 0-100%
  };
}

// GET /api/forecast
// Returns historical data and forecast for future months
forecastRouter.get('/', managerOrAdmin, async (req, res, next) => {
  try {
    const historicalMonths = parseInt(req.query.historicalMonths as string) || 6;
    const forecastMonths = parseInt(req.query.forecastMonths as string) || 3;

    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    // Calculate date ranges
    const historicalStart = new Date(currentMonth);
    historicalStart.setMonth(historicalStart.getMonth() - historicalMonths);
    
    // Include current month's completed meetings (up to today)
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    // +1 so the last forecast month is fully included (lt: start of month AFTER last forecast month)
    const forecastEnd = new Date(currentMonth);
    forecastEnd.setMonth(forecastEnd.getMonth() + forecastMonths + 1);

    // ============================================
    // HISTORICAL DATA
    // ============================================
    
    // Get completed meetings with expenses (including current month up to today)
    const historicalMeetings = await prisma.meeting.findMany({
      where: {
        scheduledDate: {
          gte: historicalStart,
          lt: tomorrow,
        },
        status: 'completed',
        deletedAt: null,
      },
      include: {
        cycle: {
          select: { id: true, name: true },
        },
        expenses: {
          where: { status: 'approved' },
        },
      },
    });

    // Get cycle expenses for historical period
    const historicalCycleExpenses = await prisma.cycleExpense.findMany({
      where: {
        cycle: {
          meetings: {
            some: {
              scheduledDate: {
                gte: historicalStart,
                lt: tomorrow,
              },
            },
          },
        },
      },
      include: {
        cycle: {
          include: {
            meetings: {
              where: {
                scheduledDate: {
                  gte: historicalStart,
                  lt: tomorrow,
                },
                status: 'completed',
                deletedAt: null,
              },
              select: { id: true, scheduledDate: true },
            },
          },
        },
      },
    });

    // Aggregate historical data by month
    const historicalByMonth: Map<string, MonthlyData> = new Map();
    
    // Initialize months (including current month)
    for (let i = 0; i <= historicalMonths; i++) {
      const monthDate = new Date(currentMonth);
      monthDate.setMonth(monthDate.getMonth() - historicalMonths + i);
      const monthKey = getMonthKey(monthDate);
      historicalByMonth.set(monthKey, {
        month: monthKey,
        monthName: getMonthNameHebrew(monthKey),
        revenue: 0,
        instructorPayments: 0,
        cycleExpenses: 0,
        meetingExpenses: 0,
        totalExpenses: 0,
        profit: 0,
        meetingCount: 0,
        isHistorical: true,
      });
    }

    // Aggregate meeting data
    for (const meeting of historicalMeetings) {
      const monthKey = getMonthKey(new Date(meeting.scheduledDate));
      const data = historicalByMonth.get(monthKey);
      if (data) {
        data.revenue += toNumber(meeting.revenue);
        data.instructorPayments += toNumber(meeting.instructorPayment);
        data.meetingCount += 1;
        
        // Meeting expenses
        for (const expense of meeting.expenses) {
          data.meetingExpenses += toNumber(expense.amount);
        }
      }
    }

    // Distribute cycle expenses across meetings
    for (const cycleExpense of historicalCycleExpenses) {
      const meetingCount = cycleExpense.cycle.meetings.length;
      if (meetingCount === 0) continue;

      let expenseAmount = 0;
      if (cycleExpense.isPercentage && cycleExpense.percentage) {
        // Calculate percentage-based expense from cycle revenue
        // For simplicity, we'll calculate this per-meeting
        continue; // Handle separately if needed
      } else {
        expenseAmount = toNumber(cycleExpense.amount);
      }

      // Distribute equally across meetings in period
      const perMeetingExpense = expenseAmount / meetingCount;
      
      for (const meeting of cycleExpense.cycle.meetings) {
        const monthKey = getMonthKey(new Date(meeting.scheduledDate));
        const data = historicalByMonth.get(monthKey);
        if (data) {
          data.cycleExpenses += perMeetingExpense;
        }
      }
    }

    // Calculate totals and profit
    for (const data of historicalByMonth.values()) {
      data.totalExpenses = data.instructorPayments + data.cycleExpenses + data.meetingExpenses;
      data.profit = data.revenue - data.totalExpenses;
    }

    // ============================================
    // EXPENSE PATTERNS ANALYSIS
    // ============================================
    
    // Analyze meeting expense patterns by cycle
    const expensePatterns: Map<string, ExpensePattern> = new Map();
    
    for (const meeting of historicalMeetings) {
      for (const expense of meeting.expenses) {
        const key = `${meeting.cycle.id}-${expense.type}`;
        const monthKey = getMonthKey(new Date(meeting.scheduledDate));
        
        if (!expensePatterns.has(key)) {
          expensePatterns.set(key, {
            cycleId: meeting.cycle.id,
            cycleName: meeting.cycle.name,
            type: expense.type,
            description: expense.description,
            avgAmount: 0,
            frequency: 0,
            months: [],
          });
        }
        
        const pattern = expensePatterns.get(key)!;
        pattern.avgAmount += toNumber(expense.amount);
        if (!pattern.months.includes(monthKey)) {
          pattern.months.push(monthKey);
        }
      }
    }

    // Calculate frequency and average
    const totalHistoricalMonths = historicalByMonth.size;
    for (const pattern of expensePatterns.values()) {
      const occurrences = pattern.months.length;
      pattern.frequency = occurrences / totalHistoricalMonths;
      // avgAmount is already sum, now divide by occurrences
      pattern.avgAmount = occurrences > 0 ? pattern.avgAmount / occurrences : 0;
    }

    // ============================================
    // BUILD PER-CYCLE REVENUE AVERAGES (for forecast estimation)
    // ============================================
    
    // Calculate avg revenue per completed meeting, per cycle
    const cycleRevenueMap: Map<string, { totalRevenue: number; count: number }> = new Map();
    for (const meeting of historicalMeetings) {
      const rev = toNumber(meeting.revenue);
      if (rev > 0) {
        const existing = cycleRevenueMap.get(meeting.cycleId) || { totalRevenue: 0, count: 0 };
        existing.totalRevenue += rev;
        existing.count += 1;
        cycleRevenueMap.set(meeting.cycleId, existing);
      }
    }
    const cycleAvgRevenue: Map<string, number> = new Map();
    for (const [cycleId, { totalRevenue, count }] of cycleRevenueMap.entries()) {
      cycleAvgRevenue.set(cycleId, count > 0 ? totalRevenue / count : 0);
    }

    // Also calculate avg instructor payment per meeting per cycle
    const cyclePaymentMap: Map<string, { totalPayment: number; count: number }> = new Map();
    for (const meeting of historicalMeetings) {
      const pay = toNumber(meeting.instructorPayment);
      if (pay > 0) {
        const existing = cyclePaymentMap.get(meeting.cycleId) || { totalPayment: 0, count: 0 };
        existing.totalPayment += pay;
        existing.count += 1;
        cyclePaymentMap.set(meeting.cycleId, existing);
      }
    }
    const cycleAvgPayment: Map<string, number> = new Map();
    for (const [cycleId, { totalPayment, count }] of cyclePaymentMap.entries()) {
      cycleAvgPayment.set(cycleId, count > 0 ? totalPayment / count : 0);
    }

    // ============================================
    // FORECAST DATA
    // ============================================
    
    // Next month start (forecast begins after current month)
    const nextMonth = new Date(currentMonth);
    nextMonth.setMonth(nextMonth.getMonth() + 1);

    // Get scheduled future meetings (from next month onwards)
    const futureMeetings = await prisma.meeting.findMany({
      where: {
        scheduledDate: {
          gte: nextMonth,
          lt: forecastEnd,
        },
        status: 'scheduled',
        deletedAt: null,
      },
      include: {
        cycle: {
          include: {
            expenses: true,
          },
        },
        instructor: {
          select: {
            id: true,
            name: true,
            rateFrontal: true,
            rateOnline: true,
            ratePrivate: true,
          },
        },
      },
    });

    // Aggregate forecast by month
    const forecastByMonth: Map<string, MonthlyData> = new Map();
    
    // Initialize forecast months (starting from next month)
    for (let i = 0; i < forecastMonths; i++) {
      const monthDate = new Date(nextMonth);
      monthDate.setMonth(monthDate.getMonth() + i);
      const monthKey = getMonthKey(monthDate);
      forecastByMonth.set(monthKey, {
        month: monthKey,
        monthName: getMonthNameHebrew(monthKey),
        revenue: 0,
        instructorPayments: 0,
        cycleExpenses: 0,
        meetingExpenses: 0,
        totalExpenses: 0,
        profit: 0,
        meetingCount: 0,
        isHistorical: false,
      });
    }

    // Calculate forecast based on actual cycle & instructor data (not statistical averages)
    const globalAvgRevenue = cycleAvgRevenue.size > 0
      ? Array.from(cycleAvgRevenue.values()).reduce((a, b) => a + b, 0) / cycleAvgRevenue.size
      : 0;
    const globalAvgPayment = cycleAvgPayment.size > 0
      ? Array.from(cycleAvgPayment.values()).reduce((a, b) => a + b, 0) / cycleAvgPayment.size
      : 0;

    for (const meeting of futureMeetings) {
      const monthKey = getMonthKey(new Date(meeting.scheduledDate));
      const data = forecastByMonth.get(monthKey);
      if (data) {
        const cycle = meeting.cycle as any;
        const instructor = meeting.instructor as any;
        const activityType = meeting.activityType || cycle.activityType || 'frontal';

        // --- Revenue: use actual if already set, otherwise derive from cycle data ---
        let estimatedRevenue = toNumber(meeting.revenue);
        if (estimatedRevenue === 0) {
          if (toNumber(cycle.meetingRevenue) > 0) {
            // Cycle has a fixed revenue per meeting
            estimatedRevenue = toNumber(cycle.meetingRevenue);
          } else if (toNumber(cycle.pricePerStudent) > 0 && (cycle.studentCount ?? 0) > 0) {
            // Revenue = price per student × number of students
            estimatedRevenue = toNumber(cycle.pricePerStudent) * (cycle.studentCount ?? 0);
          } else {
            // Last resort: historical cycle avg
            estimatedRevenue = cycleAvgRevenue.get(meeting.cycleId) ?? globalAvgRevenue;
          }
        }

        // --- Instructor payment: use actual if set, otherwise use instructor rate ---
        let estimatedPayment = toNumber(meeting.instructorPayment);
        if (estimatedPayment === 0 && instructor) {
          if (activityType === 'online' && toNumber(instructor.rateOnline) > 0) {
            estimatedPayment = toNumber(instructor.rateOnline);
          } else if (activityType === 'private' && toNumber(instructor.ratePrivate) > 0) {
            estimatedPayment = toNumber(instructor.ratePrivate);
          } else if (toNumber(instructor.rateFrontal) > 0) {
            estimatedPayment = toNumber(instructor.rateFrontal);
          } else {
            // Last resort: historical cycle avg
            estimatedPayment = cycleAvgPayment.get(meeting.cycleId) ?? globalAvgPayment;
          }
        }

        data.revenue += estimatedRevenue;
        data.instructorPayments += estimatedPayment;
        data.meetingCount += 1;

        // Apply expense patterns from historical data
        const cyclePatterns = Array.from(expensePatterns.values())
          .filter(p => p.cycleId === meeting.cycle.id);
        
        for (const pattern of cyclePatterns) {
          // Apply pattern based on frequency
          // If expense appeared every month, apply full amount
          // If less frequent, apply proportionally
          data.meetingExpenses += pattern.avgAmount * pattern.frequency;
        }
      }
    }

    // Add cycle-level expenses to forecast
    const forecastCycles = new Set(futureMeetings.map(m => m.cycle.id));
    for (const cycleId of forecastCycles) {
      const cycleMeetings = futureMeetings.filter(m => m.cycle.id === cycleId);
      if (cycleMeetings.length === 0) continue;

      const cycle = cycleMeetings[0].cycle;
      
      for (const cycleExpense of cycle.expenses) {
        let expenseAmount = 0;
        if (cycleExpense.isPercentage && cycleExpense.percentage) {
          // Skip percentage-based for now
          continue;
        } else {
          expenseAmount = toNumber(cycleExpense.amount);
        }

        // Distribute across future meetings
        const perMeetingExpense = expenseAmount / cycleMeetings.length;
        
        for (const meeting of cycleMeetings) {
          const monthKey = getMonthKey(new Date(meeting.scheduledDate));
          const data = forecastByMonth.get(monthKey);
          if (data) {
            data.cycleExpenses += perMeetingExpense;
          }
        }
      }
    }

    // Calculate forecast totals
    for (const data of forecastByMonth.values()) {
      data.totalExpenses = data.instructorPayments + data.cycleExpenses + data.meetingExpenses;
      data.profit = data.revenue - data.totalExpenses;
    }

    // ============================================
    // SUMMARY STATISTICS
    // ============================================
    
    const historicalArray = Array.from(historicalByMonth.values());
    const revenues = historicalArray.map(d => d.revenue);
    const expenses = historicalArray.map(d => d.totalExpenses);
    const profits = historicalArray.map(d => d.profit);

    const avgMonthlyRevenue = revenues.reduce((a, b) => a + b, 0) / revenues.length || 0;
    const avgMonthlyExpenses = expenses.reduce((a, b) => a + b, 0) / expenses.length || 0;
    const avgMonthlyProfit = profits.reduce((a, b) => a + b, 0) / profits.length || 0;

    const revenueStdDev = calculateStdDev(revenues);
    const expensesStdDev = calculateStdDev(expenses);
    const profitStdDev = calculateStdDev(profits);

    // Confidence based on data consistency (lower std dev = higher confidence)
    const avgRevenue = avgMonthlyRevenue || 1;
    const cvRevenue = revenueStdDev / avgRevenue; // Coefficient of variation
    const forecastConfidence = Math.max(0, Math.min(100, 100 - cvRevenue * 100));

    const result: ForecastResult = {
      historical: Array.from(historicalByMonth.values()).sort((a, b) => a.month.localeCompare(b.month)),
      forecast: Array.from(forecastByMonth.values()).sort((a, b) => a.month.localeCompare(b.month)),
      patterns: Array.from(expensePatterns.values())
        .filter(p => p.frequency > 0.3) // Only patterns that appear >30% of months
        .sort((a, b) => b.avgAmount - a.avgAmount),
      summary: {
        avgMonthlyRevenue: Math.round(avgMonthlyRevenue),
        avgMonthlyExpenses: Math.round(avgMonthlyExpenses),
        avgMonthlyProfit: Math.round(avgMonthlyProfit),
        revenueStdDev: Math.round(revenueStdDev),
        expensesStdDev: Math.round(expensesStdDev),
        profitStdDev: Math.round(profitStdDev),
        forecastConfidence: Math.round(forecastConfidence),
      },
    };

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// GET /api/forecast/cycle/:id
// Get detailed forecast for a specific cycle
forecastRouter.get('/cycle/:id', managerOrAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const forecastMonths = parseInt(req.query.forecastMonths as string) || 3;

    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const forecastEnd = new Date(currentMonth);
    forecastEnd.setMonth(forecastEnd.getMonth() + forecastMonths);

    // Get cycle with meetings and expenses
    const cycle = await prisma.cycle.findUnique({
      where: { id },
      include: {
        meetings: {
          where: {
            scheduledDate: { gte: currentMonth, lt: forecastEnd },
            deletedAt: null,
          },
          include: {
            instructor: { select: { id: true, name: true } },
          },
          orderBy: { scheduledDate: 'asc' },
        },
        expenses: true,
        instructor: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        course: { select: { id: true, name: true } },
      },
    });

    if (!cycle) {
      return res.status(404).json({ error: 'מחזור לא נמצא' });
    }

    // Get historical expense patterns for this cycle
    const historicalStart = new Date(currentMonth);
    historicalStart.setMonth(historicalStart.getMonth() - 6);

    const historicalMeetings = await prisma.meeting.findMany({
      where: {
        cycleId: id,
        scheduledDate: { gte: historicalStart, lt: currentMonth },
        status: 'completed',
        deletedAt: null,
      },
      include: {
        expenses: { where: { status: 'approved' } },
      },
    });

    // Calculate average expenses per meeting historically
    let avgMeetingExpenses = 0;
    const expensesByType: Map<string, number[]> = new Map();

    for (const meeting of historicalMeetings) {
      for (const expense of meeting.expenses) {
        const amount = toNumber(expense.amount);
        avgMeetingExpenses += amount;
        
        if (!expensesByType.has(expense.type)) {
          expensesByType.set(expense.type, []);
        }
        expensesByType.get(expense.type)!.push(amount);
      }
    }

    if (historicalMeetings.length > 0) {
      avgMeetingExpenses /= historicalMeetings.length;
    }

    // Calculate cycle expense per meeting
    let cycleExpensePerMeeting = 0;
    for (const expense of cycle.expenses) {
      if (!expense.isPercentage) {
        cycleExpensePerMeeting += toNumber(expense.amount);
      }
    }
    if (cycle.meetings.length > 0) {
      cycleExpensePerMeeting /= cycle.meetings.length;
    }

    // Build forecast
    const meetingsForecast = cycle.meetings.map(meeting => {
      const revenue = toNumber(meeting.revenue);
      const instructorPayment = toNumber(meeting.instructorPayment);
      const estimatedExpenses = avgMeetingExpenses + cycleExpensePerMeeting;
      
      return {
        id: meeting.id,
        date: meeting.scheduledDate,
        instructor: meeting.instructor.name,
        revenue,
        instructorPayment,
        estimatedExpenses,
        estimatedProfit: revenue - instructorPayment - estimatedExpenses,
      };
    });

    // Aggregate by month
    const byMonth: Map<string, any> = new Map();
    for (const meeting of meetingsForecast) {
      const monthKey = getMonthKey(new Date(meeting.date));
      if (!byMonth.has(monthKey)) {
        byMonth.set(monthKey, {
          month: monthKey,
          monthName: getMonthNameHebrew(monthKey),
          revenue: 0,
          instructorPayments: 0,
          estimatedExpenses: 0,
          estimatedProfit: 0,
          meetingCount: 0,
        });
      }
      const data = byMonth.get(monthKey)!;
      data.revenue += meeting.revenue;
      data.instructorPayments += meeting.instructorPayment;
      data.estimatedExpenses += meeting.estimatedExpenses;
      data.estimatedProfit += meeting.estimatedProfit;
      data.meetingCount += 1;
    }

    res.json({
      cycle: {
        id: cycle.id,
        name: cycle.name,
        instructor: cycle.instructor.name,
        branch: cycle.branch.name,
        course: cycle.course.name,
      },
      meetings: meetingsForecast,
      monthly: Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month)),
      expensePatterns: Array.from(expensesByType.entries()).map(([type, amounts]) => ({
        type,
        avgAmount: amounts.reduce((a, b) => a + b, 0) / amounts.length,
        stdDev: calculateStdDev(amounts),
        occurrences: amounts.length,
      })),
    });
  } catch (error) {
    next(error);
  }
});
