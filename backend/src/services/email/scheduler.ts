import cron, { ScheduledTask } from 'node-cron';
import { prisma } from '../../utils/prisma.js';
import { queueEmail, EmailPriority } from './queue.js';
import { 
  getTemplate, 
  InstructorReminderData, 
  ParentReminderData, 
  ManagementSummaryData 
} from './templates.js';

// Management email list (configure via env or database)
const MANAGEMENT_EMAILS = (process.env.MANAGEMENT_EMAILS || 'ami@hai.tech').split(',');

// Format date for Hebrew display
const formatDateHebrew = (date: Date): string => {
  return date.toLocaleDateString('he-IL', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

const formatTimeHebrew = (date: Date): string => {
  return date.toLocaleTimeString('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

// Send instructor reminders (08:00 - for today's classes)
const sendInstructorReminders = async () => {
  console.log('📧 Running instructor reminder job...');

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Get today's meetings with instructors
    const meetings = await prisma.meeting.findMany({
      where: {
        startTime: {
          gte: today,
          lt: tomorrow,
        },
        status: 'scheduled',
      },
      include: {
        cycle: {
          include: {
            course: true,
            instructor: true,
            branch: true,
            registrations: {
              where: { status: 'active' },
            },
          },
        },
      },
    });

    console.log(`Found ${meetings.length} meetings for today`);

    for (const meeting of meetings) {
      const instructor = meeting.cycle.instructor;
      if (!instructor?.email) continue;

      const data: InstructorReminderData = {
        instructorName: instructor.name,
        className: meeting.cycle.course.name,
        date: formatDateHebrew(meeting.startTime),
        time: formatTimeHebrew(meeting.startTime),
        location: meeting.cycle.branch?.name || 'אונליין',
        studentCount: meeting.cycle.registrations.length,
        zoomLink: meeting.zoomJoinUrl || undefined,
      };

      await queueEmail({
        to: instructor.email,
        subject: `🎓 תזכורת: שיעור ${data.className} היום ב-${data.time}`,
        html: getTemplate('instructor-reminder', data),
        priority: EmailPriority.HIGH,
        templateId: 'instructor-reminder',
        metadata: { meetingId: meeting.id, instructorId: instructor.id },
      });
    }

    console.log(`✅ Queued ${meetings.length} instructor reminders`);
  } catch (error) {
    console.error('❌ Error sending instructor reminders:', error);
  }
};

// Send parent reminders (18:00 - for tomorrow's classes)
const sendParentReminders = async () => {
  console.log('📧 Running parent reminder job...');

  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const dayAfter = new Date(tomorrow);
    dayAfter.setDate(dayAfter.getDate() + 1);

    // Get tomorrow's meetings with students
    const meetings = await prisma.meeting.findMany({
      where: {
        startTime: {
          gte: tomorrow,
          lt: dayAfter,
        },
        status: 'scheduled',
      },
      include: {
        cycle: {
          include: {
            course: true,
            instructor: true,
            branch: true,
            registrations: {
              where: { status: 'active' },
              include: {
                student: {
                  include: {
                    customer: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    console.log(`Found ${meetings.length} meetings for tomorrow`);

    let emailCount = 0;
    for (const meeting of meetings) {
      for (const registration of meeting.cycle.registrations) {
        const student = registration.student;
        const parent = student.customer;
        
        if (!parent?.email) continue;

        const isOnline = !meeting.cycle.branch;
        
        const data: ParentReminderData = {
          parentName: parent.name,
          studentName: student.name,
          className: meeting.cycle.course.name,
          date: formatDateHebrew(meeting.startTime),
          time: formatTimeHebrew(meeting.startTime),
          location: meeting.cycle.branch?.name || 'אונליין',
          instructorName: meeting.cycle.instructor?.name || 'צוות HaiTech',
          isOnline,
          zoomLink: isOnline ? meeting.zoomJoinUrl || undefined : undefined,
        };

        await queueEmail({
          to: parent.email,
          subject: `📚 תזכורת: ל-${data.studentName} יש שיעור ${data.className} מחר`,
          html: getTemplate('parent-reminder', data),
          priority: EmailPriority.NORMAL,
          templateId: 'parent-reminder',
          metadata: { meetingId: meeting.id, studentId: student.id },
        });

        emailCount++;
      }
    }

    console.log(`✅ Queued ${emailCount} parent reminders`);
  } catch (error) {
    console.error('❌ Error sending parent reminders:', error);
  }
};

// Send management daily summary (22:00)
const sendManagementSummary = async () => {
  console.log('📧 Running management summary job...');

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Get today's stats
    const [todayMeetings, completedMeetings, cancelledMeetings, attendanceRecords] = await Promise.all([
      prisma.meeting.count({
        where: {
          startTime: { gte: today, lt: tomorrow },
        },
      }),
      prisma.meeting.count({
        where: {
          startTime: { gte: today, lt: tomorrow },
          status: 'completed',
        },
      }),
      prisma.meeting.count({
        where: {
          startTime: { gte: today, lt: tomorrow },
          status: 'cancelled',
        },
      }),
      prisma.attendance.count({
        where: {
          meeting: {
            startTime: { gte: today, lt: tomorrow },
          },
          status: 'present',
        },
      }),
    ]);

    // Get upcoming classes (next 3 days)
    const threeDaysLater = new Date(today);
    threeDaysLater.setDate(threeDaysLater.getDate() + 3);

    const upcomingMeetings = await prisma.meeting.findMany({
      where: {
        startTime: { gte: tomorrow, lt: threeDaysLater },
        status: 'scheduled',
      },
      include: {
        cycle: {
          include: {
            course: true,
            instructor: true,
            registrations: { where: { status: 'active' } },
          },
        },
      },
      take: 10,
      orderBy: { startTime: 'asc' },
    });

    // Calculate attendance rate
    const totalExpectedAttendance = await prisma.attendance.count({
      where: {
        meeting: {
          startTime: { gte: today, lt: tomorrow },
        },
      },
    });
    const attendanceRate = totalExpectedAttendance > 0 
      ? Math.round((attendanceRecords / totalExpectedAttendance) * 100) 
      : 0;

    // Build alerts
    const alerts: string[] = [];
    if (cancelledMeetings > 0) {
      alerts.push(`${cancelledMeetings} שיעורים בוטלו היום`);
    }
    if (attendanceRate < 70 && totalExpectedAttendance > 0) {
      alerts.push(`אחוז נוכחות נמוך: ${attendanceRate}%`);
    }

    const data: ManagementSummaryData = {
      date: formatDateHebrew(today),
      totalClasses: todayMeetings,
      completedClasses: completedMeetings,
      cancelledClasses: cancelledMeetings,
      totalStudents: attendanceRecords,
      attendanceRate,
      upcomingClasses: upcomingMeetings.map(m => ({
        name: m.cycle.course.name,
        date: formatDateHebrew(m.startTime),
        instructor: m.cycle.instructor?.name || 'לא משויך',
        students: m.cycle.registrations.length,
      })),
      alerts,
    };

    // Send to all management emails
    for (const email of MANAGEMENT_EMAILS) {
      await queueEmail({
        to: email.trim(),
        subject: `📊 סיכום יומי - HaiTech CRM - ${formatDateHebrew(today)}`,
        html: getTemplate('management-summary', data),
        priority: EmailPriority.LOW,
        templateId: 'management-summary',
        metadata: { reportDate: today.toISOString() },
      });
    }

    console.log(`✅ Queued management summary to ${MANAGEMENT_EMAILS.length} recipients`);
  } catch (error) {
    console.error('❌ Error sending management summary:', error);
  }
};

// Cron job schedule definitions
const schedules = {
  instructorReminders: '0 8 * * *',    // 08:00 daily
  parentReminders: '0 18 * * *',       // 18:00 daily
  managementSummary: '0 22 * * *',     // 22:00 daily
};

// Scheduled tasks
let scheduledTasks: ScheduledTask[] = [];

// Initialize scheduler
export const initEmailScheduler = () => {
  console.log('📅 Initializing email scheduler...');

  // Clear any existing tasks
  scheduledTasks.forEach(task => task.stop());
  scheduledTasks = [];

  // Schedule instructor reminders (08:00)
  const instructorTask = cron.schedule(schedules.instructorReminders, () => {
    sendInstructorReminders();
  }, { timezone: 'Asia/Jerusalem' });
  scheduledTasks.push(instructorTask);
  console.log('   ✓ Instructor reminders: 08:00 daily');

  // Schedule parent reminders (18:00)
  const parentTask = cron.schedule(schedules.parentReminders, () => {
    sendParentReminders();
  }, { timezone: 'Asia/Jerusalem' });
  scheduledTasks.push(parentTask);
  console.log('   ✓ Parent reminders: 18:00 daily');

  // Schedule management summary (22:00)
  const summaryTask = cron.schedule(schedules.managementSummary, () => {
    sendManagementSummary();
  }, { timezone: 'Asia/Jerusalem' });
  scheduledTasks.push(summaryTask);
  console.log('   ✓ Management summary: 22:00 daily');

  console.log('📅 Email scheduler initialized');
};

// Stop scheduler
export const stopEmailScheduler = () => {
  scheduledTasks.forEach(task => task.stop());
  scheduledTasks = [];
  console.log('📅 Email scheduler stopped');
};

// Manual triggers for testing
export const triggerInstructorReminders = () => sendInstructorReminders();
export const triggerParentReminders = () => sendParentReminders();
export const triggerManagementSummary = () => sendManagementSummary();
