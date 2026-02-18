import { prisma } from '../../../utils/prisma.js';
import { Prisma } from '@prisma/client';
import { StudentQuery, CreateStudentInput, UpdateStudentInput } from '../validators/students.js';

/**
 * Students Repository - Data access layer
 */
export class StudentsRepository {
  /**
   * Find all students with pagination and filters
   */
  async findAll(query: StudentQuery) {
    const { limit, offset, search, customerId, grade, sortBy, sortOrder } = query;

    // Build where clause
    const where: Prisma.StudentWhereInput = {
      deletedAt: null, // Exclude soft-deleted
      ...(search && {
        name: { contains: search, mode: 'insensitive' },
      }),
      ...(customerId && { customerId }),
      ...(grade && { grade }),
    };

    // Build orderBy
    const orderBy: Prisma.StudentOrderByWithRelationInput = sortBy
      ? { [sortBy]: sortOrder || 'asc' }
      : { createdAt: 'desc' };

    // Execute queries
    const [students, total] = await Promise.all([
      prisma.student.findMany({
        where,
        include: {
          customer: {
            select: { id: true, name: true, phone: true },
          },
          _count: { select: { registrations: true } },
        },
        orderBy,
        skip: offset,
        take: limit,
      }),
      prisma.student.count({ where }),
    ]);

    return { students, total };
  }

  /**
   * Find student by ID
   */
  async findById(id: string) {
    return prisma.student.findFirst({
      where: { id, deletedAt: null },
      include: {
        customer: {
          select: { id: true, name: true, phone: true, email: true },
        },
        registrations: {
          include: {
            cycle: {
              include: {
                course: true,
                branch: true,
                instructor: {
                  select: { id: true, name: true },
                },
              },
            },
          },
        },
      },
    });
  }

  /**
   * Create student
   */
  async create(data: CreateStudentInput) {
    return prisma.student.create({
      data: {
        customerId: data.customerId,
        name: data.name,
        birthDate: data.birthDate,
        grade: data.grade,
        notes: data.notes,
      },
      include: {
        customer: {
          select: { id: true, name: true },
        },
      },
    });
  }

  /**
   * Update student
   */
  async update(id: string, data: UpdateStudentInput) {
    return prisma.student.update({
      where: { id },
      data,
      include: {
        customer: {
          select: { id: true, name: true },
        },
      },
    });
  }

  /**
   * Soft delete student
   */
  async softDelete(id: string, deletedBy?: string) {
    return prisma.student.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        deletedBy,
      },
    });
  }

  /**
   * Get registrations of a student
   */
  async getRegistrations(studentId: string) {
    return prisma.registration.findMany({
      where: { studentId, deletedAt: null },
      include: {
        cycle: {
          include: {
            course: true,
            branch: true,
            instructor: {
              select: { id: true, name: true },
            },
          },
        },
      },
      orderBy: { registrationDate: 'desc' },
    });
  }

  /**
   * Check if customer exists
   */
  async customerExists(customerId: string) {
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
    });
    return !!customer;
  }
}

export const studentsRepository = new StudentsRepository();
