import { prisma } from '../../../utils/prisma.js';
import { Prisma, MeetingStatus } from '@prisma/client';
import bcrypt from 'bcrypt';
import { InstructorQuery, CreateInstructorInput, UpdateInstructorInput, InstructorMeetingsQuery } from '../validators/instructors.js';

/**
 * Instructors Repository - Data access layer
 */
export class InstructorsRepository {
  /**
   * Find all instructors with pagination and filters
   */
  async findAll(query: InstructorQuery) {
    const { limit, offset, search, isActive, sortBy, sortOrder } = query;

    // Build where clause
    const where: Prisma.InstructorWhereInput = {
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...(isActive !== undefined && { isActive }),
    };

    // Build orderBy
    const orderBy: Prisma.InstructorOrderByWithRelationInput = sortBy
      ? { [sortBy]: sortOrder || 'asc' }
      : { createdAt: 'desc' };

    // Execute queries
    const [instructors, total] = await Promise.all([
      prisma.instructor.findMany({
        where,
        include: {
          user: {
            select: { id: true, email: true, isActive: true },
          },
          _count: { 
            select: { 
              cycles: true,
              meetings: true,
            } 
          },
        },
        orderBy,
        skip: offset,
        take: limit,
      }),
      prisma.instructor.count({ where }),
    ]);

    return { instructors, total };
  }

  /**
   * Find instructor by ID
   */
  async findById(id: string) {
    return prisma.instructor.findUnique({
      where: { id },
      include: {
        user: {
          select: { id: true, email: true, name: true, isActive: true, lastLogin: true },
        },
        _count: { 
          select: { 
            cycles: true,
            meetings: true,
          } 
        },
      },
    });
  }

  /**
   * Find instructor by phone
   */
  async findByPhone(phone: string) {
    return prisma.instructor.findUnique({
      where: { phone },
    });
  }

  /**
   * Create instructor (with optional user)
   */
  async create(data: CreateInstructorInput) {
    return prisma.$transaction(async (tx) => {
      let userId: string | undefined;

      // Create user if requested
      if (data.createUser && data.email) {
        const passwordHash = await bcrypt.hash(data.userPassword || 'changeme123', 10);
        const user = await tx.user.create({
          data: {
            email: data.email,
            passwordHash,
            name: data.name,
            phone: data.phone,
            role: 'instructor',
            isActive: data.isActive !== false,
          },
        });
        userId = user.id;
      }

      // Create instructor
      return tx.instructor.create({
        data: {
          name: data.name,
          phone: data.phone,
          email: data.email || null,
          rateFrontal: data.rateFrontal,
          rateOnline: data.rateOnline,
          ratePrivate: data.ratePrivate,
          ratePreparation: data.ratePreparation,
          isActive: data.isActive !== false,
          notes: data.notes,
          userId,
        },
        include: {
          user: {
            select: { id: true, email: true, isActive: true },
          },
          _count: { 
            select: { 
              cycles: true,
              meetings: true,
            } 
          },
        },
      });
    });
  }

  /**
   * Update instructor
   */
  async update(id: string, data: UpdateInstructorInput) {
    return prisma.instructor.update({
      where: { id },
      data,
      include: {
        user: {
          select: { id: true, email: true, isActive: true },
        },
        _count: { 
          select: { 
            cycles: true,
            meetings: true,
          } 
        },
      },
    });
  }

  /**
   * Delete instructor
   */
  async delete(id: string) {
    return prisma.instructor.delete({
      where: { id },
    });
  }

  /**
   * Get cycles of an instructor
   */
  async getCycles(instructorId: string) {
    return prisma.cycle.findMany({
      where: { instructorId, deletedAt: null },
      include: {
        course: {
          select: { id: true, name: true, category: true },
        },
        branch: {
          select: { id: true, name: true, city: true },
        },
        _count: { select: { meetings: true, registrations: true } },
      },
      orderBy: { startDate: 'desc' },
    });
  }

  /**
   * Get meetings of an instructor
   */
  async getMeetings(instructorId: string, query: InstructorMeetingsQuery) {
    const { limit, offset, status, from, to } = query;

    const where: Prisma.MeetingWhereInput = {
      instructorId,
      deletedAt: null,
      ...(status && { status: status as MeetingStatus }),
      ...(from && { scheduledDate: { gte: from } }),
      ...(to && { scheduledDate: { lte: to } }),
    };

    const [meetings, total] = await Promise.all([
      prisma.meeting.findMany({
        where,
        include: {
          cycle: {
            select: { 
              id: true, 
              name: true,
              course: { select: { id: true, name: true } },
              branch: { select: { id: true, name: true } },
            },
          },
          _count: { select: { attendance: true } },
        },
        orderBy: { scheduledDate: 'asc' },
        skip: offset,
        take: limit,
      }),
      prisma.meeting.count({ where }),
    ]);

    return { meetings, total };
  }

  /**
   * Check if instructor has cycles
   */
  async hasCycles(instructorId: string) {
    const count = await prisma.cycle.count({
      where: { instructorId },
    });
    return count > 0;
  }
}

export const instructorsRepository = new InstructorsRepository();
