import { prisma } from '../utils/prisma.js';
import { zoomService } from './zoom.js';
import { sendEmail } from './email/sender.js';

/**
 * Cycle Completion Service
 * Triggered when remainingMeetings === 0 after a meeting is completed.
 */

export async function handleCycleCompletion(cycleId: string): Promise<void> {
  console.log(`🎓 Starting cycle completion for cycle ${cycleId}`);

  try {
    // Get full cycle data
    const cycle = await prisma.cycle.findUnique({
      where: { id: cycleId },
      include: {
        course: true,
        branch: true,
        instructor: true,
        registrations: {
          include: {
            student: {
              include: { customer: true },
            },
          },
        },
        meetings: true,
      },
    });

    if (!cycle) {
      console.error(`Cycle ${cycleId} not found`);
      return;
    }

    // a. Update cycle status → completed
    await prisma.cycle.update({
      where: { id: cycleId },
      data: { status: 'completed' },
    });
    console.log(`  ✅ Cycle status → completed`);

    // b. Update all active/registered registrations → completed
    const activeRegistrations = cycle.registrations.filter(
      r => ['registered', 'active'].includes(r.status)
    );
    await prisma.registration.updateMany({
      where: {
        cycleId,
        status: { in: ['registered', 'active'] },
      },
      data: { status: 'completed' },
    });
    console.log(`  ✅ ${activeRegistrations.length} registrations → completed`);

    // c. Create upsell_lead for each active registration
    const upsellLeads = activeRegistrations.map(reg => ({
      registrationId: reg.id,
      cycleId,
      customerId: reg.student.customerId,
      completedCourse: cycle.name,
    }));

    if (upsellLeads.length > 0) {
      await prisma.upsellLead.createMany({ data: upsellLeads });
      console.log(`  ✅ ${upsellLeads.length} upsell leads created`);
    }

    // d & e. Delete future meetings (with Zoom cleanup)
    const now = new Date();
    const futureMeetings = cycle.meetings.filter(
      m => m.status === 'scheduled' && m.scheduledDate > now
    );

    for (const meeting of futureMeetings) {
      // Delete Zoom meeting if exists
      if (meeting.zoomMeetingId) {
        try {
          await zoomService.deleteMeeting(meeting.zoomMeetingId);
          console.log(`  🔗 Deleted Zoom meeting ${meeting.zoomMeetingId}`);
        } catch (err: any) {
          console.error(`  ⚠️ Failed to delete Zoom meeting ${meeting.zoomMeetingId}:`, err.message);
        }
      }
    }

    // Delete all future scheduled meetings from DB
    if (futureMeetings.length > 0) {
      await prisma.meeting.deleteMany({
        where: {
          id: { in: futureMeetings.map(m => m.id) },
        },
      });
      console.log(`  ✅ ${futureMeetings.length} future meetings deleted`);
    }

    // f. Send summary email
    await sendCompletionSummaryEmail(cycle, activeRegistrations);

    console.log(`🎓 Cycle completion finished for "${cycle.name}"`);
  } catch (error) {
    console.error(`❌ Cycle completion error for ${cycleId}:`, error);
    throw error;
  }
}

async function sendCompletionSummaryEmail(cycle: any, activeRegistrations: any[]): Promise<void> {
  try {
    // Calculate financial data
    const completedMeetings = cycle.meetings.filter((m: any) => m.status === 'completed');
    const totalRevenue = completedMeetings.reduce((sum: number, m: any) => sum + Number(m.revenue || 0), 0);
    const totalInstructorCost = completedMeetings.reduce((sum: number, m: any) => sum + Number(m.instructorPayment || 0), 0);
    const totalProfit = totalRevenue - totalInstructorCost;

    const allRegistrations = cycle.registrations;
    const cancelledRegistrations = allRegistrations.filter((r: any) => r.status === 'cancelled');
    const cancellationRate = allRegistrations.length > 0
      ? Math.round((cancelledRegistrations.length / allRegistrations.length) * 100)
      : 0;

    const studentsStarted = allRegistrations.length;
    const studentsFinished = activeRegistrations.length;

    // Calculate postponement data
    const postponedMeetings = cycle.meetings.filter((m: any) => m.status === 'postponed');
    const postponementRate = cycle.totalMeetings > 0
      ? Math.round((postponedMeetings.length / cycle.totalMeetings) * 100)
      : 0;

    // Check for instructor changes
    const uniqueInstructors = new Set(cycle.meetings.map((m: any) => m.instructorId));
    const hadInstructorChanges = uniqueInstructors.size > 1;

    // Generate AI insights
    let aiInsights = '';
    try {
      aiInsights = await generateAIInsights({
        cycleName: cycle.name,
        courseName: cycle.course.name,
        branchName: cycle.branch.name,
        instructorName: cycle.instructor.name,
        totalMeetings: cycle.totalMeetings,
        completedMeetings: completedMeetings.length,
        postponedMeetings: postponedMeetings.length,
        totalRevenue,
        totalInstructorCost,
        totalProfit,
        studentsStarted,
        studentsFinished,
        cancellationRate,
        postponementRate,
        hadInstructorChanges,
        uniqueInstructorCount: uniqueInstructors.size,
      });
    } catch (err) {
      console.error('AI insights generation failed:', err);
      aiInsights = '<p>לא ניתן להפיק תובנות AI</p>';
    }

    const html = `
      <div dir="rtl" style="font-family: Arial, sans-serif; padding: 20px; max-width: 700px;">
        <h1 style="color: #2563eb;">🎓 סיכום מחזור שהושלם</h1>
        <h2>${cycle.name}</h2>
        <p><strong>קורס:</strong> ${cycle.course.name} | <strong>סניף:</strong> ${cycle.branch.name} | <strong>מדריך:</strong> ${cycle.instructor.name}</p>
        
        <hr style="border: 1px solid #e5e7eb; margin: 20px 0;" />
        
        <h3>💰 נתונים פיננסיים</h3>
        <table style="border-collapse: collapse; width: 100%;">
          <tr style="background: #f3f4f6;"><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>הכנסה כוללת</strong></td><td style="padding: 8px; border: 1px solid #e5e7eb;">₪${totalRevenue.toLocaleString()}</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>עלויות מדריכים</strong></td><td style="padding: 8px; border: 1px solid #e5e7eb;">₪${totalInstructorCost.toLocaleString()}</td></tr>
          <tr style="background: ${totalProfit >= 0 ? '#dcfce7' : '#fee2e2'};"><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>רווח</strong></td><td style="padding: 8px; border: 1px solid #e5e7eb;">₪${totalProfit.toLocaleString()}</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>אחוז ביטולים</strong></td><td style="padding: 8px; border: 1px solid #e5e7eb;">${cancellationRate}%</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>תלמידים התחילו</strong></td><td style="padding: 8px; border: 1px solid #e5e7eb;">${studentsStarted}</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>תלמידים סיימו</strong></td><td style="padding: 8px; border: 1px solid #e5e7eb;">${studentsFinished}</td></tr>
        </table>
        
        <hr style="border: 1px solid #e5e7eb; margin: 20px 0;" />
        
        <h3>🤖 תובנות AI</h3>
        ${aiInsights}
        
        <hr style="border: 1px solid #e5e7eb; margin: 20px 0;" />
        <p style="color: #6b7280; font-size: 12px;">נשלח אוטומטית מ-HaiTech CRM | ${new Date().toLocaleString('he-IL')}</p>
      </div>
    `;

    await sendEmail({
      to: 'info@hai.tech',
      subject: `🎓 מחזור הושלם: ${cycle.name}`,
      html,
    });
    console.log(`  📧 Summary email sent to info@hai.tech`);
  } catch (err) {
    console.error('  ⚠️ Failed to send summary email:', err);
  }
}

async function generateAIInsights(data: {
  cycleName: string;
  courseName: string;
  branchName: string;
  instructorName: string;
  totalMeetings: number;
  completedMeetings: number;
  postponedMeetings: number;
  totalRevenue: number;
  totalInstructorCost: number;
  totalProfit: number;
  studentsStarted: number;
  studentsFinished: number;
  cancellationRate: number;
  postponementRate: number;
  hadInstructorChanges: boolean;
  uniqueInstructorCount: number;
}): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return '<p>מפתח OpenAI לא מוגדר</p>';
  }

  const prompt = `Analyze this completed education cycle and provide insights in Hebrew. Be concise.

Cycle: ${data.cycleName}
Course: ${data.courseName}
Branch: ${data.branchName}  
Instructor: ${data.instructorName}
Total meetings planned: ${data.totalMeetings}, completed: ${data.completedMeetings}, postponed: ${data.postponedMeetings}
Revenue: ₪${data.totalRevenue}, Instructor cost: ₪${data.totalInstructorCost}, Profit: ₪${data.totalProfit}
Students started: ${data.studentsStarted}, finished: ${data.studentsFinished}
Cancellation rate: ${data.cancellationRate}%, Postponement rate: ${data.postponementRate}%
Instructor changes: ${data.hadInstructorChanges ? `Yes (${data.uniqueInstructorCount} different instructors)` : 'No'}

Provide in Hebrew:
1. Postponement rate assessment
2. Instructor change impact (if any)
3. Anomalies or concerns
4. Overall management score (1-10)
5. 2-3 short recommendations

Format as HTML paragraphs.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 800,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const result = await response.json() as any;
  return result.choices[0]?.message?.content || '<p>לא התקבלו תובנות</p>';
}
