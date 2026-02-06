import { NotFoundError, ValidationError } from '../../../common/errors/index.js';
import { meetingsRepository, MeetingsRepository } from '../repositories/meetings.repository.js';
import { logAudit } from '../../../utils/audit.js';
import { prisma } from '../../../utils/prisma.js';
import { Request } from 'express';
import {
  MeetingQuery,
  CreateMeetingInput,
  UpdateMeetingInput,
  PostponeMeetingInput,
} from '../validators/meetings.js';

/**
 * Meetings Service - Business logic layer
 */
export class MeetingsService {
  constructor(private repository: MeetingsRepository) {}

  /**
   * List all meetings with pagination and filters
   */
  async list(query: MeetingQuery) {
    const { meetings, total } = await this.repository.findAll(query);
    return { meetings, total, limit: query.limit, offset: query.offset };
  }

  /**
   * Get single meeting by ID
   */
  async getById(id: string) {
    const meeting = await this.repository.findById(id);
    if (!meeting) {
      throw new NotFoundError('Meeting', id);
    }
    return meeting;
  }

  /**
   * Create new meeting
   */
  async create(data: CreateMeetingInput, req?: Request) {
    // Verify cycle exists
    const cycle = await this.repository.getCycleWithInstructor(data.cycleId);
    if (!cycle) {
      throw new NotFoundError('Cycle', data.cycleId);
    }

    // Verify instructor exists
    const instructor = await prisma.instructor.findUnique({
      where: { id: data.instructorId },
    });
    if (!instructor) {
      throw new NotFoundError('Instructor', data.instructorId);
    }

    const meeting = await this.repository.create(data);

    // Update cycle meeting counts
    await prisma.cycle.update({
      where: { id: data.cycleId },
      data: {
        totalMeetings: { increment: 1 },
        remainingMeetings: { increment: 1 },
      },
    });

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'CREATE',
        entity: 'Meeting',
        entityId: meeting.id,
        newValue: {
          cycleId: data.cycleId,
          scheduledDate: data.scheduledDate,
          instructorId: data.instructorId,
        },
        req,
      });
    }

    return meeting;
  }

  /**
   * Update meeting
   */
  async update(id: string, data: UpdateMeetingInput, req?: Request) {
    // Check if meeting exists
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new NotFoundError('Meeting', id);
    }

    // Handle status change to completed - calculate financials
    if (data.status === 'completed' && existing.status !== 'completed') {
      const financials = await this.calculateMeetingFinancials(existing);
      data.revenue = financials.revenue;
      data.instructorPayment = financials.instructorPayment;
      data.profit = financials.profit;

      // Update cycle counters
      await prisma.cycle.update({
        where: { id: existing.cycleId },
        data: {
          completedMeetings: { increment: 1 },
          remainingMeetings: { decrement: 1 },
        },
      });
    }

    // Handle status change FROM completed to something else
    if (existing.status === 'completed' && data.status && data.status !== 'completed') {
      data.revenue = 0;
      data.instructorPayment = 0;
      data.profit = 0;

      // Update cycle counters
      await prisma.cycle.update({
        where: { id: existing.cycleId },
        data: {
          completedMeetings: { decrement: 1 },
          remainingMeetings: { increment: 1 },
        },
      });
    }

    const meeting = await this.repository.update(id, data, req?.user?.userId);

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'UPDATE',
        entity: 'Meeting',
        entityId: meeting.id,
        oldValue: { status: existing.status },
        newValue: { status: meeting.status },
        req,
      });
    }

    return meeting;
  }

  /**
   * Soft delete meeting
   */
  async delete(id: string, req?: Request) {
    // Check if meeting exists
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new NotFoundError('Meeting', id);
    }

    // If meeting was completed, decrement cycle counters
    if (existing.status === 'completed') {
      await prisma.cycle.update({
        where: { id: existing.cycleId },
        data: {
          completedMeetings: { decrement: 1 },
          remainingMeetings: { increment: 1 },
        },
      });
    }

    await this.repository.softDelete(id, req?.user?.userId);

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'DELETE',
        entity: 'Meeting',
        entityId: id,
        oldValue: { scheduledDate: existing.scheduledDate, status: existing.status },
        req,
      });
    }
  }

  /**
   * Get attendance for a meeting
   */
  async getAttendance(meetingId: string) {
    // Check if meeting exists
    const meeting = await this.repository.findById(meetingId);
    if (!meeting) {
      throw new NotFoundError('Meeting', meetingId);
    }

    const attendance = await this.repository.getAttendance(meetingId);

    // Get students who haven't been marked
    const markedIds = new Set(attendance.map((a) => a.registrationId));
    const unmarked = meeting.cycle?.registrations.filter((r) => !markedIds.has(r.id)) || [];

    return { marked: attendance, unmarked };
  }

  /**
   * Postpone meeting to new date
   */
  async postpone(id: string, data: PostponeMeetingInput, req?: Request) {
    // Check if meeting exists
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new NotFoundError('Meeting', id);
    }

    if (existing.status !== 'scheduled') {
      throw new ValidationError('Can only postpone scheduled meetings');
    }

    // Parse times if provided
    const newStartTime = data.newStartTime
      ? new Date(`1970-01-01T${data.newStartTime}:00Z`)
      : undefined;
    const newEndTime = data.newEndTime
      ? new Date(`1970-01-01T${data.newEndTime}:00Z`)
      : undefined;

    const newMeeting = await this.repository.createRescheduled(
      id,
      data.newDate,
      newStartTime,
      newEndTime
    );

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'UPDATE',
        entity: 'Meeting',
        entityId: id,
        oldValue: { status: 'scheduled', scheduledDate: existing.scheduledDate },
        newValue: { status: 'postponed', rescheduledToId: newMeeting?.id },
        req,
      });
    }

    return {
      originalMeeting: { id, status: 'postponed' },
      newMeeting,
    };
  }

  /**
   * Calculate meeting financials based on cycle type
   */
  private async calculateMeetingFinancials(meeting: {
    cycleId: string;
    instructorId: string;
    startTime: Date;
    endTime: Date;
    activityType: string | null;
  }) {
    const cycle = await this.repository.getCycleWithInstructor(meeting.cycleId);
    if (!cycle) {
      return { revenue: 0, instructorPayment: 0, profit: 0 };
    }

    // Calculate revenue based on cycle type
    let revenue = 0;
    const activeRegistrations = cycle.registrations.filter((reg) => reg.status === 'active');

    if (cycle.type === 'private') {
      const totalRegistrationAmount = cycle.registrations.reduce(
        (sum, reg) => sum + (reg.amount ? Number(reg.amount) : 0),
        0
      );
      revenue = Math.round(totalRegistrationAmount / cycle.totalMeetings);
    } else if (cycle.type === 'institutional_per_child') {
      const pricePerStudent = Number(cycle.pricePerStudent || 0);
      const studentCount = cycle.studentCount || activeRegistrations.length;
      revenue = Math.round(pricePerStudent * studentCount);
    } else if (cycle.type === 'institutional_fixed') {
      revenue = Number(cycle.meetingRevenue || 0);
    }

    // Calculate instructor payment
    const instructor = cycle.instructor;
    let instructorPayment = 0;

    if (instructor) {
      const activityType =
        meeting.activityType ||
        cycle.activityType ||
        (cycle.isOnline ? 'online' : cycle.type === 'private' ? 'private_lesson' : 'frontal');

      let hourlyRate = 0;
      switch (activityType) {
        case 'online':
          hourlyRate = Number(instructor.rateOnline || instructor.rateFrontal || 0);
          break;
        case 'private_lesson':
          hourlyRate = Number(instructor.ratePrivate || instructor.rateFrontal || 0);
          break;
        case 'frontal':
        default:
          hourlyRate = Number(instructor.rateFrontal || 0);
          break;
      }

      // Calculate duration
      let durationMinutes = cycle.durationMinutes;
      if (meeting.startTime && meeting.endTime) {
        const startMs = meeting.startTime.getTime();
        const endMs = meeting.endTime.getTime();
        const calculatedMinutes = (endMs - startMs) / (1000 * 60);
        if (calculatedMinutes > 0 && calculatedMinutes < 1440) {
          durationMinutes = calculatedMinutes;
        }
      }

      const durationHours = durationMinutes / 60;
      instructorPayment = Math.round(hourlyRate * durationHours);
    }

    const profit = revenue - instructorPayment;

    return { revenue, instructorPayment, profit };
  }
}

export const meetingsService = new MeetingsService(meetingsRepository);
