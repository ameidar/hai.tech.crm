import { prisma } from '../utils/prisma.js';
import { sendWhatsApp } from './messaging.js';

const ALERT_PHONE = process.env.ALERT_PHONE || '972528746137';

function formatDbDate(date: Date): string {
  return date.toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' });
}

function money(value: unknown): number {
  return Number(value || 0);
}

export async function checkAndSendNegativeProfitAlert(
  meetingId: string,
  source = 'unknown',
): Promise<void> {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: {
      instructor: { select: { name: true } },
      cycle: {
        include: {
          course: { select: { name: true } },
          branch: { select: { name: true } },
        },
      },
    },
  });

  if (!meeting) return;

  const profit = money(meeting.profit);

  if (meeting.status !== 'completed' || profit >= 0) {
    if (meeting.negativeProfitAlertSentAt) {
      await prisma.meeting.update({
        where: { id: meetingId },
        data: { negativeProfitAlertSentAt: null },
      });
    }
    return;
  }

  if (meeting.negativeProfitAlertSentAt) return;

  const revenue = money(meeting.revenue);
  const instructorPayment = money(meeting.instructorPayment);
  const expensesTotal = Math.max(0, revenue - instructorPayment - profit);

  const message = `⚠️ התראה: רווח שלילי בפגישה

📅 תאריך: ${formatDbDate(meeting.scheduledDate)}
📚 מחזור: ${meeting.cycle?.name || ''}
🎓 קורס: ${meeting.cycle?.course?.name || ''}
🏢 סניף: ${meeting.cycle?.branch?.name || 'אונליין'}
👨‍🏫 מדריך: ${meeting.instructor?.name || ''}

💰 הכנסה: ₪${revenue}
💸 עלות מדריך: ₪${instructorPayment}
${expensesTotal > 0 ? `🧾 הוצאות: ₪${expensesTotal}\n` : ''}📉 רווח: ₪${profit}

מקור חישוב: ${source}`;

  const result = await sendWhatsApp({ phone: ALERT_PHONE, message });
  if (!result.success) {
    console.error(`[NegativeProfitAlert] send failed for meeting ${meetingId}: ${result.error}`);
    return;
  }

  await prisma.meeting.update({
    where: { id: meetingId },
    data: { negativeProfitAlertSentAt: new Date() },
  });
  console.log(`[NegativeProfitAlert] sent for meeting ${meetingId} from ${source}`);
}
