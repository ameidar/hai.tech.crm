import { Request, Response, NextFunction } from 'express';
import { registrationsService } from '../services/registrations.service.js';
import {
  RegistrationQuery,
  CreateRegistrationInput,
  UpdateRegistrationInput,
  UpdatePaymentInput,
  CancelRegistrationInput,
} from '../validators/registrations.js';
import { sendSuccess, sendCreated, sendList, sendNoContent } from '../../../common/utils/response.js';

/**
 * Registrations Controller - Request handlers
 */
export class RegistrationsController {
  /**
   * GET /registrations - List all registrations
   */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = req.query as unknown as RegistrationQuery;
      const { registrations, total, limit, offset } = await registrationsService.list(query);
      sendList(res, registrations, { total, limit, offset });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /registrations/:id - Get single registration
   */
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const registration = await registrationsService.getById(id);
      sendSuccess(res, registration);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /registrations - Create registration
   */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = req.body as CreateRegistrationInput;
      const registration = await registrationsService.create(data, req);
      sendCreated(res, registration);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /registrations/:id - Update registration
   */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const data = req.body as UpdateRegistrationInput;
      const registration = await registrationsService.update(id, data, req);
      sendSuccess(res, registration);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /registrations/:id - Soft delete registration
   */
  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await registrationsService.delete(id, req);
      sendNoContent(res);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /registrations/:id/attendance - Get attendance of registration
   */
  async getAttendance(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const attendance = await registrationsService.getAttendance(id);
      sendSuccess(res, attendance);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /registrations/:id/cancel - Cancel registration
   */
  async cancel(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const data = req.body as CancelRegistrationInput;
      const registration = await registrationsService.cancel(id, data, req);
      sendSuccess(res, registration);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /registrations/:id/payment - Update payment status
   */
  async updatePayment(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const data = req.body as UpdatePaymentInput;
      const registration = await registrationsService.updatePayment(id, data, req);
      sendSuccess(res, registration);
    } catch (error) {
      next(error);
    }
  }
}

export const registrationsController = new RegistrationsController();
