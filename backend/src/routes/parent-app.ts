// ==========================================
// HaiTech CRM - Parent App API Routes
// ==========================================
// These routes are for the parent mobile app

import { Router } from 'express';
import jwt, { SignOptions } from 'jsonwebtoken';
import { prisma } from '../utils/prisma.js';
import { config } from '../config.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

// JWT Configuration for parent tokens
const PARENT_JWT_SECRET = process.env.PARENT_JWT_SECRET || config.jwt.secret;
const PARENT_REFRESH_SECRET = process.env.PARENT_REFRESH_SECRET || config.jwt.refreshSecret;
const accessTokenOptions: SignOptions = { expiresIn: '7d' };
const refreshTokenOptions: SignOptions = { expiresIn: '30d' };

// OTP Storage (in production, use Redis)
const otpStore = new Map<string, { code: string; expiresAt: number }>();

// Generate 6-digit OTP
const generateOtp = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Middleware to verify parent token
const authenticateParent = async (req: any, res: any, next: any) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError(401, 'Missing authorization token');
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, PARENT_JWT_SECRET) as { customerId: string };

    const customer = await prisma.customer.findUnique({
      where: { id: decoded.customerId },
    });

    if (!customer) {
      throw new AppError(401, 'Invalid token');
    }

    req.parent = customer;
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return next(new AppError(401, 'Invalid token'));
    }
    next(error);
  }
};

// ==========================================
// Authentication Routes
// ==========================================

// Request OTP
router.post('/otp/request', async (req, res, next) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      throw new AppError(400, 'Phone number is required');
    }

    // Normalize phone number
    const normalizedPhone = phone.replace(/\D/g, '');

    // Check if customer exists
    const customer = await prisma.customer.findFirst({
      where: {
        phone: {
          contains: normalizedPhone.slice(-9), // Last 9 digits
        },
      },
    });

    if (!customer) {
      throw new AppError(404, 'מספר הטלפון לא נמצא במערכת. אנא פנו לתמיכה.');
    }

    // Generate OTP
    const otp = generateOtp();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

    // Store OTP
    otpStore.set(normalizedPhone, { code: otp, expiresAt });

    // In production, send OTP via SMS
    // For now, log it (REMOVE IN PRODUCTION)
    console.log(`[PARENT_APP] OTP for ${normalizedPhone}: ${otp}`);

    // TODO: Integrate with SMS provider (e.g., Twilio, SMS Gateway)
    // await sendSms(normalizedPhone, `קוד האימות שלך לדרך ההייטק: ${otp}`);

    res.json({
      success: true,
      message: 'קוד אימות נשלח בהצלחה',
    });
  } catch (error) {
    next(error);
  }
});

// Verify OTP and login
router.post('/otp/verify', async (req, res, next) => {
  try {
    const { phone, code } = req.body;

    if (!phone || !code) {
      throw new AppError(400, 'Phone and code are required');
    }

    const normalizedPhone = phone.replace(/\D/g, '');
    const storedOtp = otpStore.get(normalizedPhone);

    if (!storedOtp) {
      throw new AppError(400, 'קוד לא נמצא. אנא בקשו קוד חדש.');
    }

    if (Date.now() > storedOtp.expiresAt) {
      otpStore.delete(normalizedPhone);
      throw new AppError(400, 'הקוד פג תוקף. אנא בקשו קוד חדש.');
    }

    if (storedOtp.code !== code) {
      throw new AppError(400, 'קוד שגוי');
    }

    // Clear OTP
    otpStore.delete(normalizedPhone);

    // Find customer
    const customer = await prisma.customer.findFirst({
      where: {
        phone: {
          contains: normalizedPhone.slice(-9),
        },
      },
      include: {
        students: true,
      },
    });

    if (!customer) {
      throw new AppError(404, 'Customer not found');
    }

    // Generate tokens
    const payload = { customerId: customer.id };
    const accessToken = jwt.sign(payload, PARENT_JWT_SECRET, accessTokenOptions);
    const refreshToken = jwt.sign(payload, PARENT_REFRESH_SECRET, refreshTokenOptions);

    res.json({
      accessToken,
      refreshToken,
      parent: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        address: customer.address,
        city: customer.city,
        children: customer.students,
      },
      isNewUser: false,
    });
  } catch (error) {
    next(error);
  }
});

// Refresh token
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      throw new AppError(400, 'Refresh token required');
    }

    const decoded = jwt.verify(refreshToken, PARENT_REFRESH_SECRET) as { customerId: string };

    const customer = await prisma.customer.findUnique({
      where: { id: decoded.customerId },
    });

    if (!customer) {
      throw new AppError(401, 'Invalid refresh token');
    }

    const payload = { customerId: customer.id };
    const accessToken = jwt.sign(payload, PARENT_JWT_SECRET, accessTokenOptions);

    res.json({ accessToken });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return next(new AppError(401, 'Invalid refresh token'));
    }
    next(error);
  }
});

// Logout (acknowledge)
router.post('/logout', authenticateParent, (_req, res) => {
  res.json({ message: 'Logged out successfully' });
});

// ==========================================
// Profile Routes
// ==========================================

// Get parent profile
router.get('/profile', authenticateParent, async (req: any, res, next) => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: req.parent.id },
      include: {
        students: {
          include: {
            registrations: {
              where: {
                status: { in: ['registered', 'active'] },
              },
              include: {
                cycle: {
                  include: {
                    course: true,
                    branch: true,
                    instructor: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    res.json({
      id: customer!.id,
      name: customer!.name,
      email: customer!.email,
      phone: customer!.phone,
      address: customer!.address,
      city: customer!.city,
      children: customer!.students,
    });
  } catch (error) {
    next(error);
  }
});

// Update profile
router.put('/profile', authenticateParent, async (req: any, res, next) => {
  try {
    const { name, email, address, city } = req.body;

    const updated = await prisma.customer.update({
      where: { id: req.parent.id },
      data: {
        ...(name && { name }),
        ...(email && { email }),
        ...(address && { address }),
        ...(city && { city }),
      },
    });

    res.json({
      id: updated.id,
      name: updated.name,
      email: updated.email,
      phone: updated.phone,
      address: updated.address,
      city: updated.city,
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// Children Routes
// ==========================================

// Get all children
router.get('/children', authenticateParent, async (req: any, res, next) => {
  try {
    const children = await prisma.student.findMany({
      where: { customerId: req.parent.id },
      include: {
        registrations: {
          where: { status: { in: ['registered', 'active', 'completed'] } },
          include: {
            cycle: {
              include: {
                course: true,
                branch: true,
                instructor: true,
              },
            },
          },
        },
        attendance: {
          orderBy: { recordedAt: 'desc' },
          take: 30,
        },
      },
    });

    // Calculate attendance stats for each child
    const childrenWithStats = await Promise.all(
      children.map(async (child) => {
        const stats = await calculateAttendanceStats(child.id);
        return {
          ...child,
          enrollments: child.registrations,
          attendanceStats: stats,
        };
      })
    );

    res.json(childrenWithStats);
  } catch (error) {
    next(error);
  }
});

// Get single child
router.get('/children/:childId', authenticateParent, async (req: any, res, next) => {
  try {
    const { childId } = req.params;

    const child = await prisma.student.findFirst({
      where: {
        id: childId,
        customerId: req.parent.id,
      },
      include: {
        registrations: {
          include: {
            cycle: {
              include: {
                course: true,
                branch: true,
                instructor: true,
              },
            },
          },
        },
      },
    });

    if (!child) {
      throw new AppError(404, 'Child not found');
    }

    const stats = await calculateAttendanceStats(childId);

    res.json({
      ...child,
      enrollments: child.registrations,
      attendanceStats: stats,
    });
  } catch (error) {
    next(error);
  }
});

// Get child's enrollments
router.get('/children/:childId/enrollments', authenticateParent, async (req: any, res, next) => {
  try {
    const { childId } = req.params;

    // Verify child belongs to parent
    const child = await prisma.student.findFirst({
      where: {
        id: childId,
        customerId: req.parent.id,
      },
    });

    if (!child) {
      throw new AppError(404, 'Child not found');
    }

    const enrollments = await prisma.registration.findMany({
      where: { studentId: childId },
      include: {
        cycle: {
          include: {
            course: true,
            branch: true,
            instructor: true,
          },
        },
      },
      orderBy: { registrationDate: 'desc' },
    });

    res.json(enrollments);
  } catch (error) {
    next(error);
  }
});

// Get child's attendance
router.get('/children/:childId/attendance', authenticateParent, async (req: any, res, next) => {
  try {
    const { childId } = req.params;

    const child = await prisma.student.findFirst({
      where: {
        id: childId,
        customerId: req.parent.id,
      },
    });

    if (!child) {
      throw new AppError(404, 'Child not found');
    }

    const attendance = await prisma.attendance.findMany({
      where: { studentId: childId },
      include: {
        meeting: {
          include: {
            cycle: {
              include: { course: true },
            },
          },
        },
      },
      orderBy: { recordedAt: 'desc' },
    });

    res.json(attendance);
  } catch (error) {
    next(error);
  }
});

// Get child's attendance stats
router.get('/children/:childId/attendance/stats', authenticateParent, async (req: any, res, next) => {
  try {
    const { childId } = req.params;

    const child = await prisma.student.findFirst({
      where: {
        id: childId,
        customerId: req.parent.id,
      },
    });

    if (!child) {
      throw new AppError(404, 'Child not found');
    }

    const stats = await calculateAttendanceStats(childId);
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

// ==========================================
// Schedule Routes
// ==========================================

// Get schedule for date range
router.get('/schedule', authenticateParent, async (req: any, res, next) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      throw new AppError(400, 'Start date and end date are required');
    }

    // Get all children for this parent
    const children = await prisma.student.findMany({
      where: { customerId: req.parent.id },
      select: { id: true, name: true },
    });

    const childIds = children.map((c) => c.id);
    const childMap = new Map(children.map((c) => [c.id, c.name]));

    // Get all meetings for the date range
    const registrations = await prisma.registration.findMany({
      where: {
        studentId: { in: childIds },
        status: { in: ['registered', 'active'] },
      },
      select: { studentId: true, cycleId: true },
    });

    const cycleIds = [...new Set(registrations.map((r) => r.cycleId))];
    const cycleStudentMap = new Map<string, string[]>();
    registrations.forEach((r) => {
      const existing = cycleStudentMap.get(r.cycleId) || [];
      existing.push(r.studentId);
      cycleStudentMap.set(r.cycleId, existing);
    });

    const meetings = await prisma.meeting.findMany({
      where: {
        cycleId: { in: cycleIds },
        scheduledDate: {
          gte: new Date(startDate as string),
          lte: new Date(endDate as string),
        },
        status: { in: ['scheduled', 'completed'] },
      },
      include: {
        cycle: {
          include: {
            course: true,
            branch: true,
          },
        },
        instructor: true,
      },
      orderBy: [{ scheduledDate: 'asc' }, { startTime: 'asc' }],
    });

    // Group by date
    const scheduleByDate = new Map<string, any[]>();
    
    meetings.forEach((meeting) => {
      const dateStr = meeting.scheduledDate.toISOString().split('T')[0];
      const studentIds = cycleStudentMap.get(meeting.cycleId) || [];

      studentIds.forEach((studentId) => {
        const existing = scheduleByDate.get(dateStr) || [];
        existing.push({
          ...meeting,
          childName: childMap.get(studentId),
          courseName: meeting.cycle.course.name,
          branchName: meeting.cycle.branch.name,
        });
        scheduleByDate.set(dateStr, existing);
      });
    });

    // Convert to array format
    const schedule = Array.from(scheduleByDate.entries()).map(([date, meetings]) => ({
      date,
      dayOfWeek: new Date(date).toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase(),
      meetings,
    }));

    res.json(schedule);
  } catch (error) {
    next(error);
  }
});

// Get upcoming meetings
router.get('/meetings/upcoming', authenticateParent, async (req: any, res, next) => {
  try {
    const limit = parseInt(req.query.limit as string) || 5;

    const children = await prisma.student.findMany({
      where: { customerId: req.parent.id },
      select: { id: true, name: true },
    });

    const childIds = children.map((c) => c.id);
    const childMap = new Map(children.map((c) => [c.id, c.name]));

    const registrations = await prisma.registration.findMany({
      where: {
        studentId: { in: childIds },
        status: { in: ['registered', 'active'] },
      },
      select: { studentId: true, cycleId: true },
    });

    const cycleIds = [...new Set(registrations.map((r) => r.cycleId))];
    const cycleStudentMap = new Map<string, string>();
    registrations.forEach((r) => {
      cycleStudentMap.set(r.cycleId, r.studentId);
    });

    const meetings = await prisma.meeting.findMany({
      where: {
        cycleId: { in: cycleIds },
        scheduledDate: { gte: new Date() },
        status: 'scheduled',
      },
      include: {
        cycle: {
          include: {
            course: true,
            branch: true,
          },
        },
        instructor: true,
      },
      orderBy: [{ scheduledDate: 'asc' }, { startTime: 'asc' }],
      take: limit,
    });

    const result = meetings.map((meeting) => {
      const studentId = cycleStudentMap.get(meeting.cycleId);
      return {
        ...meeting,
        childName: studentId ? childMap.get(studentId) : undefined,
        courseName: meeting.cycle.course.name,
        branchName: meeting.cycle.branch.name,
      };
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get single meeting
router.get('/meetings/:meetingId', authenticateParent, async (req: any, res, next) => {
  try {
    const { meetingId } = req.params;

    const meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
      include: {
        cycle: {
          include: {
            course: true,
            branch: true,
          },
        },
        instructor: true,
      },
    });

    if (!meeting) {
      throw new AppError(404, 'Meeting not found');
    }

    // Verify parent has access to this meeting
    const children = await prisma.student.findMany({
      where: { customerId: req.parent.id },
      select: { id: true },
    });

    const childIds = children.map((c) => c.id);

    const hasAccess = await prisma.registration.findFirst({
      where: {
        studentId: { in: childIds },
        cycleId: meeting.cycleId,
      },
    });

    if (!hasAccess) {
      throw new AppError(403, 'Access denied');
    }

    res.json(meeting);
  } catch (error) {
    next(error);
  }
});

// ==========================================
// Enrollments Routes
// ==========================================

// Get all enrollments
router.get('/enrollments', authenticateParent, async (req: any, res, next) => {
  try {
    const children = await prisma.student.findMany({
      where: { customerId: req.parent.id },
      select: { id: true },
    });

    const childIds = children.map((c) => c.id);

    const enrollments = await prisma.registration.findMany({
      where: { studentId: { in: childIds } },
      include: {
        student: true,
        cycle: {
          include: {
            course: true,
            branch: true,
            instructor: true,
          },
        },
      },
      orderBy: { registrationDate: 'desc' },
    });

    res.json(enrollments);
  } catch (error) {
    next(error);
  }
});

// ==========================================
// Dashboard Stats
// ==========================================

router.get('/dashboard', authenticateParent, async (req: any, res, next) => {
  try {
    const children = await prisma.student.findMany({
      where: { customerId: req.parent.id },
      select: { id: true },
    });

    const childIds = children.map((c) => c.id);

    // Count active enrollments
    const activeEnrollments = await prisma.registration.count({
      where: {
        studentId: { in: childIds },
        status: { in: ['registered', 'active'] },
      },
    });

    // Count upcoming meetings
    const upcomingMeetings = await prisma.meeting.count({
      where: {
        cycle: {
          registrations: {
            some: {
              studentId: { in: childIds },
              status: { in: ['registered', 'active'] },
            },
          },
        },
        scheduledDate: { gte: new Date() },
        status: 'scheduled',
      },
    });

    // Calculate average attendance rate
    const totalAttendance = await prisma.attendance.count({
      where: { studentId: { in: childIds } },
    });

    const presentAttendance = await prisma.attendance.count({
      where: {
        studentId: { in: childIds },
        status: { in: ['present', 'late'] },
      },
    });

    const attendanceRate = totalAttendance > 0
      ? Math.round((presentAttendance / totalAttendance) * 100)
      : 0;

    res.json({
      totalChildren: children.length,
      activeEnrollments,
      upcomingMeetings,
      attendanceRate,
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// Notifications Routes
// ==========================================

router.get('/notifications', authenticateParent, async (req: any, res, next) => {
  try {
    // For now, return empty array
    // In production, implement notification storage
    res.json({
      data: [],
      pagination: {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
        hasNext: false,
        hasPrev: false,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// Helper Functions
// ==========================================

async function calculateAttendanceStats(studentId: string) {
  const attendance = await prisma.attendance.findMany({
    where: { studentId },
    orderBy: { recordedAt: 'desc' },
  });

  const totalMeetings = attendance.length;
  const attended = attendance.filter((a) => a.status === 'present').length;
  const absent = attendance.filter((a) => a.status === 'absent').length;
  const late = attendance.filter((a) => a.status === 'late').length;
  const attendanceRate = totalMeetings > 0 ? ((attended + late) / totalMeetings) * 100 : 0;

  // Calculate current streak
  let currentStreak = 0;
  for (const record of attendance) {
    if (record.status === 'present' || record.status === 'late') {
      currentStreak++;
    } else {
      break;
    }
  }

  return {
    totalMeetings,
    attended,
    absent,
    late,
    attendanceRate: Math.round(attendanceRate),
    currentStreak,
  };
}

export const parentAppRouter = router;
export default router;
