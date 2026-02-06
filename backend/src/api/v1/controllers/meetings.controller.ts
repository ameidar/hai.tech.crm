import { Request, Response, NextFunction } from 'express';
import { meetingsService } from '../services/meetings.service.js';
import {
  MeetingQuery,
  CreateMeetingInput,
  UpdateMeetingInput,
  PostponeMeetingInput,
  BulkRecalculateMeetingsInput,
  BulkUpdateMeetingStatusInput,
  BulkDeleteMeetingsInput,
  CompleteMeetingInput,
  CancelMeetingInput,
} from '../validators/meetings.js';
import { BulkAttendanceInput } from '../validators/attendance.js';
import { sendSuccess, sendCreated, sendList, sendNoContent } from '../../../common/utils/response.js';

/**
 * Meetings Controller - Request handlers
 */
export class MeetingsController {
  /**
   * GET /meetings - List all meetings
   */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = req.query as unknown as MeetingQuery;
      const { meetings, total, limit, offset } = await meetingsService.list(query);
      sendList(res, meetings, { total, limit, offset });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /meetings/:id - Get single meeting
   */
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const meeting = await meetingsService.getById(id);
      sendSuccess(res, meeting);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /meetings - Create meeting
   */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = req.body as CreateMeetingInput;
      const meeting = await meetingsService.create(data, req);
      sendCreated(res, meeting);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /meetings/:id - Update meeting
   */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const data = req.body as UpdateMeetingInput;
      const meeting = await meetingsService.update(id, data, req);
      sendSuccess(res, meeting);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /meetings/:id - Soft delete meeting
   */
  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await meetingsService.delete(id, req);
      sendNoContent(res);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /meetings/:id/attendance - Get attendance of meeting
   */
  async getAttendance(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const attendance = await meetingsService.getAttendance(id);
      sendSuccess(res, attendance);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /meetings/:id/postpone - Postpone meeting
   */
  async postpone(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const data = req.body as PostponeMeetingInput;
      const result = await meetingsService.postpone(id, data, req);
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /meetings/:id/complete - Complete a meeting
   */
  async complete(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const data = (req.body || {}) as CompleteMeetingInput;
      const meeting = await meetingsService.complete(id, data, req);
      sendSuccess(res, meeting);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /meetings/:id/cancel - Cancel a meeting
   */
  async cancel(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const data = (req.body || {}) as CancelMeetingInput;
      const meeting = await meetingsService.cancel(id, data, req);
      sendSuccess(res, meeting);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /meetings/:id/recalculate - Recalculate meeting financials
   */
  async recalculate(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const meeting = await meetingsService.recalculate(id, req);
      sendSuccess(res, meeting);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /meetings/bulk-recalculate - Bulk recalculate meetings
   */
  async bulkRecalculate(req: Request, res: Response, next: NextFunction) {
    try {
      const data = req.body as BulkRecalculateMeetingsInput;
      const result = await meetingsService.bulkRecalculate(data, req);
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /meetings/bulk-update-status - Bulk update meeting status
   */
  async bulkUpdateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const data = req.body as BulkUpdateMeetingStatusInput;
      const result = await meetingsService.bulkUpdateStatus(data, req);
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /meetings/bulk-delete - Bulk delete meetings
   */
  async bulkDelete(req: Request, res: Response, next: NextFunction) {
    try {
      const data = req.body as BulkDeleteMeetingsInput;
      const result = await meetingsService.bulkDelete(data, req);
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /meetings/:id/attendance/bulk - Bulk record attendance
   */
  async bulkRecordAttendance(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const data = req.body as BulkAttendanceInput;
      const result = await meetingsService.bulkRecordAttendance(id, data.records, req);
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  }
}

export const meetingsController = new MeetingsController();
