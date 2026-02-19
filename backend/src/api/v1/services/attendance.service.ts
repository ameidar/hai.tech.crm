import { NotFoundError, ConflictError } from '../../../common/errors/index.js';
import { attendanceRepository, AttendanceRepository } from '../repositories/attendance.repository.js';
import { logAudit } from '../../../utils/audit.js';
import { prisma } from '../../../utils/prisma.js';
import { Request } from 'express';
import {
  AttendanceQuery,
  CreateAttendanceInput,
  UpdateAttendanceInput,
  BulkAttendanceInput,
} from '../validators/attendance.js';

/**
 * Attendance Service - Business logic layer
 */
export class AttendanceService {
  constructor(private repository: AttendanceRepository) {}

  /**
   * List all attendance records with pagination and filters
   */
  async list(query: AttendanceQuery) {
    const { attendance, total } = await this.repository.findAll(query);
    return { attendance, total, limit: query.limit, offset: query.offset };
  }

  /**
   * Get single attendance record by ID
   */
  async getById(id: string) {
    const attendance = await this.repository.findById(id);
    if (!attendance) {
      throw new NotFoundError('Attendance', id);
    }
    return attendance;
  }

  /**
   * Create new attendance record
   */
  async create(data: CreateAttendanceInput, req?: Request) {
    // Verify meeting exists
    const meeting = await prisma.meeting.findUnique({
      where: { id: data.meetingId },
    });
    if (!meeting) {
      throw new NotFoundError('Meeting', data.meetingId);
    }

    // Check for duplicate attendance if registrationId is provided
    if (data.registrationId) {
      const existing = await this.repository.findByMeetingAndRegistration(
        data.meetingId,
        data.registrationId
      );
      if (existing) {
        throw new ConflictError('Attendance already recorded for this registration');
      }

      // Verify registration exists
      const registration = await prisma.registration.findUnique({
        where: { id: data.registrationId },
      });
      if (!registration) {
        throw new NotFoundError('Registration', data.registrationId);
      }
    }

    // Check for duplicate attendance if studentId is provided
    if (data.studentId) {
      const existing = await this.repository.findByMeetingAndStudent(
        data.meetingId,
        data.studentId
      );
      if (existing) {
        throw new ConflictError('Attendance already recorded for this student');
      }

      // Verify student exists
      const student = await prisma.student.findUnique({
        where: { id: data.studentId },
      });
      if (!student) {
        throw new NotFoundError('Student', data.studentId);
      }
    }

    const attendance = await this.repository.create(data, req?.user?.userId);

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'CREATE',
        entity: 'Attendance',
        entityId: attendance.id,
        newValue: {
          meetingId: data.meetingId,
          registrationId: data.registrationId,
          studentId: data.studentId,
          status: data.status,
        },
        req,
      });
    }

    return attendance;
  }

  /**
   * Update attendance record
   */
  async update(id: string, data: UpdateAttendanceInput, req?: Request) {
    // Check if attendance exists
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new NotFoundError('Attendance', id);
    }

    const attendance = await this.repository.update(id, data);

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'UPDATE',
        entity: 'Attendance',
        entityId: attendance.id,
        oldValue: { status: existing.status, isTrial: existing.isTrial },
        newValue: { status: attendance.status, isTrial: attendance.isTrial },
        req,
      });
    }

    return attendance;
  }

  /**
   * Delete attendance record
   */
  async delete(id: string, req?: Request) {
    // Check if attendance exists
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new NotFoundError('Attendance', id);
    }

    await this.repository.delete(id);

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'DELETE',
        entity: 'Attendance',
        entityId: id,
        oldValue: {
          meetingId: existing.meetingId,
          registrationId: existing.registrationId,
          studentId: existing.studentId,
          status: existing.status,
        },
        req,
      });
    }
  }

  /**
   * Bulk create/update attendance records for a meeting
   */
  async bulkUpdate(data: BulkAttendanceInput, req?: Request) {
    // Verify meeting exists
    const meeting = await prisma.meeting.findUnique({
      where: { id: data.meetingId },
    });
    if (!meeting) {
      throw new NotFoundError('Meeting', data.meetingId);
    }

    const results = await this.repository.bulkUpsert(
      data.meetingId,
      data.records,
      req?.user?.userId
    );

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'UPDATE',
        entity: 'Attendance',
        entityId: data.meetingId,
        newValue: {
          meetingId: data.meetingId,
          recordCount: results.length,
        },
        req,
      });
    }

    return results;
  }
}

export const attendanceService = new AttendanceService(attendanceRepository);
