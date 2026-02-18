import { Request, Response, NextFunction } from 'express';
import { customersService } from '../services/customers.service.js';
import { 
  CustomerQuery, 
  CreateCustomerInput, 
  UpdateCustomerInput,
  CreateStudentForCustomerInput 
} from '../validators/customers.js';
import { sendSuccess, sendCreated, sendList, sendNoContent } from '../../../common/utils/response.js';

/**
 * Customers Controller - Request handlers
 */
export class CustomersController {
  /**
   * GET /customers - List all customers
   */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = req.query as unknown as CustomerQuery;
      const { customers, total, limit, offset } = await customersService.list(query);
      sendList(res, customers, { total, limit, offset });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /customers/:id - Get single customer
   */
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const customer = await customersService.getById(id);
      sendSuccess(res, customer);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /customers - Create customer
   */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = req.body as CreateCustomerInput;
      const customer = await customersService.create(data, req);
      sendCreated(res, customer);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /customers/:id - Update customer
   */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const data = req.body as UpdateCustomerInput;
      const customer = await customersService.update(id, data, req);
      sendSuccess(res, customer);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /customers/:id - Soft delete customer
   */
  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await customersService.delete(id, req);
      sendNoContent(res);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /customers/:id/students - Get students of customer
   */
  async getStudents(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const students = await customersService.getStudents(id);
      sendSuccess(res, students);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /customers/:id/students - Add student to customer
   */
  async addStudent(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const data = req.body as CreateStudentForCustomerInput;
      const student = await customersService.addStudent(id, data, req);
      sendCreated(res, student);
    } catch (error) {
      next(error);
    }
  }
}

export const customersController = new CustomersController();
