import { prisma } from '../utils/prisma.js';
import { sendWhatsApp } from './messaging.js';
import { getOperationsWhatsAppRecipients } from './operations-notifications.js';

const EXTRA_RECIPIENTS = [
  { name: 'אינה', phone: '0524486208' },
];

function money(value: number): string {
  return `₪${value.toLocaleString('he-IL', { maximumFractionDigits: 2 })}`;
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.01;
}

export async function checkAndSendInstitutionalOrderCompletionAlert(
  institutionalOrderId: string | null | undefined,
  source = 'unknown',
): Promise<void> {
  if (!institutionalOrderId) return;

  const order = await prisma.institutionalOrder.findUnique({
    where: { id: institutionalOrderId },
    include: {
      cycles: {
        where: { deletedAt: null },
        select: {
          id: true,
          name: true,
          status: true,
          totalMeetings: true,
          meetingRevenue: true,
        },
        orderBy: { startDate: 'asc' },
      },
    },
  });

  if (!order || order.completionAlertSentAt) return;
  if (order.cycles.length === 0) return;
  if (order.cycles.some((cycle) => cycle.status !== 'completed')) return;

  const cycleIds = order.cycles.map((cycle) => cycle.id);
  const meetings = await prisma.meeting.findMany({
    where: {
      cycleId: { in: cycleIds },
      deletedAt: null,
      status: 'completed',
    },
    select: {
      cycleId: true,
      revenue: true,
    },
  });

  const orderTotal = Number(order.totalAmount ?? order.estimatedTotal ?? 0);
  const meetingRevenueTotal = meetings.reduce((sum, meeting) => sum + Number(meeting.revenue ?? 0), 0);
  const cyclesTotal = order.cycles.reduce(
    (sum, cycle) => sum + (Number(cycle.totalMeetings) * Number(cycle.meetingRevenue ?? 0)),
    0,
  );
  const matches = nearlyEqual(orderTotal, meetingRevenueTotal);

  const meetingCountByCycle = new Map<string, number>();
  const revenueByCycle = new Map<string, number>();
  for (const meeting of meetings) {
    meetingCountByCycle.set(meeting.cycleId, (meetingCountByCycle.get(meeting.cycleId) ?? 0) + 1);
    revenueByCycle.set(meeting.cycleId, (revenueByCycle.get(meeting.cycleId) ?? 0) + Number(meeting.revenue ?? 0));
  }

  const cycleLines = order.cycles
    .map((cycle) => {
      const expected = Number(cycle.totalMeetings) * Number(cycle.meetingRevenue ?? 0);
      const actual = revenueByCycle.get(cycle.id) ?? 0;
      const completedMeetings = meetingCountByCycle.get(cycle.id) ?? 0;
      return `• ${cycle.name}: ${cycle.totalMeetings} × ${money(Number(cycle.meetingRevenue ?? 0))} = ${money(expected)} | בפועל ${completedMeetings} מפגשים = ${money(actual)}`;
    })
    .join('\n');

  const diff = meetingRevenueTotal - orderTotal;
  const message = `✅ הזמנה מוסדית הסתיימה: ${order.orderName ?? order.orderNumber ?? order.id}

כל המחזורים המשויכים להזמנה הושלמו.

פירוט מחזורים:
${cycleLines}

סה״כ לפי מחזורים: ${money(cyclesTotal)}
סה״כ הכנסות מפגשים: ${money(meetingRevenueTotal)}
סה״כ הזמנה מוסדית: ${money(orderTotal)}

סטטוס התאמה: ${matches ? '✅ יש התאמה מלאה' : `⚠️ אין התאמה. הפרש: ${money(diff)}`}
מקור בדיקה: ${source}`;

  const results = await Promise.all(
    getOperationsWhatsAppRecipients(EXTRA_RECIPIENTS).map(async (recipient) => {
      const result = await sendWhatsApp({ phone: recipient.phone, message });
      if (!result.success) {
        console.error(`[institutional-order-completion] WhatsApp to ${recipient.name} failed: ${result.error}`);
      }
      return result.success;
    }),
  );

  if (results.every(Boolean)) {
    await prisma.institutionalOrder.update({
      where: { id: institutionalOrderId },
      data: {
        completionAlertSentAt: new Date(),
        status: 'completed',
      },
    });
    console.log(`[institutional-order-completion] Alert sent for order ${institutionalOrderId}`);
  }
}
