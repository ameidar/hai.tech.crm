import { prisma } from '../../../utils/prisma.js';
import { Prisma } from '@prisma/client';
import { MeetingQuery, CreateMeetingInput, UpdateMeetingInput } from '../validators/meetings.js';

/**
 * Meetings Repository - Data access layer
 */
export class MeetingsRepository {
  /**
   * Find all meetings with pagination and filters
   */
  async findAll(query: MeetingQuery) {
    const {
      limit,
      offset,
      sortBy,
      sortOrder,
      cycleId,
      instructorId,
      branchId,
      status,
      activityType,
      date,
      from,
      to,
    } = query;

    // Build where clause
    const where: Prisma.MeetingWhereInput = {
      deletedAt: null, // Exclude soft-deleted
      ...(cycleId && { cycleId }),
      ...(instructorId && { instructorId }),
      ...(branchId && { cycle: { branchId } }),
      ...(status && { status }),
      ...(activityType && { activityType }),
      ...(date && { scheduledDate: date }),
      ...(from && to && { scheduledDate: { gte: from, lte: to } }),
      ...(from && !to && { scheduledDate: { gte: from } }),
      ...(!from && to && { scheduledDate: { lte: to } }),
    };

    // Build orderBy
    const orderBy: Prisma.MeetingOrderByWithRelationInput[] = sortBy
      ? [{ [sortBy]: sortOrder || 'asc' }]
      : [{ scheduledDate: 'asc' }, { startTime: 'asc' }];

    // Execute queries
    const [meetings, total] = await Promise.all([
      prisma.meeting.findMany({
        where,
        include: {
          cycle: {
            include: {
              course: { select: { id: true, name: true } },
              branch: { select: { id: true, name: true } },
            },
          },
          instructor: { select: { id: true, name: true, phone: true } },
          _count: { select: { attendance: true } },
        },
        orderBy,
        skip: offset,
        take: limit,
      }),
      prisma.meeting.count({ where }),
    ]);

    return { meetings, total };
  }

  /**
   * Find meeting by ID with full relations
   */
  async findById(id: string) {
    return prisma.meeting.findFirst({
      where: { id, deletedAt: null },
      include: {
        cycle: {
          include: {
            course: true,
            branch: true,
            registrations: {
              where: { status: { in: ['registered', 'active'] }, deletedAt: null },
              include: {
                student: {
                  include: {
                    customer: { select: { id: true, name: true, phone: true } },
                  },
                },
              },
            },
          },
        },
        instructor: true,
        attendance: {
          include: {
            registration: {
              include: {
                student: { select: { id: true, name: true } },
              },
            },
            student: { select: { id: true, name: true } },
            recordedBy: { select: { id: true, name: true } },
          },
        },
        statusUpdatedBy: { select: { id: true, name: true } },
        rescheduledTo: { select: { id: true, scheduledDate: true } },
        rescheduledFrom: { select: { id: true, scheduledDate: true } },
      },
    });
  }

  /**
   * Create meeting
   */
  async create(data: CreateMeetingInput) {
    // Parse time strings to Date objects for Prisma
    const startTime = new Date(`1970-01-01T${data.startTime}:00Z`);
    const endTime = new Date(`1970-01-01T${data.endTime}:00Z`);

    return prisma.meeting.create({
      data: {
        cycleId: data.cycleId,
        instructorId: data.instructorId,
        scheduledDate: data.scheduledDate,
        startTime,
        endTime,
        status: 'scheduled',
        activityType: data.activityType,
        topic: data.topic,
        notes: data.notes,
      },
      include: {
        cycle: {
          include: {
            course: { select: { id: true, name: true } },
            branch: { select: { id: true, name: true } },
          },
        },
        instructor: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Update meeting
   */
  async update(id: string, data: UpdateMeetingInput, statusUpdatedById?: string) {
    const updateData: Prisma.MeetingUpdateInput = { ...data };

    // Parse time strings if provided
    if (data.startTime) {
      updateData.startTime = new Date(`1970-01-01T${data.startTime}:00Z`);
    }
    if (data.endTime) {
      updateData.endTime = new Date(`1970-01-01T${data.endTime}:00Z`);
    }

    // Track status change
    if (data.status) {
      updateData.statusUpdatedAt = new Date();
      if (statusUpdatedById) {
        updateData.statusUpdatedBy = { connect: { id: statusUpdatedById } };
      }
    }

    return prisma.meeting.update({
      where: { id },
      data: updateData,
      include: {
        cycle: {
          include: {
            course: { select: { id: true, name: true } },
            branch: { select: { id: true, name: true } },
          },
        },
        instructor: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Soft delete meeting
   */
  async softDelete(id: string, deletedBy?: string) {
    return prisma.meeting.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        deletedBy,
      },
    });
  }

  /**
   * Get attendance records for a meeting
   */
  async getAttendance(meetingId: string) {
    return prisma.attendance.findMany({
      where: { meetingId },
      include: {
        registration: {
          include: {
            student: {
              include: {
                customer: { select: { id: true, name: true, phone: true } },
              },
            },
          },
        },
        student: {
          include: {
            customer: { select: { id: true, name: true, phone: true } },
          },
        },
        recordedBy: { select: { id: true, name: true } },
      },
      orderBy: { recordedAt: 'desc' },
    });
  }

  /**
   * Create rescheduled meeting
   */
  async createRescheduled(
    originalId: string,
    newDate: Date,
    newStartTime?: Date,
    newEndTime?: Date
  ) {
    const original = await prisma.meeting.findUnique({
      where: { id: originalId },
    });

    if (!original) return null;

    // Create new meeting
    const newMeeting = await prisma.meeting.create({
      data: {
        cycleId: original.cycleId,
        instructorId: original.instructorId,
        scheduledDate: newDate,
        startTime: newStartTime || original.startTime,
        endTime: newEndTime || original.endTime,
        status: 'scheduled',
        activityType: original.activityType,
      },
    });

    // Update original meeting
    await prisma.meeting.update({
      where: { id: originalId },
      data: {
        status: 'postponed',
        statusUpdatedAt: new Date(),
        rescheduledToId: newMeeting.id,
      },
    });

    return newMeeting;
  }

  /**
   * Get cycle with instructor for financial calculations
   */
  async getCycleWithInstructor(cycleId: string) {
    return prisma.cycle.findUnique({
      where: { id: cycleId },
      include: {
        registrations: {
          where: { status: { in: ['registered', 'active'] }, deletedAt: null },
        },
        instructor: true,
      },
    });
  }
}

export const meetingsRepository = new MeetingsRepository();
