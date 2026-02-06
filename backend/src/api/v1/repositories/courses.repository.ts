import { prisma } from '../../../utils/prisma.js';
import { Prisma, CourseCategory } from '@prisma/client';
import { CourseQuery, CreateCourseInput, UpdateCourseInput } from '../validators/courses.js';

/**
 * Courses Repository - Data access layer
 */
export class CoursesRepository {
  /**
   * Find all courses with pagination and filters
   */
  async findAll(query: CourseQuery) {
    const { limit, offset, search, category, isActive, sortBy, sortOrder } = query;

    // Build where clause
    const where: Prisma.CourseWhereInput = {
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...(category && { category: category as CourseCategory }),
      ...(isActive !== undefined && { isActive }),
    };

    // Build orderBy
    const orderBy: Prisma.CourseOrderByWithRelationInput = sortBy
      ? { [sortBy]: sortOrder || 'asc' }
      : { createdAt: 'desc' };

    // Execute queries
    const [courses, total] = await Promise.all([
      prisma.course.findMany({
        where,
        include: {
          _count: { select: { cycles: true } },
        },
        orderBy,
        skip: offset,
        take: limit,
      }),
      prisma.course.count({ where }),
    ]);

    return { courses, total };
  }

  /**
   * Find course by ID
   */
  async findById(id: string) {
    return prisma.course.findUnique({
      where: { id },
      include: {
        _count: { select: { cycles: true } },
      },
    });
  }

  /**
   * Create course
   */
  async create(data: CreateCourseInput) {
    return prisma.course.create({
      data: {
        name: data.name,
        description: data.description,
        targetAudience: data.targetAudience,
        category: data.category as CourseCategory,
        isActive: data.isActive,
      },
      include: {
        _count: { select: { cycles: true } },
      },
    });
  }

  /**
   * Update course
   */
  async update(id: string, data: UpdateCourseInput) {
    return prisma.course.update({
      where: { id },
      data: {
        ...data,
        category: data.category as CourseCategory | undefined,
      },
      include: {
        _count: { select: { cycles: true } },
      },
    });
  }

  /**
   * Delete course
   */
  async delete(id: string) {
    return prisma.course.delete({
      where: { id },
    });
  }

  /**
   * Get cycles of a course
   */
  async getCycles(courseId: string) {
    return prisma.cycle.findMany({
      where: { courseId, deletedAt: null },
      include: {
        branch: {
          select: { id: true, name: true, city: true },
        },
        instructor: {
          select: { id: true, name: true },
        },
        _count: { select: { meetings: true, registrations: true } },
      },
      orderBy: { startDate: 'desc' },
    });
  }

  /**
   * Check if course has cycles
   */
  async hasCycles(courseId: string) {
    const count = await prisma.cycle.count({
      where: { courseId },
    });
    return count > 0;
  }
}

export const coursesRepository = new CoursesRepository();
