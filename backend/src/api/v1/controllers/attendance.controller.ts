import { Request, Response, NextFunction } from 'express';
import { attendanceService } from '../services/attendance.service.js';
import {
  AttendanceQuery,
  CreateAttendanceInput,
  UpdateAttendanceInput,
  BulkAttendanceInput,
} from '../validators/attendance.js';
import { sendSuccess, sendCreated, sendList, sendNoContent } from '../../../common/utils/response.js';

/**
 * Attendance Controller - Request handlers
 */
export class AttendanceController {
  /**
   * GET /attendance - List all attendance records
   */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = req.query as unknown as AttendanceQuery;
      const { attendance, total, limit, offset } = await attendanceService.list(query);
      sendList(res, attendance, { total, limit, offset });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /attendance/:id - Get single attendance record
   */
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const attendance = await attendanceService.getById(id);
      sendSuccess(res, attendance);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /attendance - Create attendance record
   */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = req.body as CreateAttendanceInput;
      const attendance = await attendanceService.create(data, req);
      sendCreated(res, attendance);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /attendance/:id - Update attendance record
   */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const data = req.body as UpdateAttendanceInput;
      const attendance = await attendanceService.update(id, data, req);
      sendSuccess(res, attendance);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /attendance/:id - Delete attendance record
   */
  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await attendanceService.delete(id, req);
      sendNoContent(res);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /attendance/bulk - Bulk create/update attendance
   */
  async bulkUpdate(req: Request, res: Response, next: NextFunction) {
    try {
      const data = req.body as BulkAttendanceInput;
      const results = await attendanceService.bulkUpdate(data, req);
      sendSuccess(res, { count: results.length, records: results });
    } catch (error) {
      next(error);
    }
  }
}

export const attendanceController = new AttendanceController();
