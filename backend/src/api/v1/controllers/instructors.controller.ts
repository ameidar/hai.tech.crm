import { Request, Response, NextFunction } from 'express';
import { instructorsService } from '../services/instructors.service.js';
import { InstructorQuery, CreateInstructorInput, UpdateInstructorInput, InstructorMeetingsQuery } from '../validators/instructors.js';
import { sendSuccess, sendCreated, sendList, sendNoContent } from '../../../common/utils/response.js';

/**
 * Instructors Controller - Request handlers
 */
export class InstructorsController {
  /**
   * GET /instructors - List all instructors
   */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = req.query as unknown as InstructorQuery;
      const { instructors, total, limit, offset } = await instructorsService.list(query);
      sendList(res, instructors, { total, limit, offset });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /instructors/:id - Get single instructor
   */
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const instructor = await instructorsService.getById(id);
      sendSuccess(res, instructor);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /instructors - Create instructor
   */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = req.body as CreateInstructorInput;
      const instructor = await instructorsService.create(data, req);
      sendCreated(res, instructor);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /instructors/:id - Update instructor
   */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const data = req.body as UpdateInstructorInput;
      const instructor = await instructorsService.update(id, data, req);
      sendSuccess(res, instructor);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /instructors/:id - Delete instructor
   */
  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await instructorsService.delete(id, req);
      sendNoContent(res);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /instructors/:id/cycles - Get cycles of instructor
   */
  async getCycles(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const cycles = await instructorsService.getCycles(id);
      sendSuccess(res, cycles);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /instructors/:id/meetings - Get meetings of instructor
   */
  async getMeetings(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const query = req.query as unknown as InstructorMeetingsQuery;
      const { meetings, total, limit, offset } = await instructorsService.getMeetings(id, query);
      sendList(res, meetings, { total, limit, offset });
    } catch (error) {
      next(error);
    }
  }
}

export const instructorsController = new InstructorsController();
