import { Request, Response, NextFunction } from 'express';
import { studentsService } from '../services/students.service.js';
import { StudentQuery, CreateStudentInput, UpdateStudentInput } from '../validators/students.js';
import { sendSuccess, sendCreated, sendList, sendNoContent } from '../../../common/utils/response.js';

/**
 * Students Controller - Request handlers
 */
export class StudentsController {
  /**
   * GET /students - List all students
   */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = req.query as unknown as StudentQuery;
      const { students, total, limit, offset } = await studentsService.list(query);
      sendList(res, students, { total, limit, offset });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /students/:id - Get single student
   */
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const student = await studentsService.getById(id);
      sendSuccess(res, student);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /students - Create student
   */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = req.body as CreateStudentInput;
      const student = await studentsService.create(data, req);
      sendCreated(res, student);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /students/:id - Update student
   */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const data = req.body as UpdateStudentInput;
      const student = await studentsService.update(id, data, req);
      sendSuccess(res, student);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /students/:id - Soft delete student
   */
  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await studentsService.delete(id, req);
      sendNoContent(res);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /students/:id/registrations - Get registrations of student
   */
  async getRegistrations(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const registrations = await studentsService.getRegistrations(id);
      sendSuccess(res, registrations);
    } catch (error) {
      next(error);
    }
  }
}

export const studentsController = new StudentsController();
