import cron from 'node-cron';
import { prisma } from '../utils/prisma.js';
import { sendEmail } from './notifications.js';

// Run on the 1st and 15th of each month at 9:00 AM
export function initCancellationScheduler() {
  cron.schedule('0 9 1,15 * *', async () => {
    console.log('[CANCELLATION] Running bi-monthly cancellation summary...');
    try {
      await sendCancellationSummary();
    } catch (error) {
      console.error('[CANCELLATION] Summary error:', error);
    }
  });

  console.log('[CANCELLATION] Scheduler initialized (1st & 15th of month, 9:00 AM)');
}

async function sendCancellationSummary() {
  const registrations = await prisma.registration.findMany({
    where: { status: 'pending_cancellation' },
    include: {
      student: {
        include: {
          customer: { select: { name: true, phone: true, email: true } },
        },
      },
      cycle: {
        include: {
          course: { select: { name: true } },
        },
      },
    },
    orderBy: { cancellationDate: 'desc' },
  });

  if (registrations.length === 0) {
    console.log('[CANCELLATION] No pending cancellations to report');
    return;
  }

  const rows = registrations.map((reg) => {
    const customer = reg.student.customer;
    const courseName = reg.cycle.course?.name || reg.cycle.name;
    const cancDate = reg.cancellationDate
      ? new Date(reg.cancellationDate).toLocaleDateString('he-IL')
      : '-';
    const crmLink = `http://129.159.133.209:3002/cycles/${reg.cycleId}`;
    const invoiceLink = reg.invoiceLink
      ? `<a href="${reg.invoiceLink}">חשבונית</a>`
      : '-';

    return `
      <tr>
        <td style="padding: 8px; border: 1px solid #e5e7eb;">${reg.student.name}</td>
        <td style="padding: 8px; border: 1px solid #e5e7eb;">${customer?.name || '-'}<br><small>${customer?.phone || ''}</small></td>
        <td style="padding: 8px; border: 1px solid #e5e7eb;">${courseName}</td>
        <td style="padding: 8px; border: 1px solid #e5e7eb;">${cancDate}</td>
        <td style="padding: 8px; border: 1px solid #e5e7eb;">${reg.cancellationReason || '-'}</td>
        <td style="padding: 8px; border: 1px solid #e5e7eb;">${invoiceLink}</td>
        <td style="padding: 8px; border: 1px solid #e5e7eb;"><a href="${crmLink}">צפייה</a></td>
        <td style="padding: 8px; border: 1px solid #e5e7eb;">לפי מדיניות ביטולים</td>
      </tr>`;
  }).join('');

  const html = `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"></head>
<body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; direction: rtl;">
  <div style="max-width: 900px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #1f2937;">📊 סיכום בקשות ביטול - ${new Date().toLocaleDateString('he-IL')}</h2>
    <p style="color: #4b5563;">סה"כ ${registrations.length} בקשות ביטול ממתינות לטיפול:</p>
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px;">
      <thead>
        <tr style="background-color: #f3f4f6;">
          <th style="padding: 10px 8px; border: 1px solid #e5e7eb; text-align: right;">תלמיד/ה</th>
          <th style="padding: 10px 8px; border: 1px solid #e5e7eb; text-align: right;">הורה + טלפון</th>
          <th style="padding: 10px 8px; border: 1px solid #e5e7eb; text-align: right;">קורס</th>
          <th style="padding: 10px 8px; border: 1px solid #e5e7eb; text-align: right;">תאריך ביטול</th>
          <th style="padding: 10px 8px; border: 1px solid #e5e7eb; text-align: right;">סיבה</th>
          <th style="padding: 10px 8px; border: 1px solid #e5e7eb; text-align: right;">חשבונית</th>
          <th style="padding: 10px 8px; border: 1px solid #e5e7eb; text-align: right;">CRM</th>
          <th style="padding: 10px 8px; border: 1px solid #e5e7eb; text-align: right;">החזר</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</body>
</html>`;

  await sendEmail('info@hai.tech', `סיכום בקשות ביטול - ${new Date().toLocaleDateString('he-IL')}`, html);
  console.log(`[CANCELLATION] Summary sent with ${registrations.length} pending cancellations`);
}
