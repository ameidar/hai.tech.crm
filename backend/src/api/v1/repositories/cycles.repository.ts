import { prisma } from '../../../utils/prisma.js';
import { Prisma } from '@prisma/client';
import { CycleQuery, CreateCycleInput, UpdateCycleInput, CreateCycleRegistrationInput } from '../validators/cycles.js';

/**
 * Cycles Repository - Data access layer
 */
export class CyclesRepository {
  /**
   * Find all cycles with pagination and filters
   */
  async findAll(query: CycleQuery) {
    const {
      limit,
      offset,
      search,
      sortBy,
      sortOrder,
      from,
      to,
      courseId,
      branchId,
      instructorId,
      institutionalOrderId,
      type,
      status,
      dayOfWeek,
      activityType,
      isOnline,
    } = query;

    // Build where clause
    const where: Prisma.CycleWhereInput = {
      deletedAt: null, // Exclude soft-deleted
    };

    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }
    if (courseId) where.courseId = courseId;
    if (branchId) where.branchId = branchId;
    if (instructorId) where.instructorId = instructorId;
    if (institutionalOrderId) where.institutionalOrderId = institutionalOrderId;
    if (type) where.type = type;
    if (status) where.status = status;
    if (dayOfWeek) where.dayOfWeek = dayOfWeek;
    if (activityType) where.activityType = activityType;
    if (isOnline !== undefined) where.isOnline = isOnline;
    
    // Date range filter
    if (from && to) {
      where.OR = [
        { startDate: { gte: from, lte: to } },
        { endDate: { gte: from, lte: to } },
        { AND: [{ startDate: { lte: from } }, { endDate: { gte: to } }] },
      ];
    } else if (from) {
      where.endDate = { gte: from };
    } else if (to) {
      where.startDate = { lte: to };
    }

    // Build orderBy
    const orderBy: Prisma.CycleOrderByWithRelationInput = sortBy
      ? { [sortBy]: sortOrder || 'asc' }
      : { startDate: 'desc' };

    // Execute queries
    const [cycles, total] = await Promise.all([
      prisma.cycle.findMany({
        where,
        include: {
          course: { select: { id: true, name: true, category: true } },
          branch: { select: { id: true, name: true, type: true } },
          instructor: { select: { id: true, name: true } },
          institutionalOrder: { select: { id: true, orderNumber: true } },
          _count: { select: { registrations: true, meetings: true } },
        },
        orderBy,
        skip: offset,
        take: limit,
      }),
      prisma.cycle.count({ where }),
    ]);

    return { cycles, total };
  }

  /**
   * Find cycle by ID with full relations
   */
  async findById(id: string) {
    return prisma.cycle.findFirst({
      where: { id, deletedAt: null },
      include: {
        course: true,
        branch: true,
        instructor: true,
        institutionalOrder: true,
        _count: { select: { registrations: true, meetings: true } },
      },
    });
  }

  /**
   * Find cycle by ID with full details including registrations and meetings
   */
  async findByIdWithDetails(id: string) {
    return prisma.cycle.findFirst({
      where: { id, deletedAt: null },
      include: {
        course: true,
        branch: true,
        instructor: true,
        institutionalOrder: true,
        registrations: {
          where: { deletedAt: null },
          include: {
            student: {
              include: {
                customer: { select: { id: true, name: true, phone: true, email: true } },
              },
            },
          },
          orderBy: { registrationDate: 'desc' },
        },
        meetings: {
          where: { deletedAt: null },
          orderBy: { scheduledDate: 'asc' },
          include: {
            instructor: { select: { id: true, name: true } },
            _count: { select: { attendance: true } },
          },
        },
      },
    });
  }

  /**
   * Create cycle
   */
  async create(data: CreateCycleInput) {
    // Parse time strings to Date objects for Prisma
    const startTime = new Date(`1970-01-01T${data.startTime}:00Z`);
    const endTime = new Date(`1970-01-01T${data.endTime}:00Z`);

    return prisma.cycle.create({
      data: {
        name: data.name,
        courseId: data.courseId,
        branchId: data.branchId,
        instructorId: data.instructorId,
        institutionalOrderId: data.institutionalOrderId,
        type: data.type,
        startDate: data.startDate,
        endDate: data.endDate || data.startDate, // Default to startDate if not provided
        dayOfWeek: data.dayOfWeek,
        startTime,
        endTime,
        durationMinutes: data.durationMinutes,
        totalMeetings: data.totalMeetings,
        remainingMeetings: data.totalMeetings,
        pricePerStudent: data.pricePerStudent,
        meetingRevenue: data.meetingRevenue,
        studentCount: data.studentCount,
        maxStudents: data.maxStudents,
        sendParentReminders: data.sendParentReminders,
        isOnline: data.activityType === 'online',
        activityType: data.activityType,
        zoomHostId: data.zoomHostId,
        zoomHostEmail: data.zoomHostEmail,
      },
      include: {
        course: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        instructor: { select: { id: true, name: true } },
        _count: { select: { registrations: true, meetings: true } },
      },
    });
  }

  /**
   * Update cycle
   */
  async update(id: string, data: UpdateCycleInput) {
    const updateData: Prisma.CycleUpdateInput = { ...data };

    // Parse time strings if provided
    if (data.startTime) {
      updateData.startTime = new Date(`1970-01-01T${data.startTime}:00Z`);
    }
    if (data.endTime) {
      updateData.endTime = new Date(`1970-01-01T${data.endTime}:00Z`);
    }

    // Update isOnline based on activityType
    if (data.activityType) {
      updateData.isOnline = data.activityType === 'online';
    }

    return prisma.cycle.update({
      where: { id },
      data: updateData,
      include: {
        course: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        instructor: { select: { id: true, name: true } },
        _count: { select: { registrations: true, meetings: true } },
      },
    });
  }

  /**
   * Soft delete cycle
   */
  async softDelete(id: string, deletedBy?: string) {
    return prisma.cycle.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        deletedBy,
      },
    });
  }

  /**
   * Get meetings of a cycle
   */
  async getMeetings(cycleId: string) {
    return prisma.meeting.findMany({
      where: { cycleId, deletedAt: null },
      include: {
        instructor: { select: { id: true, name: true } },
        _count: { select: { attendance: true } },
      },
      orderBy: { scheduledDate: 'asc' },
    });
  }

  /**
   * Get registrations of a cycle
   */
  async getRegistrations(cycleId: string) {
    return prisma.registration.findMany({
      where: { cycleId, deletedAt: null },
      include: {
        student: {
          include: {
            customer: { select: { id: true, name: true, phone: true, email: true } },
          },
        },
      },
      orderBy: { registrationDate: 'desc' },
    });
  }

  /**
   * Add registration to cycle
   */
  async addRegistration(cycleId: string, data: CreateCycleRegistrationInput) {
    return prisma.registration.create({
      data: {
        studentId: data.studentId,
        cycleId,
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
   * Check if student is already registered to cycle
   */
  async findRegistration(studentId: string, cycleId: string) {
    return prisma.registration.findUnique({
      where: {
        studentId_cycleId: { studentId, cycleId },
      },
    });
  }

  /**
   * Update cycle meeting counts
   */
  async updateMeetingCounts(id: string, completed: number, total: number) {
    return prisma.cycle.update({
      where: { id },
      data: {
        completedMeetings: completed,
        remainingMeetings: total - completed,
      },
    });
  }
}

export const cyclesRepository = new CyclesRepository();
