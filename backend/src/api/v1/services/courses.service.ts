import { NotFoundError, ConflictError } from '../../../common/errors/index.js';
import { coursesRepository, CoursesRepository } from '../repositories/courses.repository.js';
import { logAudit } from '../../../utils/audit.js';
import { Request } from 'express';
import { CourseQuery, CreateCourseInput, UpdateCourseInput } from '../validators/courses.js';

/**
 * Courses Service - Business logic layer
 */
export class CoursesService {
  constructor(private repository: CoursesRepository) {}

  /**
   * List all courses with pagination and filters
   */
  async list(query: CourseQuery) {
    const { courses, total } = await this.repository.findAll(query);
    return { courses, total, limit: query.limit, offset: query.offset };
  }

  /**
   * Get single course by ID
   */
  async getById(id: string) {
    const course = await this.repository.findById(id);
    if (!course) {
      throw new NotFoundError('Course', id);
    }
    return course;
  }

  /**
   * Create new course
   */
  async create(data: CreateCourseInput, req?: Request) {
    const course = await this.repository.create(data);

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'CREATE',
        entity: 'Course',
        entityId: course.id,
        newValue: { name: course.name, category: course.category },
        req,
      });
    }

    return course;
  }

  /**
   * Update course
   */
  async update(id: string, data: UpdateCourseInput, req?: Request) {
    // Check if course exists
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new NotFoundError('Course', id);
    }

    const course = await this.repository.update(id, data);

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'UPDATE',
        entity: 'Course',
        entityId: course.id,
        oldValue: { name: existing.name, category: existing.category, isActive: existing.isActive },
        newValue: { name: course.name, category: course.category, isActive: course.isActive },
        req,
      });
    }

    return course;
  }

  /**
   * Delete course (hard delete - only if no cycles)
   */
  async delete(id: string, req?: Request) {
    // Check if course exists
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new NotFoundError('Course', id);
    }

    // Check for existing cycles
    const hasCycles = await this.repository.hasCycles(id);
    if (hasCycles) {
      throw new ConflictError('Cannot delete course with existing cycles. Deactivate it instead.', {
        suggestion: 'Set isActive: false',
      });
    }

    await this.repository.delete(id);

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'DELETE',
        entity: 'Course',
        entityId: id,
        oldValue: { name: existing.name, category: existing.category },
        req,
      });
    }
  }

  /**
   * Get cycles of a course
   */
  async getCycles(courseId: string) {
    // Check if course exists
    const existing = await this.repository.findById(courseId);
    if (!existing) {
      throw new NotFoundError('Course', courseId);
    }

    return this.repository.getCycles(courseId);
  }
}

export const coursesService = new CoursesService(coursesRepository);
