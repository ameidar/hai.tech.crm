import { Request, Response, NextFunction } from 'express';
import { cyclesService } from '../services/cycles.service.js';
import {
  CycleQuery,
  CreateCycleInput,
  UpdateCycleInput,
  CreateCycleRegistrationInput,
} from '../validators/cycles.js';
import { sendSuccess, sendCreated, sendList, sendNoContent } from '../../../common/utils/response.js';

/**
 * Cycles Controller - Request handlers
 */
export class CyclesController {
  /**
   * GET /cycles - List all cycles
   */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = req.query as unknown as CycleQuery;
      const { cycles, total, limit, offset } = await cyclesService.list(query);
      sendList(res, cycles, { total, limit, offset });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /cycles/:id - Get single cycle
   */
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const cycle = await cyclesService.getById(id);
      sendSuccess(res, cycle);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /cycles - Create cycle
   */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = req.body as CreateCycleInput;
      const cycle = await cyclesService.create(data, req);
      sendCreated(res, cycle);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /cycles/:id - Update cycle
   */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const data = req.body as UpdateCycleInput;
      const cycle = await cyclesService.update(id, data, req);
      sendSuccess(res, cycle);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /cycles/:id - Soft delete cycle
   */
  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await cyclesService.delete(id, req);
      sendNoContent(res);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /cycles/:id/meetings - Get meetings of cycle
   */
  async getMeetings(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const meetings = await cyclesService.getMeetings(id);
      sendSuccess(res, meetings);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /cycles/:id/registrations - Get registrations of cycle
   */
  async getRegistrations(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const registrations = await cyclesService.getRegistrations(id);
      sendSuccess(res, registrations);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /cycles/:id/registrations - Add registration to cycle
   */
  async addRegistration(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const data = req.body as CreateCycleRegistrationInput;
      const registration = await cyclesService.addRegistration(id, data, req);
      sendCreated(res, registration);
    } catch (error) {
      next(error);
    }
  }
}

export const cyclesController = new CyclesController();
