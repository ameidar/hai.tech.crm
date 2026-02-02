import { Router } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { z } from 'zod';

export const attendanceRouter = Router();

attendanceRouter.use(authenticate);

const uuidSchema = z.string().uuid();

// Get attendance for a meeting (with registered students pre-populated)
attendanceRouter.get('/meeting/:meetingId', async (req, res, next) => {
  try {
    const meetingId = uuidSchema.parse(req.params.meetingId);

    // Get the meeting with cycle info
    const meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
      include: {
        cycle: {
          include: {
            registrations: {
              where: {
                status: { in: ['active', 'registered'] },
              },
              include: {
                student: {
                  include: {
                    customer: { select: { name: true, phone: true } },
                  },
                },
              },
            },
          },
        },
        attendance: {
          include: {
            registration: {
              include: {
                student: {
                  include: {
                    customer: { select: { name: true, phone: true } },
                  },
                },
              },
            },
            student: {
              include: {
                customer: { select: { name: true, phone: true } },
              },
            },
          },
        },
      },
    });

    if (!meeting) {
      throw new AppError(404, 'Meeting not found');
    }

    // Type the attendance list
    type AttendanceItem = {
      registrationId: string | null;
      studentId: string | null;
      studentName: string;
      customerName: string | null;
      customerPhone: string | null;
      grade: string | null;
      status: string | null;
      isTrial: boolean;
      notes: string | null;
      attendanceId: string | null;
    };

    // Build attendance list: merge registered students with any existing attendance
    const attendanceMap = new Map<string, typeof meeting.attendance[0]>();
    meeting.attendance.forEach((a) => {
      const key = a.registrationId || a.studentId || a.id;
      if (key) attendanceMap.set(key, a);
    });

    const attendanceList: AttendanceItem[] = meeting.cycle.registrations.map((reg) => {
      const existing = attendanceMap.get(reg.id);
      return {
        registrationId: reg.id,
        studentId: reg.student.id,
        studentName: reg.student.name,
        customerName: reg.student.customer?.name || null,
        customerPhone: reg.student.customer?.phone || null,
        grade: reg.student.grade,
        status: existing?.status || null,
        isTrial: false,
        notes: existing?.notes || null,
        attendanceId: existing?.id || null,
      };
    });

    // Add any trial/guest attendees that aren't in registrations
    meeting.attendance
      .filter((a) => a.isTrial || (!a.registrationId && a.studentId))
      .forEach((a) => {
        if (!attendanceList.find((item) => item.studentId === a.studentId)) {
          attendanceList.push({
            registrationId: null,
            studentId: a.studentId,
            studentName: a.student?.name || a.guestName || 'אורח',
            customerName: a.student?.customer?.name || null,
            customerPhone: a.student?.customer?.phone || null,
            grade: a.student?.grade || null,
            status: a.status,
            isTrial: true,
            notes: a.notes,
            attendanceId: a.id,
          });
        }
      });

    // Add guest attendees (no student record)
    meeting.attendance
      .filter((a) => !a.registrationId && !a.studentId && a.guestName)
      .forEach((a) => {
        attendanceList.push({
          registrationId: null,
          studentId: null,
          studentName: a.guestName || 'אורח',
          customerName: null,
          customerPhone: null,
          grade: null,
          status: a.status,
          isTrial: true,
          notes: a.notes,
          attendanceId: a.id,
        });
      });

    res.json({
      meetingId: meeting.id,
      cycleName: meeting.cycle.name,
      scheduledDate: meeting.scheduledDate,
      attendance: attendanceList,
      stats: {
        total: attendanceList.length,
        present: attendanceList.filter((a) => a.status === 'present').length,
        absent: attendanceList.filter((a) => a.status === 'absent').length,
        late: attendanceList.filter((a) => a.status === 'late').length,
        notMarked: attendanceList.filter((a) => !a.status).length,
        trials: attendanceList.filter((a) => a.isTrial).length,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Record/update attendance for a student
const recordAttendanceSchema = z.object({
  registrationId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
  guestName: z.string().optional(),
  status: z.enum(['present', 'absent', 'late']),
  isTrial: z.boolean().optional(),
  notes: z.string().optional(),
});

attendanceRouter.post('/meeting/:meetingId', async (req, res, next) => {
  try {
    const meetingId = uuidSchema.parse(req.params.meetingId);
    const data = recordAttendanceSchema.parse(req.body);
    const userId = (req.user as any)?.id as string | undefined;

    // Verify meeting exists
    const meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
    });

    if (!meeting) {
      throw new AppError(404, 'Meeting not found');
    }

    if (data.registrationId) {
      const attendance = await prisma.attendance.upsert({
        where: {
          meetingId_registrationId: {
            meetingId,
            registrationId: data.registrationId,
          },
        },
        create: {
          meetingId,
          registrationId: data.registrationId,
          status: data.status,
          isTrial: false,
          notes: data.notes,
          recordedById: userId,
        },
        update: {
          status: data.status,
          notes: data.notes,
          recordedById: userId,
          recordedAt: new Date(),
        },
      });
      return res.json(attendance);
    }

    if (data.studentId) {
      const attendance = await prisma.attendance.upsert({
        where: {
          meetingId_studentId: {
            meetingId,
            studentId: data.studentId,
          },
        },
        create: {
          meetingId,
          studentId: data.studentId,
          status: data.status,
          isTrial: true,
          notes: data.notes,
          recordedById: userId,
        },
        update: {
          status: data.status,
          notes: data.notes,
          recordedById: userId,
          recordedAt: new Date(),
        },
      });
      return res.json(attendance);
    }

    if (data.guestName) {
      // For guests, find existing or create new
      const existingGuest = await prisma.attendance.findFirst({
        where: { meetingId, guestName: data.guestName },
      });

      if (existingGuest) {
        const updated = await prisma.attendance.update({
          where: { id: existingGuest.id },
          data: {
            status: data.status,
            notes: data.notes,
            recordedById: userId,
          },
        });
        return res.json(updated);
      }

      const created = await prisma.attendance.create({
        data: {
          meetingId,
          guestName: data.guestName,
          status: data.status,
          isTrial: true,
          notes: data.notes,
          recordedById: userId,
        },
      });
      return res.status(201).json(created);
    }

    throw new AppError(400, 'Must provide registrationId, studentId, or guestName');
  } catch (error) {
    next(error);
  }
});

// Bulk update attendance
const bulkAttendanceSchema = z.object({
  attendance: z.array(
    z.object({
      registrationId: z.string().uuid().optional(),
      studentId: z.string().uuid().optional(),
      guestName: z.string().optional(),
      status: z.enum(['present', 'absent', 'late']),
      isTrial: z.boolean().optional(),
      notes: z.string().optional(),
    })
  ),
});

attendanceRouter.put('/meeting/:meetingId/bulk', async (req, res, next) => {
  try {
    const meetingId = uuidSchema.parse(req.params.meetingId);
    const { attendance } = bulkAttendanceSchema.parse(req.body);
    const userId = (req.user as any)?.id as string | undefined;

    // Verify meeting exists
    const meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
    });

    if (!meeting) {
      throw new AppError(404, 'Meeting not found');
    }

    // Process each attendance record
    const results = await Promise.all(
      attendance.map(async (record) => {
        if (record.registrationId) {
          return prisma.attendance.upsert({
            where: {
              meetingId_registrationId: {
                meetingId,
                registrationId: record.registrationId,
              },
            },
            create: {
              meetingId,
              registrationId: record.registrationId,
              status: record.status,
              isTrial: false,
              notes: record.notes,
              recordedById: userId,
            },
            update: {
              status: record.status,
              notes: record.notes,
              recordedById: userId,
              recordedAt: new Date(),
            },
          });
        } else if (record.studentId) {
          return prisma.attendance.upsert({
            where: {
              meetingId_studentId: {
                meetingId,
                studentId: record.studentId,
              },
            },
            create: {
              meetingId,
              studentId: record.studentId,
              status: record.status,
              isTrial: true,
              notes: record.notes,
              recordedById: userId,
            },
            update: {
              status: record.status,
              notes: record.notes,
              recordedById: userId,
              recordedAt: new Date(),
            },
          });
        } else if (record.guestName) {
          const existing = await prisma.attendance.findFirst({
            where: { meetingId, guestName: record.guestName },
          });

          if (existing) {
            return prisma.attendance.update({
              where: { id: existing.id },
              data: {
                status: record.status,
                notes: record.notes,
                recordedById: userId,
                recordedAt: new Date(),
              },
            });
          }

          return prisma.attendance.create({
            data: {
              meetingId,
              guestName: record.guestName,
              status: record.status,
              isTrial: true,
              notes: record.notes,
              recordedById: userId,
            },
          });
        }
        return null;
      })
    );

    res.json({ updated: results.filter(Boolean).length });
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

// Search students to add as trial (students not registered in this cycle)
attendanceRouter.get('/meeting/:meetingId/search-students', async (req, res, next) => {
  try {
    const meetingId = uuidSchema.parse(req.params.meetingId);
    const search = (req.query.search as string) || '';

    if (search.length < 2) {
      return res.json([]);
    }

    // Get the meeting to find the cycle
    const meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { cycleId: true },
    });

    if (!meeting) {
      throw new AppError(404, 'Meeting not found');
    }

    // Find students not registered in this cycle
    const students = await prisma.student.findMany({
      where: {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { customer: { name: { contains: search, mode: 'insensitive' } } },
          { customer: { phone: { contains: search } } },
        ],
        NOT: {
          registrations: {
            some: {
              cycleId: meeting.cycleId,
              status: { in: ['active', 'registered'] },
            },
          },
        },
      },
      include: {
        customer: { select: { name: true, phone: true } },
      },
      take: 10,
    });

    res.json(
      students.map((s) => ({
        id: s.id,
        name: s.name,
        grade: s.grade,
        customerName: s.customer.name,
        customerPhone: s.customer.phone,
      }))
    );
  } catch (error) {
    next(error);
  }
});
