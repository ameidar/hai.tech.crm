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
import { sendWhatsApp } from '../messaging.js';

// Management email list (configure via env or database)
const MANAGEMENT_EMAILS = (process.env.MANAGEMENT_EMAILS || 'ami@hai.tech').split(',');

const TZ = 'Asia/Jerusalem';

// Format date for Hebrew display (always in Israel timezone)
const formatDateHebrew = (date: Date): string => {
  return date.toLocaleDateString('he-IL', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: TZ,
  });
};

const formatTimeHebrew = (date: Date): string => {
  return date.toLocaleTimeString('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ,
  });
};

// Get start-of-day and end-of-day in Israel timezone (returns UTC Date objects for DB queries)
// ⚠️ Use only for DateTime/timestamptz columns (e.g. createdAt, updatedAt)
const getIsraelDayBounds = (offsetDays = 0): { start: Date; end: Date } => {
  const now = new Date();
  // Get Israel date string "YYYY-MM-DD"
  const israelDateStr = new Intl.DateTimeFormat('sv', { timeZone: TZ }).format(now);
  // UTC midnight of that Israel date
  const utcMidnight = new Date(`${israelDateStr}T00:00:00Z`);
  // Get Israel hour at UTC midnight (= Israel offset in hours, e.g. 2 for UTC+2, 3 for UTC+3)
  const israelHourAtUTCMidnight = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }).format(utcMidnight)
  );
  // Israel midnight in UTC = UTC midnight minus Israel offset
  const israelMidnightUTC = new Date(utcMidnight.getTime() - israelHourAtUTCMidnight * 3_600_000);
  const start = new Date(israelMidnightUTC.getTime() + offsetDays * 86_400_000);
  const end   = new Date(start.getTime() + 86_400_000);
  return { start, end };
};

// Get bounds for Prisma @db.Date columns (scheduledDate etc.)
// Prisma converts JS Date → UTC date string for DATE columns.
// So we must pass midnight-UTC of the Israel date string.
// e.g. Israel date "2026-03-19" → new Date("2026-03-19T00:00:00Z") → Prisma sends '2026-03-19' ✓
const getIsraelDateBoundsForDB = (offsetDays = 0): { start: Date; end: Date } => {
  const base = new Date(Date.now() + offsetDays * 86_400_000);
  const dateStr = new Intl.DateTimeFormat('sv', { timeZone: TZ }).format(base);
  // Compute next day by formatting noon UTC + 1 day (safe from DST edge cases)
  const noon = new Date(`${dateStr}T12:00:00.000Z`);
  const nextStr = new Intl.DateTimeFormat('sv', { timeZone: TZ }).format(new Date(noon.getTime() + 86_400_000));
  return {
    start: new Date(`${dateStr}T00:00:00.000Z`),   // → Prisma DATE = 'YYYY-MM-DD'
    end:   new Date(`${nextStr}T00:00:00.000Z`),    // → Prisma DATE = 'YYYY-MM-DD' of next day
  };
};

// Send instructor reminders (08:00 - for today's classes)
const sendInstructorReminders = async () => {
  console.log('📧 Running instructor reminder job...');

  try {
    const { start: today, end: tomorrow } = getIsraelDateBoundsForDB();

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
    const { start: tomorrow, end: dayAfter } = getIsraelDateBoundsForDB(1);

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
    // Use getIsraelDateBoundsForDB() for @db.Date columns (scheduledDate)
    const { start: today, end: tomorrow } = getIsraelDateBoundsForDB();

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
    const { start: day2 } = getIsraelDateBoundsForDB(1);
    const { start: day4 } = getIsraelDateBoundsForDB(3);

    const upcomingMeetings = await prisma.meeting.findMany({
      where: {
        scheduledDate: { gte: day2, lt: day4 },
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

// ─── Daily cycle-near-completion check ────────────────────────────────────────
// Finds active cycles with exactly 1 remaining meeting, notifies instructor via
// WhatsApp and sends a summary email to info@hai.tech.
async function checkCyclesNearCompletion(): Promise<void> {
  console.log('[CycleCheck] Checking cycles with 1 remaining meeting...');
  try {
    const cycles = await prisma.cycle.findMany({
      where: {
        status: 'active',
        remainingMeetings: 1,
      },
      include: {
        course: { select: { name: true } },
        branch: { select: { name: true } },
        instructor: { select: { name: true, phone: true } },
        meetings: {
          where: { status: 'scheduled' },
          orderBy: { scheduledDate: 'asc' },
          take: 1,
        },
      },
    });

    if (cycles.length === 0) {
      console.log('[CycleCheck] No cycles near completion.');
      return;
    }

    console.log(`[CycleCheck] ${cycles.length} cycle(s) with 1 meeting remaining`);

    // Build email table rows
    const cycleRows = cycles
      .map(c => {
        const nextDate = c.meetings[0]
          ? formatDateHebrew(c.meetings[0].scheduledDate)
          : 'לא נמצא תאריך';
        return `<tr>
          <td style="padding:8px;border:1px solid #e5e7eb;">${c.name}</td>
          <td style="padding:8px;border:1px solid #e5e7eb;">${c.course.name}</td>
          <td style="padding:8px;border:1px solid #e5e7eb;">${c.branch?.name || 'אונליין'}</td>
          <td style="padding:8px;border:1px solid #e5e7eb;">${c.instructor.name}</td>
          <td style="padding:8px;border:1px solid #e5e7eb;">${nextDate}</td>
        </tr>`;
      })
      .join('');

    // Send email to management
    await queueEmail({
      to: 'info@hai.tech',
      subject: `🔔 ${cycles.length} מחזורים עם שיעור אחרון לסיום`,
      html: `
        <div dir="rtl" style="font-family:Arial,sans-serif;padding:20px;max-width:700px;">
          <h2 style="color:#2563eb;">🔔 מחזורים עם שיעור אחרון בלבד</h2>
          <p>נמצאו <strong>${cycles.length}</strong> מחזורים פעילים עם שיעור אחד בלבד שנותר לסיום.</p>
          <table style="border-collapse:collapse;width:100%;margin-top:12px;">
            <thead>
              <tr style="background:#f3f4f6;">
                <th style="padding:8px;border:1px solid #e5e7eb;text-align:right;">מחזור</th>
                <th style="padding:8px;border:1px solid #e5e7eb;text-align:right;">קורס</th>
                <th style="padding:8px;border:1px solid #e5e7eb;text-align:right;">סניף</th>
                <th style="padding:8px;border:1px solid #e5e7eb;text-align:right;">מדריך</th>
                <th style="padding:8px;border:1px solid #e5e7eb;text-align:right;">שיעור אחרון</th>
              </tr>
            </thead>
            <tbody>${cycleRows}</tbody>
          </table>
          <p style="color:#6b7280;font-size:12px;margin-top:20px;">
            נשלח אוטומטית מ-HaiTech CRM |
            ${new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}
          </p>
        </div>`,
      priority: EmailPriority.NORMAL,
    });
    console.log('[CycleCheck] Summary email sent to info@hai.tech');

    // Send WhatsApp to each instructor
    for (const cycle of cycles) {
      if (!cycle.instructor.phone) {
        console.warn(`[CycleCheck] No phone for instructor of cycle "${cycle.name}"`);
        continue;
      }
      const nextDateStr = cycle.meetings[0]
        ? ` — ${formatDateHebrew(cycle.meetings[0].scheduledDate)}`
        : '';
      const message =
        `שלום ${cycle.instructor.name} 👋\n\n` +
        `נותר שיעור אחד בלבד לסיום המחזור "${cycle.name}"${nextDateStr}.\n` +
        `אנא וודא שכל פרטי הכיתה מעודכנים לקראת השיעור האחרון 🙏`;
      try {
        await sendWhatsApp({ phone: cycle.instructor.phone, message });
        console.log(`[CycleCheck] WhatsApp sent to ${cycle.instructor.name}`);
      } catch (err) {
        console.error(`[CycleCheck] WhatsApp failed for ${cycle.instructor.name}:`, err);
      }
    }
  } catch (err) {
    console.error('[CycleCheck] Error:', err);
  }
}

// Cron job schedule definitions
const schedules = {
  instructorReminders:      '0 8 * * *',    // 08:00 daily
  parentReminders:          '0 18 * * *',   // 18:00 daily
  managementSummary:        '0 23 * * *',   // 23:00 daily
  monthlyInstructorReport:  '0 8 1 * *',    // 08:00 on 1st of every month
  cyclesNearCompletion:     '0 9 * * *',    // 09:00 daily — cycles with 1 meeting left
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

  // Daily cycle near-completion check (09:00) — 1 meeting remaining
  const cyclesNearCompletionTask = cron.schedule(schedules.cyclesNearCompletion, () => {
    checkCyclesNearCompletion().catch((err: any) =>
      console.error('[CycleCheck] Cron failed:', err)
    );
  }, { timezone: 'Asia/Jerusalem' });
  scheduledTasks.push(cyclesNearCompletionTask);
  console.log('   ✓ Cycles near completion check: 09:00 daily → WhatsApp instructor + email info@hai.tech');

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
export const triggerCyclesNearCompletion = () => checkCyclesNearCompletion();
