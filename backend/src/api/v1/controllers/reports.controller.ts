import { Response, NextFunction } from 'express';
import { reportsService } from '../services/reports.service.js';
import { 
  revenueReportSchema, 
  instructorPaymentsSchema, 
  attendanceSummarySchema,
  cycleProgressSchema
} from '../validators/reports.js';
import { sendSuccess } from '../../../common/utils/response.js';
import { ValidationError, ForbiddenError } from '../../../common/errors/index.js';
import { AuthRequest } from '../middleware/auth.js';

/**
 * Get revenue report
 */
export async function getRevenueReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // Only admin and manager can view reports
    if (!['admin', 'manager'].includes(req.user?.role || '')) {
      throw new ForbiddenError('Only administrators and managers can view reports');
    }

    const parsed = revenueReportSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError('Invalid query parameters', parsed.error.errors);
    }

    const report = await reportsService.getRevenueReport(parsed.data);
    return sendSuccess(res, report);
  } catch (error) {
    next(error);
  }
}

/**
 * Get instructor payments report
 */
export async function getInstructorPayments(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!['admin', 'manager'].includes(req.user?.role || '')) {
      throw new ForbiddenError('Only administrators and managers can view reports');
    }

    const parsed = instructorPaymentsSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError('Invalid query parameters', parsed.error.errors);
    }

    const report = await reportsService.getInstructorPayments(parsed.data);
    return sendSuccess(res, report);
  } catch (error) {
    next(error);
  }
}

/**
 * Get attendance summary report
 */
export async function getAttendanceSummary(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!['admin', 'manager'].includes(req.user?.role || '')) {
      throw new ForbiddenError('Only administrators and managers can view reports');
    }

    const parsed = attendanceSummarySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError('Invalid query parameters', parsed.error.errors);
    }

    const report = await reportsService.getAttendanceSummary(parsed.data);
    return sendSuccess(res, report);
  } catch (error) {
    next(error);
  }
}

/**
 * Get cycle progress report
 */
export async function getCycleProgress(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!['admin', 'manager'].includes(req.user?.role || '')) {
      throw new ForbiddenError('Only administrators and managers can view reports');
    }

    const parsed = cycleProgressSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError('Invalid query parameters', parsed.error.errors);
    }

    const report = await reportsService.getCycleProgress(parsed.data);
    return sendSuccess(res, report);
  } catch (error) {
    next(error);
  }
}

/**
 * Export revenue report to CSV
 */
export async function exportRevenueReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!['admin', 'manager'].includes(req.user?.role || '')) {
      throw new ForbiddenError('Only administrators and managers can export reports');
    }

    const parsed = revenueReportSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError('Invalid query parameters', parsed.error.errors);
    }

    const report = await reportsService.getRevenueReport(parsed.data);
    
    const csv = reportsService.exportToCSV(report.breakdown, [
      { key: 'period', label: 'תקופה' },
      { key: 'meetingCount', label: 'מספר פגישות' },
      { key: 'totalRevenue', label: 'הכנסות' },
      { key: 'totalInstructorPayment', label: 'תשלום למדריכים' },
      { key: 'totalProfit', label: 'רווח' },
    ]);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=revenue-report-${parsed.data.startDate}-${parsed.data.endDate}.csv`);
    // Add BOM for Excel Hebrew support
    res.send('\ufeff' + csv);
  } catch (error) {
    next(error);
  }
}

/**
 * Export instructor payments to CSV
 */
export async function exportInstructorPayments(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!['admin', 'manager'].includes(req.user?.role || '')) {
      throw new ForbiddenError('Only administrators and managers can export reports');
    }

    const parsed = instructorPaymentsSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError('Invalid query parameters', parsed.error.errors);
    }

    const report = await reportsService.getInstructorPayments(parsed.data);
    
    // Flatten for CSV export
    const rows = report.instructors.map(i => ({
      instructorName: i.instructorName,
      totalMeetings: i.totalMeetings,
      completedMeetings: i.completedMeetings,
      pendingMeetings: i.pendingMeetings,
      totalPayment: i.totalPayment,
    }));

    const csv = reportsService.exportToCSV(rows, [
      { key: 'instructorName', label: 'שם מדריך' },
      { key: 'totalMeetings', label: 'סה"כ פגישות' },
      { key: 'completedMeetings', label: 'פגישות שהושלמו' },
      { key: 'pendingMeetings', label: 'פגישות עתידיות' },
      { key: 'totalPayment', label: 'סה"כ תשלום' },
    ]);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=instructor-payments-${parsed.data.startDate}-${parsed.data.endDate}.csv`);
    res.send('\ufeff' + csv);
  } catch (error) {
    next(error);
  }
}

/**
 * Export cycle progress to CSV
 */
export async function exportCycleProgress(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!['admin', 'manager'].includes(req.user?.role || '')) {
      throw new ForbiddenError('Only administrators and managers can export reports');
    }

    const parsed = cycleProgressSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError('Invalid query parameters', parsed.error.errors);
    }

    const report = await reportsService.getCycleProgress(parsed.data);
    
    const csv = reportsService.exportToCSV(report.cycles, [
      { key: 'name', label: 'שם מחזור' },
      { key: 'course', label: 'קורס' },
      { key: 'branch', label: 'סניף' },
      { key: 'instructor', label: 'מדריך' },
      { key: 'startDate', label: 'תאריך התחלה' },
      { key: 'endDate', label: 'תאריך סיום' },
      { key: 'totalMeetings', label: 'סה"כ פגישות' },
      { key: 'completedMeetings', label: 'פגישות שהושלמו' },
      { key: 'progressPercent', label: 'התקדמות %' },
      { key: 'studentCount', label: 'מספר תלמידים' },
      { key: 'status', label: 'סטטוס' },
    ]);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=cycle-progress.csv');
    res.send('\ufeff' + csv);
  } catch (error) {
    next(error);
  }
}
