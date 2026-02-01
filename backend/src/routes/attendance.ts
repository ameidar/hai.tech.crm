import { Router } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { createAttendanceSchema, updateAttendanceSchema, bulkAttendanceSchema, uuidSchema } from '../types/schemas.js';

export const attendanceRouter = Router();

attendanceRouter.use(authenticate);

// Record single attendance
attendanceRouter.post('/', async (req, res, next) => {
  try {
    const data = createAttendanceSchema.parse(req.body);

    // Verify meeting exists and is today (for instructors)
    const meeting = await prisma.meeting.findUnique({
      where: { id: data.meetingId },
    });

    if (!meeting) {
      throw new AppError(404, 'Meeting not found');
    }

    // Instructors can only record attendance on the meeting day
    if (req.user!.role === 'instructor') {
      const today = new Date().toISOString().split('T')[0];
      const meetingDate = meeting.scheduledDate.toISOString().split('T')[0];
      
      if (today !== meetingDate) {
        throw new AppError(403, 'Can only record attendance on the meeting day');
      }
    }

    // Verify registration exists and belongs to this cycle
    const registration = await prisma.registration.findUnique({
      where: { id: data.registrationId },
    });

    if (!registration || registration.cycleId !== meeting.cycleId) {
      throw new AppError(400, 'Invalid registration for this meeting');
    }

    // Check if attendance already recorded
    const existing = await prisma.attendance.findUnique({
      where: {
        meetingId_registrationId: {
          meetingId: data.meetingId,
          registrationId: data.registrationId,
        },
      },
    });

    if (existing) {
      // Update existing attendance
      const attendance = await prisma.attendance.update({
        where: { id: existing.id },
        data: {
          status: data.status,
          notes: data.notes,
          recordedAt: new Date(),
          recordedById: req.user!.userId,
        },
        include: {
          registration: {
            include: {
              student: { select: { name: true } },
            },
          },
        },
      });
      return res.json(attendance);
    }

    const attendance = await prisma.attendance.create({
      data: {
        meetingId: data.meetingId,
        registrationId: data.registrationId,
        status: data.status,
        notes: data.notes,
        recordedById: req.user!.userId,
      },
      include: {
        registration: {
          include: {
            student: { select: { name: true } },
          },
        },
      },
    });

    res.status(201).json(attendance);
  } catch (error) {
    next(error);
  }
});

// Bulk record attendance for a meeting
attendanceRouter.post('/bulk', async (req, res, next) => {
  try {
    const data = bulkAttendanceSchema.parse(req.body);

    // Verify meeting exists
    const meeting = await prisma.meeting.findUnique({
      where: { id: data.meetingId },
    });

    if (!meeting) {
      throw new AppError(404, 'Meeting not found');
    }

    // Instructors can only record attendance on the meeting day
    if (req.user!.role === 'instructor') {
      const today = new Date().toISOString().split('T')[0];
      const meetingDate = meeting.scheduledDate.toISOString().split('T')[0];
      
      if (today !== meetingDate) {
        throw new AppError(403, 'Can only record attendance on the meeting day');
      }
    }

    // Upsert all attendance records
    const results = await Promise.all(
      data.attendance.map(async (item) => {
        return prisma.attendance.upsert({
          where: {
            meetingId_registrationId: {
              meetingId: data.meetingId,
              registrationId: item.registrationId,
            },
          },
          update: {
            status: item.status,
            notes: item.notes,
            recordedAt: new Date(),
            recordedById: req.user!.userId,
          },
          create: {
            meetingId: data.meetingId,
            registrationId: item.registrationId,
            status: item.status,
            notes: item.notes,
            recordedById: req.user!.userId,
          },
          include: {
            registration: {
              include: {
                student: { select: { name: true } },
              },
            },
          },
        });
      })
    );

    res.json({
      meetingId: data.meetingId,
      recorded: results.length,
      attendance: results,
    });
  } catch (error) {
    next(error);
  }
});

// Update attendance record
attendanceRouter.put('/:id', async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const data = updateAttendanceSchema.parse(req.body);

    const existing = await prisma.attendance.findUnique({
      where: { id },
      include: { meeting: true },
    });

    if (!existing) {
      throw new AppError(404, 'Attendance record not found');
    }

    // Instructors can only update on the meeting day
    if (req.user!.role === 'instructor') {
      const today = new Date().toISOString().split('T')[0];
      const meetingDate = existing.meeting.scheduledDate.toISOString().split('T')[0];
      
      if (today !== meetingDate) {
        throw new AppError(403, 'Can only update attendance on the meeting day');
      }
    }

    const attendance = await prisma.attendance.update({
      where: { id },
      data: {
        ...data,
        recordedAt: new Date(),
        recordedById: req.user!.userId,
      },
      include: {
        registration: {
          include: {
            student: { select: { name: true } },
          },
        },
      },
    });

    res.json(attendance);
  } catch (error) {
    next(error);
  }
});

// Delete attendance record
attendanceRouter.delete('/:id', async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);

    await prisma.attendance.delete({
      where: { id },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Get attendance summary for a student
attendanceRouter.get('/student/:studentId', async (req, res, next) => {
  try {
    const studentId = uuidSchema.parse(req.params.studentId);
    const cycleId = req.query.cycleId as string | undefined;

    const registrations = await prisma.registration.findMany({
      where: {
        studentId,
        ...(cycleId && { cycleId }),
      },
      include: {
        cycle: { select: { id: true, name: true } },
        attendance: {
          include: {
            meeting: {
              select: { scheduledDate: true, status: true },
            },
          },
          orderBy: { recordedAt: 'desc' },
        },
      },
    });

    const summary = registrations.map((reg) => {
      const total = reg.attendance.length;
      const present = reg.attendance.filter((a) => a.status === 'present').length;
      const absent = reg.attendance.filter((a) => a.status === 'absent').length;
      const late = reg.attendance.filter((a) => a.status === 'late').length;

      return {
        registrationId: reg.id,
        cycle: reg.cycle,
        summary: {
          total,
          present,
          absent,
          late,
          attendanceRate: total > 0 ? Math.round((present + late) / total * 100) : 0,
        },
        records: reg.attendance,
      };
    });

    res.json(summary);
  } catch (error) {
    next(error);
  }
});
