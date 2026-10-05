import { Router } from 'express';
import {
  getRevenueReport,
  getInstructorPayments,
  getAttendanceSummary,
  getCycleProgress,
  exportRevenueReport,
  exportInstructorPayments,
  exportCycleProgress,
} from '../controllers/reports.controller.js';
import { authenticate } from '../middleware/auth.js';
import { requireScopeOrRole } from '../middleware/scope-check.js';
import { validateQuery } from '../middleware/validate.js';
import { salaryReportQuerySchema } from '../validators/ops.js';
import { sendSuccess } from '../../../common/utils/response.js';
import { buildInstructorMonthlyReport, getPreviousMonth } from '../../../services/instructorReport.service.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * @route   GET /api/v1/reports/revenue
 * @desc    Get revenue report with breakdown by day/week/month/branch/course/instructor
 * @access  Private (admin, manager)
 * @query   startDate, endDate, groupBy, branchId?, courseId?, instructorId?
 */
router.get('/revenue', getRevenueReport);

/**
 * @route   GET /api/v1/reports/revenue/export
 * @desc    Export revenue report to CSV
 * @access  Private (admin, manager)
 */
router.get('/revenue/export', exportRevenueReport);

/**
 * @route   GET /api/v1/reports/instructor-payments
 * @desc    Get instructor payments report
 * @access  Private (admin, manager)
 * @query   startDate, endDate, instructorId?, status?
 */
router.get('/instructor-payments', getInstructorPayments);

/**
 * @route   GET /api/v1/reports/instructor-payments/export
 * @desc    Export instructor payments to CSV
 * @access  Private (admin, manager)
 */
router.get('/instructor-payments/export', exportInstructorPayments);

/**
 * @route   GET /api/v1/reports/attendance
 * @desc    Get attendance summary report
 * @access  Private (admin, manager)
 * @query   startDate, endDate, cycleId?, branchId?, groupBy?
 */
router.get('/attendance', getAttendanceSummary);

/**
 * @route   GET /api/v1/reports/cycle-progress
 * @desc    Get cycle progress report
 * @access  Private (admin, manager)
 * @query   status?, branchId?, instructorId?
 */
router.get('/cycle-progress', getCycleProgress);

/**
 * @route   GET /api/v1/reports/cycle-progress/export
 * @desc    Export cycle progress to CSV
 * @access  Private (admin, manager)
 */
router.get('/cycle-progress/export', exportCycleProgress);

/**
 * @route   GET /api/v1/reports/instructor-salaries?month=YYYY-MM
 * @desc    Monthly instructor salary report — the same report as the CRM's
 *          /api/reports/instructors (buildInstructorMonthlyReport): per-instructor meetings,
 *          payments (incl. manual overrides), expenses, fixed monthly additions, operations
 *          staff, fixed management salaries and grand totals. Defaults to the previous month.
 * @access  API key with read:salary_reports (explicit-only scope) or admin/manager/operations
 */
router.get(
  '/instructor-salaries',
  requireScopeOrRole('read:salary_reports', ['admin', 'manager', 'operations']),
  validateQuery(salaryReportQuerySchema),
  async (req, res, next) => {
    try {
      const month = (req.query.month as string | undefined) || getPreviousMonth();
      sendSuccess(res, await buildInstructorMonthlyReport(month));
    } catch (error) {
      next(error);
    }
  }
);

export default router;
