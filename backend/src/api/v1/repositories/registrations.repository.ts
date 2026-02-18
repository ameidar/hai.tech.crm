import { prisma } from '../../../utils/prisma.js';
import { Prisma } from '@prisma/client';
import { RegistrationQuery, CreateRegistrationInput, UpdateRegistrationInput } from '../validators/registrations.js';

/**
 * Registrations Repository - Data access layer
 */
export class RegistrationsRepository {
  /**
   * Find all registrations with pagination and filters
   */
  async findAll(query: RegistrationQuery) {
    const {
      limit,
      offset,
      sortBy,
      sortOrder,
      studentId,
      cycleId,
      customerId,
      status,
      paymentStatus,
      from,
      to,
    } = query;

    // Build where clause
    const where: Prisma.RegistrationWhereInput = {
      deletedAt: null, // Exclude soft-deleted
      ...(studentId && { studentId }),
      ...(cycleId && { cycleId }),
      ...(customerId && { student: { customerId } }),
      ...(status && { status }),
      ...(paymentStatus && { paymentStatus }),
      ...(from && to && { registrationDate: { gte: from, lte: to } }),
      ...(from && !to && { registrationDate: { gte: from } }),
      ...(!from && to && { registrationDate: { lte: to } }),
    };

    // Build orderBy
    const orderBy: Prisma.RegistrationOrderByWithRelationInput = sortBy
      ? { [sortBy]: sortOrder || 'asc' }
      : { registrationDate: 'desc' };

    // Execute queries
    const [registrations, total] = await Promise.all([
      prisma.registration.findMany({
        where,
        include: {
          student: {
            include: {
              customer: { select: { id: true, name: true, phone: true, email: true } },
            },
          },
          cycle: {
            include: {
              course: { select: { id: true, name: true } },
              branch: { select: { id: true, name: true } },
            },
          },
        },
        orderBy,
        skip: offset,
        take: limit,
      }),
      prisma.registration.count({ where }),
    ]);

    return { registrations, total };
  }

  /**
   * Find registration by ID with full relations
   */
  async findById(id: string) {
    return prisma.registration.findFirst({
      where: { id, deletedAt: null },
      include: {
        student: {
          include: {
            customer: true,
          },
        },
        cycle: {
          include: {
            course: true,
            branch: true,
            instructor: { select: { id: true, name: true } },
          },
        },
        attendance: {
          include: {
            meeting: {
              select: { id: true, scheduledDate: true, status: true },
            },
          },
          orderBy: { recordedAt: 'desc' },
        },
      },
    });
  }

  /**
   * Find registration by student and cycle
   */
  async findByStudentAndCycle(studentId: string, cycleId: string) {
    return prisma.registration.findUnique({
      where: {
        studentId_cycleId: { studentId, cycleId },
      },
    });
  }

  /**
   * Create registration
   */
  async create(data: CreateRegistrationInput) {
    return prisma.registration.create({
      data: {
        studentId: data.studentId,
        cycleId: data.cycleId,
        registrationDate: data.registrationDate,
        status: data.status,
        amount: data.amount,
        paymentStatus: data.paymentStatus,
        paymentMethod: data.paymentMethod,
        invoiceLink: data.invoiceLink,
        notes: data.notes,
      },
      include: {
        student: {
          include: {
            customer: { select: { id: true, name: true, phone: true } },
          },
        },
        cycle: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Update registration
   */
  async update(id: string, data: UpdateRegistrationInput) {
    const updateData: Prisma.RegistrationUpdateInput = { ...data };

    // Set cancellation date if status is cancelled
    if (data.status === 'cancelled') {
      updateData.cancellationDate = new Date();
    }

    return prisma.registration.update({
      where: { id },
      data: updateData,
      include: {
        student: {
          include: {
            customer: { select: { id: true, name: true, phone: true } },
          },
        },
        cycle: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Soft delete registration
   */
  async softDelete(id: string, deletedBy?: string) {
    return prisma.registration.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        deletedBy,
      },
    });
  }

  /**
   * Get attendance records for a registration
   */
  async getAttendance(registrationId: string) {
    return prisma.attendance.findMany({
      where: { registrationId },
      include: {
        meeting: {
          select: {
            id: true,
            scheduledDate: true,
            startTime: true,
            endTime: true,
            status: true,
            topic: true,
          },
        },
        recordedBy: { select: { id: true, name: true } },
      },
      orderBy: { recordedAt: 'desc' },
    });
  }

  /**
   * Cancel registration with reason
   */
  async cancel(id: string, reason?: string) {
    return prisma.registration.update({
      where: { id },
      data: {
        status: 'cancelled',
        cancellationDate: new Date(),
        cancellationReason: reason,
      },
      include: {
        student: { select: { id: true, name: true } },
        cycle: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Update payment status
   */
  async updatePayment(
    id: string,
    paymentStatus: 'unpaid' | 'partial' | 'paid',
    paymentMethod?: 'credit' | 'transfer' | 'cash',
    amount?: number,
    invoiceLink?: string
  ) {
    return prisma.registration.update({
      where: { id },
      data: {
        paymentStatus,
        ...(paymentMethod && { paymentMethod }),
        ...(amount !== undefined && { amount }),
        ...(invoiceLink && { invoiceLink }),
      },
      include: {
        student: { select: { id: true, name: true } },
        cycle: { select: { id: true, name: true } },
      },
    });
  }
}

export const registrationsRepository = new RegistrationsRepository();
