import { NotFoundError, ConflictError } from '../../../common/errors/index.js';
import { customersRepository, CustomersRepository } from '../repositories/customers.repository.js';
import { logAudit } from '../../../utils/audit.js';
import { Request } from 'express';
import { 
  CustomerQuery, 
  CreateCustomerInput, 
  UpdateCustomerInput, 
  CreateStudentForCustomerInput 
} from '../validators/customers.js';

/**
 * Customers Service - Business logic layer
 */
export class CustomersService {
  constructor(private repository: CustomersRepository) {}

  /**
   * List all customers with pagination and filters
   */
  async list(query: CustomerQuery) {
    const { customers, total } = await this.repository.findAll(query);
    return { customers, total, limit: query.limit, offset: query.offset };
  }

  /**
   * Get single customer by ID
   */
  async getById(id: string) {
    const customer = await this.repository.findById(id);
    if (!customer) {
      throw new NotFoundError('Customer', id);
    }
    return customer;
  }

  /**
   * Create new customer
   */
  async create(data: CreateCustomerInput, req?: Request) {
    // Check for duplicate phone
    const existingByPhone = await this.repository.findByPhone(data.phone);
    if (existingByPhone) {
      throw new ConflictError(`לקוח עם מספר טלפון ${data.phone} כבר קיים: ${existingByPhone.name}`, {
        existingCustomer: existingByPhone,
      });
    }

    // Check for duplicate email (only if provided)
    if (data.email) {
      const existingByEmail = await this.repository.findByEmail(data.email);
      if (existingByEmail) {
        throw new ConflictError(`לקוח עם כתובת מייל ${data.email} כבר קיים: ${existingByEmail.name}`, {
          existingCustomer: existingByEmail,
        });
      }
    }

    const customer = await this.repository.create(data);

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'CREATE',
        entity: 'Customer',
        entityId: customer.id,
        newValue: { name: customer.name, phone: customer.phone, email: customer.email },
        req,
      });
    }

    return customer;
  }

  /**
   * Update customer
   */
  async update(id: string, data: UpdateCustomerInput, req?: Request) {
    // Check if customer exists
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new NotFoundError('Customer', id);
    }

    // Check for duplicate phone if being changed
    if (data.phone && data.phone !== existing.phone) {
      const existingByPhone = await this.repository.findByPhone(data.phone);
      if (existingByPhone && existingByPhone.id !== id) {
        throw new ConflictError(`לקוח עם מספר טלפון ${data.phone} כבר קיים: ${existingByPhone.name}`, {
          existingCustomer: existingByPhone,
        });
      }
    }

    // Check for duplicate email if being changed
    if (data.email && data.email !== existing.email) {
      const existingByEmail = await this.repository.findByEmail(data.email);
      if (existingByEmail && existingByEmail.id !== id) {
        throw new ConflictError(`לקוח עם כתובת מייל ${data.email} כבר קיים: ${existingByEmail.name}`, {
          existingCustomer: existingByEmail,
        });
      }
    }

    const customer = await this.repository.update(id, data);

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'UPDATE',
        entity: 'Customer',
        entityId: customer.id,
        oldValue: { name: existing.name, phone: existing.phone, email: existing.email },
        newValue: { name: customer.name, phone: customer.phone, email: customer.email },
        req,
      });
    }

    return customer;
  }

  /**
   * Soft delete customer
   */
  async delete(id: string, req?: Request) {
    // Check if customer exists
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new NotFoundError('Customer', id);
    }

    await this.repository.softDelete(id, req?.user?.userId);

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'DELETE',
        entity: 'Customer',
        entityId: id,
        oldValue: { name: existing.name, phone: existing.phone, email: existing.email },
        req,
      });
    }
  }

  /**
   * Get students of a customer
   */
  async getStudents(customerId: string) {
    // Check if customer exists
    const existing = await this.repository.findById(customerId);
    if (!existing) {
      throw new NotFoundError('Customer', customerId);
    }

    return this.repository.getStudents(customerId);
  }

  /**
   * Add student to customer
   */
  async addStudent(customerId: string, data: CreateStudentForCustomerInput, req?: Request) {
    // Check if customer exists
    const existing = await this.repository.findById(customerId);
    if (!existing) {
      throw new NotFoundError('Customer', customerId);
    }

    const student = await this.repository.addStudent(customerId, data);

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'CREATE',
        entity: 'Student',
        entityId: student.id,
        newValue: { name: student.name, customerId, grade: student.grade },
        req,
      });
    }

    return student;
  }
}

export const customersService = new CustomersService(customersRepository);
