import { NotFoundError, ConflictError } from '../../../common/errors/index.js';
import { cyclesRepository, CyclesRepository } from '../repositories/cycles.repository.js';
import { logAudit } from '../../../utils/audit.js';
import { prisma } from '../../../utils/prisma.js';
import { Request } from 'express';
import {
  CycleQuery,
  CreateCycleInput,
  UpdateCycleInput,
  CreateCycleRegistrationInput,
} from '../validators/cycles.js';

/**
 * Cycles Service - Business logic layer
 */
export class CyclesService {
  constructor(private repository: CyclesRepository) {}

  /**
   * List all cycles with pagination and filters
   */
  async list(query: CycleQuery) {
    const { cycles, total } = await this.repository.findAll(query);
    return { cycles, total, limit: query.limit, offset: query.offset };
  }

  /**
   * Get single cycle by ID
   */
  async getById(id: string) {
    const cycle = await this.repository.findByIdWithDetails(id);
    if (!cycle) {
      throw new NotFoundError('Cycle', id);
    }
    return cycle;
  }

  /**
   * Create new cycle
   */
  async create(data: CreateCycleInput, req?: Request) {
    // Verify all foreign keys exist
    const [course, branch, instructor] = await Promise.all([
      prisma.course.findUnique({ where: { id: data.courseId } }),
      prisma.branch.findUnique({ where: { id: data.branchId } }),
      prisma.instructor.findUnique({ where: { id: data.instructorId } }),
    ]);

    if (!course) throw new NotFoundError('Course', data.courseId);
    if (!branch) throw new NotFoundError('Branch', data.branchId);
    if (!instructor) throw new NotFoundError('Instructor', data.instructorId);

    if (data.institutionalOrderId) {
      const order = await prisma.institutionalOrder.findUnique({
        where: { id: data.institutionalOrderId },
      });
      if (!order) throw new NotFoundError('InstitutionalOrder', data.institutionalOrderId);
    }

    const cycle = await this.repository.create(data);

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'CREATE',
        entity: 'Cycle',
        entityId: cycle.id,
        newValue: { name: cycle.name, courseId: data.courseId, branchId: data.branchId },
        req,
      });
    }

    return cycle;
  }

  /**
   * Update cycle
   */
  async update(id: string, data: UpdateCycleInput, req?: Request) {
    // Check if cycle exists
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new NotFoundError('Cycle', id);
    }

    // Verify foreign keys if being changed
    if (data.courseId && data.courseId !== existing.courseId) {
      const course = await prisma.course.findUnique({ where: { id: data.courseId } });
      if (!course) throw new NotFoundError('Course', data.courseId);
    }

    if (data.branchId && data.branchId !== existing.branchId) {
      const branch = await prisma.branch.findUnique({ where: { id: data.branchId } });
      if (!branch) throw new NotFoundError('Branch', data.branchId);
    }

    if (data.instructorId && data.instructorId !== existing.instructorId) {
      const instructor = await prisma.instructor.findUnique({ where: { id: data.instructorId } });
      if (!instructor) throw new NotFoundError('Instructor', data.instructorId);
    }

    // Calculate remainingMeetings if needed
    if (data.totalMeetings !== undefined || data.completedMeetings !== undefined) {
      const newTotal = data.totalMeetings ?? existing.totalMeetings;
      const newCompleted = data.completedMeetings ?? existing.completedMeetings;
      (data as any).remainingMeetings = newTotal - newCompleted;
    }

    const cycle = await this.repository.update(id, data);

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'UPDATE',
        entity: 'Cycle',
        entityId: cycle.id,
        oldValue: { name: existing.name, status: existing.status },
        newValue: { name: cycle.name, status: cycle.status },
        req,
      });
    }

    return cycle;
  }

  /**
   * Soft delete cycle
   */
  async delete(id: string, req?: Request) {
    // Check if cycle exists
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new NotFoundError('Cycle', id);
    }

    await this.repository.softDelete(id, req?.user?.userId);

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'DELETE',
        entity: 'Cycle',
        entityId: id,
        oldValue: { name: existing.name, status: existing.status },
        req,
      });
    }
  }

  /**
   * Get meetings of a cycle
   */
  async getMeetings(cycleId: string) {
    // Check if cycle exists
    const existing = await this.repository.findById(cycleId);
    if (!existing) {
      throw new NotFoundError('Cycle', cycleId);
    }

    return this.repository.getMeetings(cycleId);
  }

  /**
   * Get registrations of a cycle
   */
  async getRegistrations(cycleId: string) {
    // Check if cycle exists
    const existing = await this.repository.findById(cycleId);
    if (!existing) {
      throw new NotFoundError('Cycle', cycleId);
    }

    return this.repository.getRegistrations(cycleId);
  }

  /**
   * Add registration to cycle
   */
  async addRegistration(cycleId: string, data: CreateCycleRegistrationInput, req?: Request) {
    // Check if cycle exists
    const cycle = await this.repository.findById(cycleId);
    if (!cycle) {
      throw new NotFoundError('Cycle', cycleId);
    }

    // Check if student exists
    const student = await prisma.student.findUnique({
      where: { id: data.studentId },
    });
    if (!student) {
      throw new NotFoundError('Student', data.studentId);
    }

    // Check if already registered
    const existing = await this.repository.findRegistration(data.studentId, cycleId);
    if (existing) {
      throw new ConflictError('Student is already registered for this cycle');
    }

    const registration = await this.repository.addRegistration(cycleId, data);

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'CREATE',
        entity: 'Registration',
        entityId: registration.id,
        newValue: { studentId: data.studentId, cycleId, status: registration.status },
        req,
      });
    }

    return registration;
  }
}

export const cyclesService = new CyclesService(cyclesRepository);
