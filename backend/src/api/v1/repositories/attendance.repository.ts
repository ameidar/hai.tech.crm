import { prisma } from '../../../utils/prisma.js';
import { Prisma } from '@prisma/client';
import { AttendanceQuery, CreateAttendanceInput, UpdateAttendanceInput } from '../validators/attendance.js';

/**
 * Attendance Repository - Data access layer
 */
export class AttendanceRepository {
  /**
   * Find all attendance records with pagination and filters
   */
  async findAll(query: AttendanceQuery) {
    const {
      limit,
      offset,
      sortBy,
      sortOrder,
      meetingId,
      studentId,
      registrationId,
      status,
      isTrial,
      from,
      to,
    } = query;

    // Build where clause
    const where: Prisma.AttendanceWhereInput = {
      ...(meetingId && { meetingId }),
      ...(studentId && { studentId }),
      ...(registrationId && { registrationId }),
      ...(status && { status }),
      ...(isTrial !== undefined && { isTrial }),
      ...(from && to && { meeting: { scheduledDate: { gte: from, lte: to } } }),
      ...(from && !to && { meeting: { scheduledDate: { gte: from } } }),
      ...(!from && to && { meeting: { scheduledDate: { lte: to } } }),
    };

    // Build orderBy
    const orderBy: Prisma.AttendanceOrderByWithRelationInput = sortBy
      ? { [sortBy]: sortOrder || 'asc' }
      : { recordedAt: 'desc' };

    // Execute queries
    const [attendance, total] = await Promise.all([
      prisma.attendance.findMany({
        where,
        include: {
          meeting: {
            select: {
              id: true,
              scheduledDate: true,
              startTime: true,
              endTime: true,
              status: true,
              cycle: {
                select: {
                  id: true,
                  name: true,
                  course: { select: { id: true, name: true } },
                },
              },
            },
          },
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
        orderBy,
        skip: offset,
        take: limit,
      }),
      prisma.attendance.count({ where }),
    ]);

    return { attendance, total };
  }

  /**
   * Find attendance by ID
   */
  async findById(id: string) {
    return prisma.attendance.findUnique({
      where: { id },
      include: {
        meeting: {
          include: {
            cycle: {
              include: {
                course: true,
                branch: true,
              },
            },
            instructor: { select: { id: true, name: true } },
          },
        },
        registration: {
          include: {
            student: {
              include: {
                customer: true,
              },
            },
          },
        },
        student: {
          include: {
            customer: true,
          },
        },
        recordedBy: { select: { id: true, name: true, email: true } },
      },
    });
  }

  /**
   * Find attendance by meeting and registration
   */
  async findByMeetingAndRegistration(meetingId: string, registrationId: string) {
    return prisma.attendance.findUnique({
      where: {
        meetingId_registrationId: { meetingId, registrationId },
      },
    });
  }

  /**
   * Find attendance by meeting and student
   */
  async findByMeetingAndStudent(meetingId: string, studentId: string) {
    return prisma.attendance.findUnique({
      where: {
        meetingId_studentId: { meetingId, studentId },
      },
    });
  }

  /**
   * Create attendance
   */
  async create(data: CreateAttendanceInput, recordedById?: string) {
    return prisma.attendance.create({
      data: {
        meetingId: data.meetingId,
        registrationId: data.registrationId,
        studentId: data.studentId,
        guestName: data.guestName,
        status: data.status,
        isTrial: data.isTrial,
        notes: data.notes,
        recordedById,
      },
      include: {
        meeting: { select: { id: true, scheduledDate: true } },
        registration: {
          include: {
            student: { select: { id: true, name: true } },
          },
        },
        student: { select: { id: true, name: true } },
        recordedBy: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Update attendance
   */
  async update(id: string, data: UpdateAttendanceInput) {
    return prisma.attendance.update({
      where: { id },
      data,
      include: {
        meeting: { select: { id: true, scheduledDate: true } },
        registration: {
          include: {
            student: { select: { id: true, name: true } },
          },
        },
        student: { select: { id: true, name: true } },
        recordedBy: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Delete attendance
   */
  async delete(id: string) {
    return prisma.attendance.delete({
      where: { id },
    });
  }

  /**
   * Create or update attendance (upsert)
   */
  async upsert(
    meetingId: string,
    registrationId: string | undefined,
    studentId: string | undefined,
    data: { status: 'present' | 'absent' | 'late'; isTrial?: boolean; notes?: string },
    recordedById?: string
  ) {
    if (registrationId) {
      return prisma.attendance.upsert({
        where: {
          meetingId_registrationId: { meetingId, registrationId },
        },
        update: {
          status: data.status,
          isTrial: data.isTrial,
          notes: data.notes,
        },
        create: {
          meetingId,
          registrationId,
          status: data.status,
          isTrial: data.isTrial || false,
          notes: data.notes,
          recordedById,
        },
        include: {
          registration: {
            include: {
              student: { select: { id: true, name: true } },
            },
          },
        },
      });
    } else if (studentId) {
      return prisma.attendance.upsert({
        where: {
          meetingId_studentId: { meetingId, studentId },
        },
        update: {
          status: data.status,
          isTrial: data.isTrial,
          notes: data.notes,
        },
        create: {
          meetingId,
          studentId,
          status: data.status,
          isTrial: data.isTrial || false,
          notes: data.notes,
          recordedById,
        },
        include: {
          student: { select: { id: true, name: true } },
        },
      });
    }
    throw new Error('Either registrationId or studentId must be provided');
  }

  /**
   * Bulk create/update attendance for a meeting
   */
  async bulkUpsert(
    meetingId: string,
    records: Array<{
      registrationId?: string;
      studentId?: string;
      guestName?: string;
      status: 'present' | 'absent' | 'late';
      isTrial?: boolean;
      notes?: string;
    }>,
    recordedById?: string
  ) {
    const results = [];

    for (const record of records) {
      if (record.registrationId) {
        const result = await prisma.attendance.upsert({
          where: {
            meetingId_registrationId: { meetingId, registrationId: record.registrationId },
          },
          update: {
            status: record.status,
            isTrial: record.isTrial,
            notes: record.notes,
          },
          create: {
            meetingId,
            registrationId: record.registrationId,
            status: record.status,
            isTrial: record.isTrial || false,
            notes: record.notes,
            recordedById,
          },
        });
        results.push(result);
      } else if (record.studentId) {
        const result = await prisma.attendance.upsert({
          where: {
            meetingId_studentId: { meetingId, studentId: record.studentId },
          },
          update: {
            status: record.status,
            isTrial: record.isTrial,
            notes: record.notes,
          },
          create: {
            meetingId,
            studentId: record.studentId,
            status: record.status,
            isTrial: record.isTrial || false,
            notes: record.notes,
            recordedById,
          },
        });
        results.push(result);
      } else if (record.guestName) {
        const result = await prisma.attendance.create({
          data: {
            meetingId,
            guestName: record.guestName,
            status: record.status,
            isTrial: record.isTrial || false,
            notes: record.notes,
            recordedById,
          },
        });
        results.push(result);
      }
    }

    return results;
  }
}

export const attendanceRepository = new AttendanceRepository();
