import { Request, Response, NextFunction } from 'express';
import { coursesService } from '../services/courses.service.js';
import { CourseQuery, CreateCourseInput, UpdateCourseInput } from '../validators/courses.js';
import { sendSuccess, sendCreated, sendList, sendNoContent } from '../../../common/utils/response.js';

/**
 * Courses Controller - Request handlers
 */
export class CoursesController {
  /**
   * GET /courses - List all courses
   */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = req.query as unknown as CourseQuery;
      const { courses, total, limit, offset } = await coursesService.list(query);
      sendList(res, courses, { total, limit, offset });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /courses/:id - Get single course
   */
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const course = await coursesService.getById(id);
      sendSuccess(res, course);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /courses - Create course
   */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = req.body as CreateCourseInput;
      const course = await coursesService.create(data, req);
      sendCreated(res, course);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /courses/:id - Update course
   */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const data = req.body as UpdateCourseInput;
      const course = await coursesService.update(id, data, req);
      sendSuccess(res, course);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /courses/:id - Delete course
   */
  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await coursesService.delete(id, req);
      sendNoContent(res);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /courses/:id/cycles - Get cycles of course
   */
  async getCycles(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const cycles = await coursesService.getCycles(id);
      sendSuccess(res, cycles);
    } catch (error) {
      next(error);
    }
  }
}

export const coursesController = new CoursesController();
