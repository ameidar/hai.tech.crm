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

export default router;
