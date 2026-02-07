import { Request, Response, NextFunction } from 'express';
import { branchesService } from '../services/branches.service.js';
import { BranchQuery, CreateBranchInput, UpdateBranchInput } from '../validators/branches.js';
import { sendSuccess, sendCreated, sendList, sendNoContent } from '../../../common/utils/response.js';

/**
 * Branches Controller - Request handlers
 */
export class BranchesController {
  /**
   * GET /branches - List all branches
   */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = req.query as unknown as BranchQuery;
      const { branches, total, limit, offset } = await branchesService.list(query);
      sendList(res, branches, { total, limit, offset });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /branches/:id - Get single branch
   */
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const branch = await branchesService.getById(id);
      sendSuccess(res, branch);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /branches - Create branch
   */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = req.body as CreateBranchInput;
      const branch = await branchesService.create(data, req);
      sendCreated(res, branch);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /branches/:id - Update branch
   */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const data = req.body as UpdateBranchInput;
      const branch = await branchesService.update(id, data, req);
      sendSuccess(res, branch);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /branches/:id - Delete branch
   */
  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await branchesService.delete(id, req);
      sendNoContent(res);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /branches/:id/cycles - Get cycles of branch
   */
  async getCycles(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const cycles = await branchesService.getCycles(id);
      sendSuccess(res, cycles);
    } catch (error) {
      next(error);
    }
  }
}

export const branchesController = new BranchesController();
