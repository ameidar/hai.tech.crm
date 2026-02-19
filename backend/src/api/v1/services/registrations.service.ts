import { NotFoundError, ConflictError } from '../../../common/errors/index.js';
import { registrationsRepository, RegistrationsRepository } from '../repositories/registrations.repository.js';
import { logAudit } from '../../../utils/audit.js';
import { prisma } from '../../../utils/prisma.js';
import { Request } from 'express';
import {
  RegistrationQuery,
  CreateRegistrationInput,
  UpdateRegistrationInput,
  UpdatePaymentInput,
  CancelRegistrationInput,
} from '../validators/registrations.js';

/**
 * Registrations Service - Business logic layer
 */
export class RegistrationsService {
  constructor(private repository: RegistrationsRepository) {}

  /**
   * List all registrations with pagination and filters
   */
  async list(query: RegistrationQuery) {
    const { registrations, total } = await this.repository.findAll(query);
    return { registrations, total, limit: query.limit, offset: query.offset };
  }

  /**
   * Get single registration by ID
   */
  async getById(id: string) {
    const registration = await this.repository.findById(id);
    if (!registration) {
      throw new NotFoundError('Registration', id);
    }
    return registration;
  }

  /**
   * Create new registration
   */
  async create(data: CreateRegistrationInput, req?: Request) {
    // Verify student exists
    const student = await prisma.student.findUnique({
      where: { id: data.studentId },
    });
    if (!student) {
      throw new NotFoundError('Student', data.studentId);
    }

    // Verify cycle exists
    const cycle = await prisma.cycle.findUnique({
      where: { id: data.cycleId },
    });
    if (!cycle) {
      throw new NotFoundError('Cycle', data.cycleId);
    }

    // Check for duplicate registration
    const existing = await this.repository.findByStudentAndCycle(data.studentId, data.cycleId);
    if (existing) {
      throw new ConflictError('Student is already registered for this cycle');
    }

    const registration = await this.repository.create(data);

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'CREATE',
        entity: 'Registration',
        entityId: registration.id,
        newValue: {
          studentId: data.studentId,
          cycleId: data.cycleId,
          status: registration.status,
        },
        req,
      });
    }

    return registration;
  }

  /**
   * Update registration
   */
  async update(id: string, data: UpdateRegistrationInput, req?: Request) {
    // Check if registration exists
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new NotFoundError('Registration', id);
    }

    const registration = await this.repository.update(id, data);

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'UPDATE',
        entity: 'Registration',
        entityId: registration.id,
        oldValue: { status: existing.status, paymentStatus: existing.paymentStatus },
        newValue: { status: registration.status, paymentStatus: registration.paymentStatus },
        req,
      });
    }

    return registration;
  }

  /**
   * Soft delete registration
   */
  async delete(id: string, req?: Request) {
    // Check if registration exists
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new NotFoundError('Registration', id);
    }

    await this.repository.softDelete(id, req?.user?.userId);

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'DELETE',
        entity: 'Registration',
        entityId: id,
        oldValue: {
          studentId: existing.studentId,
          cycleId: existing.cycleId,
          status: existing.status,
        },
        req,
      });
    }
  }

  /**
   * Get attendance records for a registration
   */
  async getAttendance(registrationId: string) {
    // Check if registration exists
    const existing = await this.repository.findById(registrationId);
    if (!existing) {
      throw new NotFoundError('Registration', registrationId);
    }

    return this.repository.getAttendance(registrationId);
  }

  /**
   * Cancel registration
   */
  async cancel(id: string, data: CancelRegistrationInput, req?: Request) {
    // Check if registration exists
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new NotFoundError('Registration', id);
    }

    const registration = await this.repository.cancel(id, data.reason);

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'UPDATE',
        entity: 'Registration',
        entityId: registration.id,
        oldValue: { status: existing.status },
        newValue: { status: 'cancelled', cancellationReason: data.reason },
        req,
      });
    }

    return registration;
  }

  /**
   * Update payment status
   */
  async updatePayment(id: string, data: UpdatePaymentInput, req?: Request) {
    // Check if registration exists
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new NotFoundError('Registration', id);
    }

    const registration = await this.repository.updatePayment(
      id,
      data.paymentStatus,
      data.paymentMethod,
      data.amount,
      data.invoiceLink
    );

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'UPDATE',
        entity: 'Registration',
        entityId: registration.id,
        oldValue: { paymentStatus: existing.paymentStatus, amount: existing.amount },
        newValue: { paymentStatus: data.paymentStatus, amount: data.amount },
        req,
      });
    }

    return registration;
  }
}

export const registrationsService = new RegistrationsService(registrationsRepository);
