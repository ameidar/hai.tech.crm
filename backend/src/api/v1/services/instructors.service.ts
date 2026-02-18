import { NotFoundError, ConflictError } from '../../../common/errors/index.js';
import { instructorsRepository, InstructorsRepository } from '../repositories/instructors.repository.js';
import { logAudit } from '../../../utils/audit.js';
import { Request } from 'express';
import { InstructorQuery, CreateInstructorInput, UpdateInstructorInput, InstructorMeetingsQuery } from '../validators/instructors.js';

/**
 * Instructors Service - Business logic layer
 */
export class InstructorsService {
  constructor(private repository: InstructorsRepository) {}

  /**
   * List all instructors with pagination and filters
   */
  async list(query: InstructorQuery) {
    const { instructors, total } = await this.repository.findAll(query);
    return { instructors, total, limit: query.limit, offset: query.offset };
  }

  /**
   * Get single instructor by ID
   */
  async getById(id: string) {
    const instructor = await this.repository.findById(id);
    if (!instructor) {
      throw new NotFoundError('Instructor', id);
    }
    return instructor;
  }

  /**
   * Create new instructor
   */
  async create(data: CreateInstructorInput, req?: Request) {
    // Check for duplicate phone
    const existingByPhone = await this.repository.findByPhone(data.phone);
    if (existingByPhone) {
      throw new ConflictError(`מדריך עם מספר טלפון ${data.phone} כבר קיים: ${existingByPhone.name}`, {
        existingInstructor: { id: existingByPhone.id, name: existingByPhone.name },
      });
    }

    const instructor = await this.repository.create(data);

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'CREATE',
        entity: 'Instructor',
        entityId: instructor.id,
        newValue: { name: instructor.name, phone: instructor.phone, email: instructor.email },
        req,
      });
    }

    return instructor;
  }

  /**
   * Update instructor
   */
  async update(id: string, data: UpdateInstructorInput, req?: Request) {
    // Check if instructor exists
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new NotFoundError('Instructor', id);
    }

    // Check for duplicate phone if changing
    if (data.phone && data.phone !== existing.phone) {
      const existingByPhone = await this.repository.findByPhone(data.phone);
      if (existingByPhone && existingByPhone.id !== id) {
        throw new ConflictError(`מדריך עם מספר טלפון ${data.phone} כבר קיים: ${existingByPhone.name}`, {
          existingInstructor: { id: existingByPhone.id, name: existingByPhone.name },
        });
      }
    }

    const instructor = await this.repository.update(id, data);

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'UPDATE',
        entity: 'Instructor',
        entityId: instructor.id,
        oldValue: { name: existing.name, isActive: existing.isActive },
        newValue: { name: instructor.name, isActive: instructor.isActive },
        req,
      });
    }

    return instructor;
  }

  /**
   * Delete instructor (only if no cycles)
   */
  async delete(id: string, req?: Request) {
    // Check if instructor exists
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new NotFoundError('Instructor', id);
    }

    // Check for existing cycles
    const hasCycles = await this.repository.hasCycles(id);
    if (hasCycles) {
      throw new ConflictError('Cannot delete instructor with existing cycles. Deactivate instead.', {
        suggestion: 'Set isActive: false',
      });
    }

    await this.repository.delete(id);

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'DELETE',
        entity: 'Instructor',
        entityId: id,
        oldValue: { name: existing.name, phone: existing.phone },
        req,
      });
    }
  }

  /**
   * Get cycles of an instructor
   */
  async getCycles(instructorId: string) {
    // Check if instructor exists
    const existing = await this.repository.findById(instructorId);
    if (!existing) {
      throw new NotFoundError('Instructor', instructorId);
    }

    return this.repository.getCycles(instructorId);
  }

  /**
   * Get meetings of an instructor
   */
  async getMeetings(instructorId: string, query: InstructorMeetingsQuery) {
    // Check if instructor exists
    const existing = await this.repository.findById(instructorId);
    if (!existing) {
      throw new NotFoundError('Instructor', instructorId);
    }

    const { meetings, total } = await this.repository.getMeetings(instructorId, query);
    return { meetings, total, limit: query.limit, offset: query.offset };
  }
}

export const instructorsService = new InstructorsService(instructorsRepository);
