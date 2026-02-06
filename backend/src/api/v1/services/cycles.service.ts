import { NotFoundError, ConflictError } from '../../../common/errors/index.js';
import { cyclesRepository, CyclesRepository } from '../repositories/cycles.repository.js';
import { logAudit } from '../../../utils/audit.js';
import { prisma } from '../../../utils/prisma.js';
import { Request } from 'express';
import {
  CycleQuery,
  CreateCycleInput,
  UpdateCycleInput,
  CreateCycleRegistrationInput,
  DuplicateCycleInput,
  BulkUpdateCyclesInput,
} from '../validators/cycles.js';
import { fetchHolidays, dayNameToNumber } from '../../../utils/holidays.js';

/**
 * Cycles Service - Business logic layer
 */
export class CyclesService {
  constructor(private repository: CyclesRepository) {}

  /**
   * List all cycles with pagination and filters
   */
  async list(query: CycleQuery) {
    const { cycles, total } = await this.repository.findAll(query);
    return { cycles, total, limit: query.limit, offset: query.offset };
  }

  /**
   * Get single cycle by ID
   */
  async getById(id: string) {
    const cycle = await this.repository.findByIdWithDetails(id);
    if (!cycle) {
      throw new NotFoundError('Cycle', id);
    }
    return cycle;
  }

  /**
   * Create new cycle
   */
  async create(data: CreateCycleInput, req?: Request) {
    // Verify all foreign keys exist
    const [course, branch, instructor] = await Promise.all([
      prisma.course.findUnique({ where: { id: data.courseId } }),
      prisma.branch.findUnique({ where: { id: data.branchId } }),
      prisma.instructor.findUnique({ where: { id: data.instructorId } }),
    ]);

    if (!course) throw new NotFoundError('Course', data.courseId);
    if (!branch) throw new NotFoundError('Branch', data.branchId);
    if (!instructor) throw new NotFoundError('Instructor', data.instructorId);

    if (data.institutionalOrderId) {
      const order = await prisma.institutionalOrder.findUnique({
        where: { id: data.institutionalOrderId },
      });
      if (!order) throw new NotFoundError('InstitutionalOrder', data.institutionalOrderId);
    }

    const cycle = await this.repository.create(data);

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'CREATE',
        entity: 'Cycle',
        entityId: cycle.id,
        newValue: { name: cycle.name, courseId: data.courseId, branchId: data.branchId },
        req,
      });
    }

    return cycle;
  }

  /**
   * Update cycle
   */
  async update(id: string, data: UpdateCycleInput, req?: Request) {
    // Check if cycle exists
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new NotFoundError('Cycle', id);
    }

    // Verify foreign keys if being changed
    if (data.courseId && data.courseId !== existing.courseId) {
      const course = await prisma.course.findUnique({ where: { id: data.courseId } });
      if (!course) throw new NotFoundError('Course', data.courseId);
    }

    if (data.branchId && data.branchId !== existing.branchId) {
      const branch = await prisma.branch.findUnique({ where: { id: data.branchId } });
      if (!branch) throw new NotFoundError('Branch', data.branchId);
    }

    if (data.instructorId && data.instructorId !== existing.instructorId) {
      const instructor = await prisma.instructor.findUnique({ where: { id: data.instructorId } });
      if (!instructor) throw new NotFoundError('Instructor', data.instructorId);
    }

    // Calculate remainingMeetings if needed
    if (data.totalMeetings !== undefined || data.completedMeetings !== undefined) {
      const newTotal = data.totalMeetings ?? existing.totalMeetings;
      const newCompleted = data.completedMeetings ?? existing.completedMeetings;
      (data as any).remainingMeetings = newTotal - newCompleted;
    }

    const cycle = await this.repository.update(id, data);

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'UPDATE',
        entity: 'Cycle',
        entityId: cycle.id,
        oldValue: { name: existing.name, status: existing.status },
        newValue: { name: cycle.name, status: cycle.status },
        req,
      });
    }

    return cycle;
  }

  /**
   * Soft delete cycle
   */
  async delete(id: string, req?: Request) {
    // Check if cycle exists
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new NotFoundError('Cycle', id);
    }

    await this.repository.softDelete(id, req?.user?.userId);

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'DELETE',
        entity: 'Cycle',
        entityId: id,
        oldValue: { name: existing.name, status: existing.status },
        req,
      });
    }
  }

  /**
   * Get meetings of a cycle
   */
  async getMeetings(cycleId: string) {
    // Check if cycle exists
    const existing = await this.repository.findById(cycleId);
    if (!existing) {
      throw new NotFoundError('Cycle', cycleId);
    }

    return this.repository.getMeetings(cycleId);
  }

  /**
   * Get registrations of a cycle
   */
  async getRegistrations(cycleId: string) {
    // Check if cycle exists
    const existing = await this.repository.findById(cycleId);
    if (!existing) {
      throw new NotFoundError('Cycle', cycleId);
    }

    return this.repository.getRegistrations(cycleId);
  }

  /**
   * Add registration to cycle
   */
  async addRegistration(cycleId: string, data: CreateCycleRegistrationInput, req?: Request) {
    // Check if cycle exists
    const cycle = await this.repository.findById(cycleId);
    if (!cycle) {
      throw new NotFoundError('Cycle', cycleId);
    }

    // Check if student exists
    const student = await prisma.student.findUnique({
      where: { id: data.studentId },
    });
    if (!student) {
      throw new NotFoundError('Student', data.studentId);
    }

    // Check if already registered
    const existing = await this.repository.findRegistration(data.studentId, cycleId);
    if (existing) {
      throw new ConflictError('Student is already registered for this cycle');
    }

    const registration = await this.repository.addRegistration(cycleId, data);

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'CREATE',
        entity: 'Registration',
        entityId: registration.id,
        newValue: { studentId: data.studentId, cycleId, status: registration.status },
        req,
      });
    }

    return registration;
  }

  /**
   * Generate meetings for a cycle based on schedule
   */
  async generateMeetings(cycleId: string, req?: Request) {
    const cycle = await prisma.cycle.findUnique({
      where: { id: cycleId },
      include: { meetings: { where: { deletedAt: null } } },
    });

    if (!cycle) {
      throw new NotFoundError('Cycle', cycleId);
    }

    // Calculate how many new meetings to generate
    const existingCount = cycle.meetings.length;
    const meetingsToGenerate = cycle.totalMeetings - existingCount;

    if (meetingsToGenerate <= 0) {
      return {
        message: 'All meetings already exist',
        generated: 0,
        total: existingCount,
      };
    }

    // Generate meetings
    const meetings = [];
    const targetDay = dayNameToNumber(cycle.dayOfWeek);
    
    // Find the last meeting date or use start date
    let currentDate: Date;
    if (cycle.meetings.length > 0) {
      const lastMeeting = cycle.meetings.sort((a, b) => 
        b.scheduledDate.getTime() - a.scheduledDate.getTime()
      )[0];
      currentDate = new Date(lastMeeting.scheduledDate);
      currentDate.setDate(currentDate.getDate() + 7); // Start from next week
    } else {
      currentDate = new Date(cycle.startDate);
      // Find first occurrence of target day
      while (currentDate.getDay() !== targetDay) {
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }

    // Fetch holidays
    const startYear = currentDate.getFullYear();
    const holidaysThisYear = await fetchHolidays(startYear);
    const holidaysNextYear = await fetchHolidays(startYear + 1);
    const allHolidays = new Set([...holidaysThisYear, ...holidaysNextYear]);

    // Generate meetings, skipping holidays
    let attempts = 0;
    const maxAttempts = meetingsToGenerate * 3;

    while (meetings.length < meetingsToGenerate && attempts < maxAttempts) {
      attempts++;
      const dateStr = currentDate.toISOString().split('T')[0];

      if (!allHolidays.has(dateStr)) {
        meetings.push({
          cycleId: cycle.id,
          instructorId: cycle.instructorId,
          scheduledDate: new Date(currentDate),
          startTime: cycle.startTime,
          endTime: cycle.endTime,
          status: 'scheduled' as const,
          activityType: cycle.activityType,
        });
      }

      currentDate.setDate(currentDate.getDate() + 7);
    }

    if (meetings.length > 0) {
      await prisma.meeting.createMany({ data: meetings });

      // Update cycle end date and remaining meetings
      const lastMeetingDate = meetings[meetings.length - 1].scheduledDate;
      await prisma.cycle.update({
        where: { id: cycleId },
        data: {
          remainingMeetings: cycle.remainingMeetings + meetings.length,
          endDate: lastMeetingDate,
        },
      });
    }

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'UPDATE',
        entity: 'Cycle',
        entityId: cycleId,
        newValue: { action: 'generate-meetings', generated: meetings.length },
        req,
      });
    }

    return {
      message: `Generated ${meetings.length} new meetings`,
      generated: meetings.length,
      total: existingCount + meetings.length,
    };
  }

  /**
   * Sync cycle progress from meetings table
   */
  async syncProgress(cycleId: string, req?: Request) {
    const cycle = await prisma.cycle.findUnique({
      where: { id: cycleId },
    });

    if (!cycle) {
      throw new NotFoundError('Cycle', cycleId);
    }

    // Count meetings from table
    const [completedMeetings, totalMeetingsFromTable] = await Promise.all([
      prisma.meeting.count({
        where: { cycleId, status: 'completed', deletedAt: null },
      }),
      prisma.meeting.count({
        where: { cycleId, deletedAt: null },
      }),
    ]);

    // Use the larger of cycle.totalMeetings or actual meeting count
    const totalMeetings = Math.max(cycle.totalMeetings, totalMeetingsFromTable);
    const remainingMeetings = totalMeetings - completedMeetings;

    const updated = await prisma.cycle.update({
      where: { id: cycleId },
      data: {
        completedMeetings,
        remainingMeetings,
        totalMeetings,
      },
      include: {
        course: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        instructor: { select: { id: true, name: true } },
      },
    });

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'UPDATE',
        entity: 'Cycle',
        entityId: cycleId,
        oldValue: {
          completedMeetings: cycle.completedMeetings,
          remainingMeetings: cycle.remainingMeetings,
        },
        newValue: { completedMeetings, remainingMeetings, totalMeetings },
        req,
      });
    }

    return {
      ...updated,
      synced: {
        completedMeetings,
        remainingMeetings,
        totalMeetings,
        meetingsInTable: totalMeetingsFromTable,
      },
    };
  }

  /**
   * Duplicate a cycle with new start date
   */
  async duplicate(cycleId: string, data: DuplicateCycleInput, req?: Request) {
    const original = await prisma.cycle.findUnique({
      where: { id: cycleId },
      include: {
        registrations: data.copyRegistrations ? {
          where: { status: { in: ['registered', 'active'] }, deletedAt: null },
        } : false,
      },
    });

    if (!original) {
      throw new NotFoundError('Cycle', cycleId);
    }

    // Calculate new end date based on total meetings and day of week
    const targetDay = dayNameToNumber(original.dayOfWeek);
    let currentDate = new Date(data.newStartDate);
    
    // Find first occurrence of target day
    while (currentDate.getDay() !== targetDay) {
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Calculate end date (total meetings * 7 days)
    const newEndDate = new Date(currentDate);
    newEndDate.setDate(newEndDate.getDate() + (original.totalMeetings - 1) * 7);

    // Create new cycle
    const newCycle = await prisma.cycle.create({
      data: {
        name: data.newName || `${original.name} (עותק)`,
        courseId: original.courseId,
        branchId: original.branchId,
        instructorId: original.instructorId,
        institutionalOrderId: original.institutionalOrderId,
        type: original.type,
        startDate: data.newStartDate,
        endDate: newEndDate,
        dayOfWeek: original.dayOfWeek,
        startTime: original.startTime,
        endTime: original.endTime,
        durationMinutes: original.durationMinutes,
        totalMeetings: original.totalMeetings,
        remainingMeetings: original.totalMeetings,
        completedMeetings: 0,
        pricePerStudent: original.pricePerStudent,
        meetingRevenue: original.meetingRevenue,
        studentCount: original.studentCount,
        maxStudents: original.maxStudents,
        sendParentReminders: original.sendParentReminders,
        isOnline: original.isOnline,
        activityType: original.activityType,
        zoomHostId: original.zoomHostId,
        zoomHostEmail: original.zoomHostEmail,
      },
      include: {
        course: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        instructor: { select: { id: true, name: true } },
      },
    });

    // Copy registrations if requested
    if (data.copyRegistrations && original.registrations && Array.isArray(original.registrations)) {
      for (const reg of original.registrations) {
        await prisma.registration.create({
          data: {
            studentId: reg.studentId,
            cycleId: newCycle.id,
            registrationDate: new Date(),
            status: 'registered',
            amount: reg.amount,
            paymentStatus: 'unpaid',
            notes: reg.notes,
          },
        });
      }
    }

    // Generate meetings if requested
    if (data.generateMeetings) {
      await this.generateMeetings(newCycle.id);
    }

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'CREATE',
        entity: 'Cycle',
        entityId: newCycle.id,
        newValue: {
          action: 'duplicate',
          originalCycleId: cycleId,
          copyRegistrations: data.copyRegistrations,
          generateMeetings: data.generateMeetings,
        },
        req,
      });
    }

    // Fetch complete cycle
    return prisma.cycle.findUnique({
      where: { id: newCycle.id },
      include: {
        course: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        instructor: { select: { id: true, name: true } },
        _count: { select: { registrations: true, meetings: true } },
      },
    });
  }

  /**
   * Bulk update multiple cycles
   */
  async bulkUpdate(input: BulkUpdateCyclesInput, req?: Request) {
    const { ids, data } = input;

    // Build update data
    const updateData: Record<string, unknown> = {};
    if (data.status !== undefined) updateData.status = data.status;
    if (data.instructorId !== undefined) updateData.instructorId = data.instructorId;
    if (data.courseId !== undefined) updateData.courseId = data.courseId;
    if (data.branchId !== undefined) updateData.branchId = data.branchId;
    if (data.meetingRevenue !== undefined) updateData.meetingRevenue = data.meetingRevenue;
    if (data.pricePerStudent !== undefined) updateData.pricePerStudent = data.pricePerStudent;
    if (data.studentCount !== undefined) updateData.studentCount = data.studentCount;
    if (data.sendParentReminders !== undefined) updateData.sendParentReminders = data.sendParentReminders;
    if (data.activityType !== undefined) {
      updateData.activityType = data.activityType;
      updateData.isOnline = data.activityType === 'online';
    }

    // Update all cycles in a transaction
    const results = await prisma.$transaction(
      ids.map((id) =>
        prisma.cycle.update({
          where: { id },
          data: updateData,
          select: { id: true, name: true },
        })
      )
    );

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'UPDATE',
        entity: 'Cycle',
        entityId: ids.join(','),
        newValue: { action: 'bulk-update', ids, data },
        req,
      });
    }

    return {
      message: `Updated ${results.length} cycles successfully`,
      updated: results,
    };
  }
}

export const cyclesService = new CyclesService(cyclesRepository);
