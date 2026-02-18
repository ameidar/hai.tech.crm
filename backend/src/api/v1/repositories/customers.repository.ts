import { prisma } from '../../../utils/prisma.js';
import { Prisma } from '@prisma/client';
import { CustomerQuery, CreateCustomerInput, UpdateCustomerInput, CreateStudentForCustomerInput } from '../validators/customers.js';

/**
 * Customers Repository - Data access layer
 */
export class CustomersRepository {
  /**
   * Find all customers with pagination and filters
   */
  async findAll(query: CustomerQuery) {
    const { limit, offset, search, city, hasActiveRegistration, sortBy, sortOrder } = query;

    // Build where clause
    const where: Prisma.CustomerWhereInput = {
      deletedAt: null, // Exclude soft-deleted
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...(city && { city }),
      ...(hasActiveRegistration && {
        students: {
          some: {
            registrations: {
              some: {
                status: 'active',
              },
            },
          },
        },
      }),
    };

    // Build orderBy
    const orderBy: Prisma.CustomerOrderByWithRelationInput = sortBy
      ? { [sortBy]: sortOrder || 'asc' }
      : { createdAt: 'desc' };

    // Execute queries
    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        include: {
          _count: { select: { students: true } },
          students: {
            where: { deletedAt: null },
            select: {
              id: true,
              name: true,
              grade: true,
              registrations: {
                where: { status: 'active' },
                select: { id: true },
              },
            },
          },
        },
        orderBy,
        skip: offset,
        take: limit,
      }),
      prisma.customer.count({ where }),
    ]);

    return { customers, total };
  }

  /**
   * Find customer by ID with students
   */
  async findById(id: string) {
    return prisma.customer.findFirst({
      where: { id, deletedAt: null },
      include: {
        students: {
          where: { deletedAt: null },
          include: {
            registrations: {
              include: {
                cycle: {
                  include: {
                    course: true,
                    branch: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  /**
   * Find customer by phone
   */
  async findByPhone(phone: string) {
    return prisma.customer.findUnique({
      where: { phone },
      include: {
        _count: { select: { students: true } },
        students: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Find customer by email
   */
  async findByEmail(email: string) {
    return prisma.customer.findUnique({
      where: { email },
      include: {
        _count: { select: { students: true } },
        students: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Create customer
   */
  async create(data: CreateCustomerInput) {
    return prisma.customer.create({
      data: {
        name: data.name,
        email: data.email || null,
        phone: data.phone,
        address: data.address,
        city: data.city,
        notes: data.notes,
      },
      include: {
        _count: { select: { students: true } },
      },
    });
  }

  /**
   * Update customer
   */
  async update(id: string, data: UpdateCustomerInput) {
    return prisma.customer.update({
      where: { id },
      data,
      include: {
        _count: { select: { students: true } },
        students: {
          where: { deletedAt: null },
          select: {
            id: true,
            name: true,
            grade: true,
          },
        },
      },
    });
  }

  /**
   * Soft delete customer
   */
  async softDelete(id: string, deletedBy?: string) {
    return prisma.customer.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        deletedBy,
      },
    });
  }

  /**
   * Get students of a customer
   */
  async getStudents(customerId: string) {
    return prisma.student.findMany({
      where: { customerId, deletedAt: null },
      include: {
        registrations: {
          include: {
            cycle: {
              select: {
                id: true,
                name: true,
                status: true,
              },
            },
          },
        },
      },
    });
  }

  /**
   * Add student to customer
   */
  async addStudent(customerId: string, data: CreateStudentForCustomerInput) {
    return prisma.student.create({
      data: {
        name: data.name,
        birthDate: data.birthDate,
        grade: data.grade,
        notes: data.notes,
        customerId,
      },
      include: {
        customer: {
          select: { id: true, name: true },
        },
      },
    });
  }
}

export const customersRepository = new CustomersRepository();
