import { prisma } from '../../../utils/prisma.js';
import { 
  RevenueReportParams, 
  InstructorPaymentsParams, 
  AttendanceSummaryParams,
  CycleProgressParams 
} from '../validators/reports.js';

/**
 * Revenue summary item
 */
interface RevenueSummaryItem {
  period: string;
  totalRevenue: number;
  totalInstructorPayment: number;
  totalProfit: number;
  meetingCount: number;
}

/**
 * Instructor payment item
 */
interface InstructorPaymentItem {
  instructorId: string;
  instructorName: string;
  totalMeetings: number;
  totalPayment: number;
  completedMeetings: number;
  pendingMeetings: number;
  meetings: {
    id: string;
    date: string;
    cycleName: string;
    payment: number;
    status: string;
  }[];
}

/**
 * Attendance summary item
 */
interface AttendanceSummaryItem {
  id: string;
  name: string;
  totalMeetings: number;
  totalStudents: number;
  presentCount: number;
  absentCount: number;
  lateCount: number;
  attendanceRate: number;
}

/**
 * Cycle progress item
 */
interface CycleProgressItem {
  id: string;
  name: string;
  course: string;
  branch: string;
  instructor: string;
  startDate: Date;
  endDate: Date;
  totalMeetings: number;
  completedMeetings: number;
  remainingMeetings: number;
  progressPercent: number;
  status: string;
  studentCount: number;
}

/**
 * Reports Service - Business logic for reports generation
 */
export class ReportsService {
  /**
   * Generate revenue report
   */
  async getRevenueReport(params: RevenueReportParams) {
    const startDate = new Date(params.startDate);
    const endDate = new Date(params.endDate);
    endDate.setHours(23, 59, 59, 999);

    // Build filter
    const where: any = {
      scheduledDate: {
        gte: startDate,
        lte: endDate,
      },
      status: 'completed',
    };

    if (params.branchId) {
      where.cycle = { branchId: params.branchId };
    }
    if (params.courseId) {
      where.cycle = { ...where.cycle, courseId: params.courseId };
    }
    if (params.instructorId) {
      where.instructorId = params.instructorId;
    }

    // Get meetings with revenue data
    const meetings = await prisma.meeting.findMany({
      where,
      include: {
        cycle: {
          include: {
            course: { select: { id: true, name: true } },
            branch: { select: { id: true, name: true } },
          },
        },
        instructor: { select: { id: true, name: true } },
      },
      orderBy: { scheduledDate: 'asc' },
    });

    // Calculate totals
    const totals = {
      totalRevenue: 0,
      totalInstructorPayment: 0,
      totalProfit: 0,
      meetingCount: meetings.length,
    };

    meetings.forEach(m => {
      totals.totalRevenue += Number(m.revenue) || 0;
      totals.totalInstructorPayment += Number(m.instructorPayment) || 0;
      totals.totalProfit += Number(m.profit) || 0;
    });

    // Group by specified dimension
    const grouped = this.groupMeetings(meetings, params.groupBy, startDate, endDate);

    return {
      period: { startDate: params.startDate, endDate: params.endDate },
      totals,
      breakdown: grouped,
      meetingCount: meetings.length,
    };
  }

  /**
   * Generate instructor payments report
   */
  async getInstructorPayments(params: InstructorPaymentsParams) {
    const startDate = new Date(params.startDate);
    const endDate = new Date(params.endDate);
    endDate.setHours(23, 59, 59, 999);

    // Build filter
    const where: any = {
      scheduledDate: {
        gte: startDate,
        lte: endDate,
      },
    };

    if (params.instructorId) {
      where.instructorId = params.instructorId;
    }

    if (params.status === 'completed') {
      where.status = 'completed';
    } else if (params.status === 'pending') {
      where.status = 'scheduled';
    }

    // Get meetings grouped by instructor
    const meetings = await prisma.meeting.findMany({
      where,
      include: {
        cycle: { select: { name: true } },
        instructor: { select: { id: true, name: true, phone: true, email: true } },
      },
      orderBy: [
        { instructorId: 'asc' },
        { scheduledDate: 'asc' },
      ],
    });

    // Group by instructor
    const instructorMap = new Map<string, InstructorPaymentItem>();

    meetings.forEach(meeting => {
      const instructorId = meeting.instructorId;
      if (!instructorMap.has(instructorId)) {
        instructorMap.set(instructorId, {
          instructorId,
          instructorName: meeting.instructor.name,
          totalMeetings: 0,
          totalPayment: 0,
          completedMeetings: 0,
          pendingMeetings: 0,
          meetings: [],
        });
      }

      const item = instructorMap.get(instructorId)!;
      item.totalMeetings++;
      item.totalPayment += Number(meeting.instructorPayment) || 0;
      
      if (meeting.status === 'completed') {
        item.completedMeetings++;
      } else if (meeting.status === 'scheduled') {
        item.pendingMeetings++;
      }

      item.meetings.push({
        id: meeting.id,
        date: meeting.scheduledDate.toISOString().split('T')[0],
        cycleName: meeting.cycle.name,
        payment: Number(meeting.instructorPayment) || 0,
        status: meeting.status,
      });
    });

    const instructors = Array.from(instructorMap.values());
    const totalPayment = instructors.reduce((sum, i) => sum + i.totalPayment, 0);

    return {
      period: { startDate: params.startDate, endDate: params.endDate },
      totalPayment,
      instructorCount: instructors.length,
      instructors,
    };
  }

  /**
   * Generate attendance summary report
   */
  async getAttendanceSummary(params: AttendanceSummaryParams) {
    const startDate = new Date(params.startDate);
    const endDate = new Date(params.endDate);
    endDate.setHours(23, 59, 59, 999);

    // Build meeting filter
    const meetingWhere: any = {
      scheduledDate: {
        gte: startDate,
        lte: endDate,
      },
      status: 'completed',
    };

    if (params.cycleId) {
      meetingWhere.cycleId = params.cycleId;
    }

    if (params.branchId) {
      meetingWhere.cycle = { branchId: params.branchId };
    }

    // Get attendance records with meeting info
    const attendanceRecords = await prisma.attendance.findMany({
      where: {
        meeting: meetingWhere,
      },
      include: {
        meeting: {
          include: {
            cycle: {
              include: {
                branch: { select: { id: true, name: true } },
              },
            },
          },
        },
        student: { select: { id: true, name: true } },
      },
    });

    // Calculate summary based on groupBy
    let summary: AttendanceSummaryItem[] = [];

    if (params.groupBy === 'cycle') {
      const cycleMap = new Map<string, AttendanceSummaryItem>();
      
      attendanceRecords.forEach(record => {
        const cycleId = record.meeting.cycleId;
        if (!cycleMap.has(cycleId)) {
          cycleMap.set(cycleId, {
            id: cycleId,
            name: record.meeting.cycle.name,
            totalMeetings: 0,
            totalStudents: 0,
            presentCount: 0,
            absentCount: 0,
            lateCount: 0,
            attendanceRate: 0,
          });
        }
        const item = cycleMap.get(cycleId)!;
        this.updateAttendanceCounts(item, record.status);
      });

      summary = Array.from(cycleMap.values()).map(item => ({
        ...item,
        attendanceRate: item.presentCount + item.lateCount > 0 
          ? Math.round(((item.presentCount + item.lateCount) / (item.presentCount + item.absentCount + item.lateCount)) * 100)
          : 0,
      }));
    }

    const totals = {
      totalRecords: attendanceRecords.length,
      presentCount: attendanceRecords.filter(r => r.status === 'present').length,
      absentCount: attendanceRecords.filter(r => r.status === 'absent').length,
      lateCount: attendanceRecords.filter(r => r.status === 'late').length,
    };

    return {
      period: { startDate: params.startDate, endDate: params.endDate },
      totals,
      overallAttendanceRate: totals.totalRecords > 0 
        ? Math.round(((totals.presentCount + totals.lateCount) / totals.totalRecords) * 100)
        : 0,
      summary,
    };
  }

  /**
   * Generate cycle progress report
   */
  async getCycleProgress(params: CycleProgressParams) {
    const where: any = {};

    if (params.status !== 'all') {
      where.status = params.status;
    }

    if (params.branchId) {
      where.branchId = params.branchId;
    }

    if (params.instructorId) {
      where.instructorId = params.instructorId;
    }

    const cycles = await prisma.cycle.findMany({
      where,
      include: {
        course: { select: { name: true } },
        branch: { select: { name: true } },
        instructor: { select: { name: true } },
        _count: { select: { registrations: true } },
      },
      orderBy: { startDate: 'desc' },
    });

    const items: CycleProgressItem[] = cycles.map(cycle => ({
      id: cycle.id,
      name: cycle.name,
      course: cycle.course.name,
      branch: cycle.branch.name,
      instructor: cycle.instructor.name,
      startDate: cycle.startDate,
      endDate: cycle.endDate,
      totalMeetings: cycle.totalMeetings,
      completedMeetings: cycle.completedMeetings,
      remainingMeetings: cycle.remainingMeetings,
      progressPercent: cycle.totalMeetings > 0 
        ? Math.round((cycle.completedMeetings / cycle.totalMeetings) * 100)
        : 0,
      status: cycle.status,
      studentCount: cycle._count.registrations,
    }));

    // Calculate summary stats
    const summary = {
      totalCycles: items.length,
      activeCycles: items.filter(c => c.status === 'active').length,
      completedCycles: items.filter(c => c.status === 'completed').length,
      averageProgress: items.length > 0 
        ? Math.round(items.reduce((sum, c) => sum + c.progressPercent, 0) / items.length)
        : 0,
      totalStudents: items.reduce((sum, c) => sum + c.studentCount, 0),
    };

    return {
      summary,
      cycles: items,
    };
  }

  /**
   * Export report data to CSV
   */
  exportToCSV(data: any[], columns: { key: string; label: string }[]): string {
    // Header row
    const header = columns.map(c => `"${c.label}"`).join(',');
    
    // Data rows
    const rows = data.map(item => {
      return columns.map(col => {
        const value = item[col.key];
        if (value === null || value === undefined) return '""';
        if (typeof value === 'string') return `"${value.replace(/"/g, '""')}"`;
        if (value instanceof Date) return `"${value.toISOString().split('T')[0]}"`;
        return `"${value}"`;
      }).join(',');
    });

    return [header, ...rows].join('\n');
  }

  /**
   * Group meetings by specified dimension
   */
  private groupMeetings(meetings: any[], groupBy: string, _startDate: Date, _endDate: Date): RevenueSummaryItem[] {
    const groupMap = new Map<string, RevenueSummaryItem>();

    meetings.forEach(meeting => {
      let key: string;
      
      switch (groupBy) {
        case 'day':
          key = meeting.scheduledDate.toISOString().split('T')[0];
          break;
        case 'week':
          const weekStart = new Date(meeting.scheduledDate);
          weekStart.setDate(weekStart.getDate() - weekStart.getDay());
          key = weekStart.toISOString().split('T')[0];
          break;
        case 'month':
          key = meeting.scheduledDate.toISOString().slice(0, 7); // YYYY-MM
          break;
        case 'branch':
          key = meeting.cycle.branch.name;
          break;
        case 'course':
          key = meeting.cycle.course.name;
          break;
        case 'instructor':
          key = meeting.instructor.name;
          break;
        default:
          key = 'all';
      }

      if (!groupMap.has(key)) {
        groupMap.set(key, {
          period: key,
          totalRevenue: 0,
          totalInstructorPayment: 0,
          totalProfit: 0,
          meetingCount: 0,
        });
      }

      const item = groupMap.get(key)!;
      item.totalRevenue += Number(meeting.revenue) || 0;
      item.totalInstructorPayment += Number(meeting.instructorPayment) || 0;
      item.totalProfit += Number(meeting.profit) || 0;
      item.meetingCount++;
    });

    return Array.from(groupMap.values()).sort((a, b) => a.period.localeCompare(b.period));
  }

  /**
   * Update attendance counts
   */
  private updateAttendanceCounts(item: AttendanceSummaryItem, status: string) {
    switch (status) {
      case 'present':
        item.presentCount++;
        break;
      case 'absent':
        item.absentCount++;
        break;
      case 'late':
        item.lateCount++;
        break;
    }
  }
}

export const reportsService = new ReportsService();
