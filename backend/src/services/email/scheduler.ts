import cron, { ScheduledTask } from 'node-cron';
import { prisma } from '../../utils/prisma.js';
import { queueEmail, EmailPriority } from './queue.js';
import {
  sendMorningWhatsAppReminders,
  sendMorningUnresolvedAlert,
  sendPreMeetingReminders,
  sendEveningStatusCheck,
} from '../whatsapp-reminder.service.js';
import { 
  getTemplate, 
  InstructorReminderData, 
  ParentReminderData, 
  ManagementSummaryData 
} from './templates.js';
import { buildInstructorMonthlyReport, getPreviousMonth } from '../instructorReport.service.js';
import { generateInstructorReportExcel } from '../../utils/excelReportGenerator.js';
import { sendInstructorMonthlyReportEmail } from './instructorReportEmail.js';
import { updateVapiAssistantDate } from '../vapi.js';

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
        scheduledDate: {
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
        date: formatDateHebrew(meeting.scheduledDate),
        time: meeting.startTime ? formatTimeHebrew(meeting.startTime as unknown as Date) : '',
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
        scheduledDate: {
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
          date: formatDateHebrew(meeting.scheduledDate),
          time: meeting.startTime ? formatTimeHebrew(meeting.startTime as unknown as Date) : '',
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

// Send management daily summary (23:00)
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
          scheduledDate: { gte: today, lt: tomorrow },
        },
      }),
      prisma.meeting.count({
        where: {
          scheduledDate: { gte: today, lt: tomorrow },
          status: 'completed',
        },
      }),
      prisma.meeting.count({
        where: {
          scheduledDate: { gte: today, lt: tomorrow },
          status: 'cancelled',
        },
      }),
      prisma.attendance.count({
        where: {
          meeting: {
            scheduledDate: { gte: today, lt: tomorrow },
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
        scheduledDate: { gte: tomorrow, lt: threeDaysLater },
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
      orderBy: { scheduledDate: 'asc' },
    });

    // Calculate attendance rate
    const totalExpectedAttendance = await prisma.attendance.count({
      where: {
        meeting: {
          scheduledDate: { gte: today, lt: tomorrow },
        },
      },
    });
    const attendanceRate = totalExpectedAttendance > 0 
      ? Math.round((attendanceRecords / totalExpectedAttendance) * 100) 
      : 0;

    // Fetch financial data for today
    const financialData = await prisma.meeting.aggregate({
      where: {
        scheduledDate: { gte: today, lt: tomorrow },
        status: 'completed',
      },
      _sum: {
        revenue: true,
        instructorPayment: true,
        profit: true,
      },
    });
    const totalRevenue = Number(financialData._sum.revenue ?? 0);
    const totalInstructorPayment = Number(financialData._sum.instructorPayment ?? 0);
    const totalProfit = Number(financialData._sum.profit ?? 0);
    const profitMargin = totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 100) : 0;
    const revenuePerClass = completedMeetings > 0 ? Math.round(totalRevenue / completedMeetings) : 0;

    // Build alerts
    const alerts: string[] = [];
    if (cancelledMeetings > 0) {
      alerts.push(`${cancelledMeetings} שיעורים בוטלו היום`);
    }
    if (attendanceRate < 70 && totalExpectedAttendance > 0) {
      alerts.push(`אחוז נוכחות נמוך: ${attendanceRate}%`);
    }
    const postponedMeetings = await prisma.meeting.count({
      where: { scheduledDate: { gte: today, lt: tomorrow }, status: 'postponed' },
    });
    if (postponedMeetings > 0) {
      alerts.push(`${postponedMeetings} שיעורים נדחו`);
    }

    // Build insights
    const insights: string[] = [];
    if (attendanceRate >= 85) {
      insights.push(`✅ נוכחות מצוינת היום — ${attendanceRate}%. שיא של מחויבות!`);
    } else if (attendanceRate >= 70) {
      insights.push(`👍 נוכחות טובה — ${attendanceRate}%. יש מקום לשיפור קל.`);
    }
    if (profitMargin > 0) {
      insights.push(`💰 מרווח רווח של ${profitMargin}% — ממוצע ₪${revenuePerClass.toLocaleString('he-IL')} לשיעור.`);
    }
    if (postponedMeetings > 0) {
      const lostRevenue = Math.round(revenuePerClass * postponedMeetings);
      insights.push(`⏳ ${postponedMeetings} שיעורים נדחו — הכנסה פוטנציאלית שנדחתה: ~₪${lostRevenue.toLocaleString('he-IL')}.`);
    }
    if (completedMeetings === todayMeetings - cancelledMeetings - postponedMeetings && completedMeetings > 0) {
      insights.push(`🎯 כל השיעורים המתוכננים הושלמו בהצלחה.`);
    }

    const data: ManagementSummaryData = {
      date: formatDateHebrew(today),
      totalClasses: todayMeetings,
      completedClasses: completedMeetings,
      cancelledClasses: cancelledMeetings,
      totalStudents: attendanceRecords,
      attendanceRate,
      totalRevenue,
      totalInstructorPayment,
      totalProfit,
      insights,
      upcomingClasses: upcomingMeetings.map(m => ({
        name: m.cycle.course.name,
        date: formatDateHebrew(m.scheduledDate),
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

// ─── Monthly instructor activity report ────────────────────────────────────────
const sendMonthlyInstructorReport = async () => {
  console.log('📊 Running monthly instructor report job...');
  try {
    const month = getPreviousMonth();
    const report = await buildInstructorMonthlyReport(month);
    if (report.instructors.length === 0) {
      console.log(`📊 No completed meetings found for ${report.monthLabel} — skipping report`);
      return;
    }
    const buf = await generateInstructorReportExcel(report);
    await sendInstructorMonthlyReportEmail(report, buf);
    console.log(`✅ Monthly instructor report sent for ${report.monthLabel}`);
  } catch (err) {
    console.error('❌ Monthly instructor report failed:', err);
  }
};

// Cron job schedule definitions
const schedules = {
  instructorReminders:      '0 8 * * *',    // 08:00 daily
  parentReminders:          '0 18 * * *',   // 18:00 daily
  managementSummary:        '0 23 * * *',   // 23:00 daily
  monthlyInstructorReport:  '0 8 1 * *',    // 08:00 on 1st of every month
};

// Scheduled tasks
let scheduledTasks: ScheduledTask[] = [];

// Initialize scheduler
export const initEmailScheduler = () => {
  console.log('📅 Initializing email scheduler...');

  // Clear any existing tasks
  scheduledTasks.forEach(task => task.stop());
  scheduledTasks = [];

  // Schedule instructor reminders (08:00) — email + WhatsApp + unresolved alert
  const instructorTask = cron.schedule(schedules.instructorReminders, () => {
    sendInstructorReminders();
    sendMorningWhatsAppReminders();
    sendMorningUnresolvedAlert(); // alert management about yesterday's unresolved meetings
  }, { timezone: 'Asia/Jerusalem' });
  scheduledTasks.push(instructorTask);
  console.log('   ✓ Instructor reminders (email + WhatsApp): 08:00 daily');
  console.log('   ✓ Unresolved meetings alert to management: 08:00 daily');

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
  console.log('   ✓ Management summary: 23:00 daily');

  // Schedule pre-meeting WhatsApp reminders (every 15 min)
  const preMeetingTask = cron.schedule('*/15 * * * *', () => {
    sendPreMeetingReminders();
  }, { timezone: 'Asia/Jerusalem' });
  scheduledTasks.push(preMeetingTask);
  console.log('   ✓ Pre-meeting WhatsApp reminders: every 15 min');

  // Schedule evening status check (22:00) — WhatsApp poll to instructors
  const eveningStatusTask = cron.schedule('0 22 * * *', () => {
    sendEveningStatusCheck();
  }, { timezone: 'Asia/Jerusalem' });
  scheduledTasks.push(eveningStatusTask);
  console.log('   ✓ Evening status check (WhatsApp poll): 22:00 daily');

  // Schedule monthly instructor report (08:00 on 1st of every month)
  const monthlyReportTask = cron.schedule(schedules.monthlyInstructorReport, () => {
    sendMonthlyInstructorReport();
  }, { timezone: 'Asia/Jerusalem' });
  scheduledTasks.push(monthlyReportTask);
  console.log('   ✓ Monthly instructor report: 08:00 on 1st of month → hila@hai.tech, ami@hai.tech, inna@hai.tech');

  // Update VAPI assistant date daily at 00:01 Israel time
  const vapiDateTask = cron.schedule('1 0 * * *', () => {
    updateVapiAssistantDate().catch((err: any) =>
      console.error('[VAPI] Date update cron failed:', err)
    );
  }, { timezone: 'Asia/Jerusalem' });
  scheduledTasks.push(vapiDateTask);
  console.log('   ✓ VAPI assistant date update: 00:01 daily');

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
export const triggerMorningWhatsApp = () => sendMorningWhatsAppReminders();
export const triggerMorningUnresolvedAlert = () => sendMorningUnresolvedAlert();
export const triggerPreMeetingWhatsApp = () => sendPreMeetingReminders();
export const triggerEveningStatusCheck = () => sendEveningStatusCheck();
export const triggerMonthlyInstructorReport = () => sendMonthlyInstructorReport();
