import { NotFoundError, ValidationError } from '../../../common/errors/index.js';
import { studentsRepository, StudentsRepository } from '../repositories/students.repository.js';
import { logAudit } from '../../../utils/audit.js';
import { Request } from 'express';
import { StudentQuery, CreateStudentInput, UpdateStudentInput } from '../validators/students.js';

/**
 * Students Service - Business logic layer
 */
export class StudentsService {
  constructor(private repository: StudentsRepository) {}

  /**
   * List all students with pagination and filters
   */
  async list(query: StudentQuery) {
    const { students, total } = await this.repository.findAll(query);
    return { students, total, limit: query.limit, offset: query.offset };
  }

  /**
   * Get single student by ID
   */
  async getById(id: string) {
    const student = await this.repository.findById(id);
    if (!student) {
      throw new NotFoundError('Student', id);
    }
    return student;
  }

  /**
   * Create new student
   */
  async create(data: CreateStudentInput, req?: Request) {
    // Verify customer exists
    const customerExists = await this.repository.customerExists(data.customerId);
    if (!customerExists) {
      throw new ValidationError('Customer not found', { field: 'customerId' });
    }

    const student = await this.repository.create(data);

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'CREATE',
        entity: 'Student',
        entityId: student.id,
        newValue: { name: student.name, customerId: student.customerId, grade: student.grade },
        req,
      });
    }

    return student;
  }

  /**
   * Update student
   */
  async update(id: string, data: UpdateStudentInput, req?: Request) {
    // Check if student exists
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new NotFoundError('Student', id);
    }

    const student = await this.repository.update(id, data);

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'UPDATE',
        entity: 'Student',
        entityId: student.id,
        oldValue: { name: existing.name, grade: existing.grade },
        newValue: { name: student.name, grade: student.grade },
        req,
      });
    }

    return student;
  }

  /**
   * Soft delete student
   */
  async delete(id: string, req?: Request) {
    // Check if student exists
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new NotFoundError('Student', id);
    }

    await this.repository.softDelete(id, req?.user?.userId);

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'DELETE',
        entity: 'Student',
        entityId: id,
        oldValue: { name: existing.name, customerId: existing.customerId },
        req,
      });
    }
  }

  /**
   * Get registrations of a student
   */
  async getRegistrations(studentId: string) {
    // Check if student exists
    const existing = await this.repository.findById(studentId);
    if (!existing) {
      throw new NotFoundError('Student', studentId);
    }

    return this.repository.getRegistrations(studentId);
  }
}

export const studentsService = new StudentsService(studentsRepository);
