import { sendEmail } from './sender.js';
import type { InstructorMonthlyReport } from '../instructorReport.service.js';

// Default recipients
const DEFAULT_RECIPIENTS = [
  'hila@hai.tech',
  'ami@hai.tech',
  'inna@hai.tech',
];

function buildEmailHtml(report: InstructorMonthlyReport): string {
  const rows = report.instructors.map(i => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#1e293b">${i.instructorName}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;text-align:center;color:#374151">${i.totalMeetings}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;text-align:center;color:#374151">${i.totalHours.toFixed(1)}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;text-align:center;color:#374151">₪${i.totalPayment.toLocaleString('he-IL', { minimumFractionDigits: 2 })}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;text-align:center;color:#374151">${i.totalExpenses > 0 ? '₪' + i.totalExpenses.toLocaleString('he-IL', { minimumFractionDigits: 2 }) : '—'}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:700;color:#1e40af">₪${i.grandTotal.toLocaleString('he-IL', { minimumFractionDigits: 2 })}</td>
    </tr>
  `).join('');

  return `
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>דוח פעילות מדריכים — ${report.monthLabel}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;direction:rtl">
  <div style="max-width:680px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08)">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#1e40af 0%,#2563eb 100%);padding:32px 36px;text-align:center">
      <div style="font-size:28px;font-weight:800;color:#fff;letter-spacing:-0.5px">דרך ההייטק</div>
      <div style="font-size:18px;color:#bfdbfe;margin-top:6px">דוח פעילות מדריכים</div>
      <div style="font-size:22px;font-weight:700;color:#fff;margin-top:4px">${report.monthLabel}</div>
    </div>

    <!-- Summary cards -->
    <div style="display:flex;gap:16px;padding:24px 36px;background:#f0f9ff">
      <div style="flex:1;background:#fff;border-radius:10px;padding:16px;text-align:center;border:1px solid #bfdbfe">
        <div style="font-size:28px;font-weight:700;color:#1e40af">${report.instructors.length}</div>
        <div style="color:#64748b;font-size:13px;margin-top:4px">מדריכים</div>
      </div>
      <div style="flex:1;background:#fff;border-radius:10px;padding:16px;text-align:center;border:1px solid #bfdbfe">
        <div style="font-size:28px;font-weight:700;color:#1e40af">${report.instructors.reduce((s,i)=>s+i.totalMeetings,0)}</div>
        <div style="color:#64748b;font-size:13px;margin-top:4px">פגישות</div>
      </div>
      <div style="flex:1;background:#fff;border-radius:10px;padding:16px;text-align:center;border:1px solid #bfdbfe">
        <div style="font-size:24px;font-weight:700;color:#1e40af">₪${report.summaryGrandTotal.toLocaleString('he-IL',{minimumFractionDigits:2})}</div>
        <div style="color:#64748b;font-size:13px;margin-top:4px">סה"כ לתשלום</div>
      </div>
    </div>

    <!-- Table -->
    <div style="padding:0 36px 28px">
      <table style="width:100%;border-collapse:collapse;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06)">
        <thead>
          <tr style="background:#1e40af">
            <th style="padding:12px 14px;text-align:right;color:#fff;font-size:13px;font-weight:700">מדריך</th>
            <th style="padding:12px 14px;text-align:center;color:#fff;font-size:13px;font-weight:700">פגישות</th>
            <th style="padding:12px 14px;text-align:center;color:#fff;font-size:13px;font-weight:700">שעות</th>
            <th style="padding:12px 14px;text-align:center;color:#fff;font-size:13px;font-weight:700">תשלום</th>
            <th style="padding:12px 14px;text-align:center;color:#fff;font-size:13px;font-weight:700">הוצאות</th>
            <th style="padding:12px 14px;text-align:center;color:#fff;font-size:13px;font-weight:700">סה"כ</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
          <tr style="background:#eff6ff">
            <td colspan="3" style="padding:12px 14px;font-weight:700;color:#1e40af;font-size:14px">סה"כ כולל</td>
            <td style="padding:12px 14px;text-align:center;font-weight:700;color:#1e40af">₪${report.summaryTotalPayment.toLocaleString('he-IL',{minimumFractionDigits:2})}</td>
            <td style="padding:12px 14px;text-align:center;font-weight:700;color:#1e40af">₪${report.summaryTotalExpenses.toLocaleString('he-IL',{minimumFractionDigits:2})}</td>
            <td style="padding:12px 14px;text-align:center;font-weight:800;color:#1e40af;font-size:16px">₪${report.summaryGrandTotal.toLocaleString('he-IL',{minimumFractionDigits:2})}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Unresolved meetings alert -->
    ${report.unresolvedMeetings && report.unresolvedMeetings.length > 0 ? `
    <div style="margin:0 36px 24px;padding:20px;background:#FEF2F2;border-radius:10px;border-right:4px solid #B91C1C">
      <div style="font-weight:700;color:#B91C1C;font-size:15px;margin-bottom:12px">
        ⚠️ ${report.unresolvedMeetings.length} פגישות ללא סטטוס — דורשות בדיקה
      </div>
      <div style="color:#7F1D1D;font-size:13px;margin-bottom:10px">
        הפגישות הבאות תוכננו בחודש הדוח אך נשארו בסטטוס "מתוכנן":
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:#B91C1C">
            <th style="padding:8px;text-align:right;color:#fff">תאריך</th>
            <th style="padding:8px;text-align:right;color:#fff">שעה</th>
            <th style="padding:8px;text-align:right;color:#fff">מדריך</th>
            <th style="padding:8px;text-align:right;color:#fff">קורס</th>
          </tr>
        </thead>
        <tbody>
          ${report.unresolvedMeetings.map((m, i) => `
            <tr style="background:${i % 2 === 0 ? '#FFF7ED' : '#fff'}">
              <td style="padding:7px 10px;border-bottom:1px solid #FEE2E2">${new Date(m.date).toLocaleDateString('he-IL')}</td>
              <td style="padding:7px 10px;border-bottom:1px solid #FEE2E2">${m.startTime}</td>
              <td style="padding:7px 10px;border-bottom:1px solid #FEE2E2;font-weight:600">${m.instructorName}</td>
              <td style="padding:7px 10px;border-bottom:1px solid #FEE2E2">${m.cycleName}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div style="margin-top:10px;color:#92400E;font-size:12px">
        📋 הפגישות המלאות מפורטות בלשונית "⚠️ פגישות ללא סטטוס" בקובץ ה-Excel המצורף
      </div>
    </div>
    ` : `
    <div style="margin:0 36px 24px;padding:16px;background:#D1FAE5;border-radius:10px;border-right:4px solid #059669;text-align:center;color:#064E3B;font-weight:600;font-size:13px">
      ✅ כל הפגישות בחודש זה קיבלו עדכון סטטוס — אין פגישות פתוחות
    </div>
    `}

    <!-- Note -->
    <div style="padding:0 36px 24px;color:#64748b;font-size:13px;text-align:center">
      הפירוט המלא מצורף כקובץ Excel לאימייל זה
    </div>

    <!-- Footer -->
    <div style="background:#f8fafc;padding:18px 36px;text-align:center;border-top:1px solid #e5e7eb">
      <div style="color:#94a3b8;font-size:12px">
        הופק אוטומטית ב-${report.generatedAt.toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'})} · HaiTech CRM
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Send the instructor monthly report email with the Excel file attached.
 */
export async function sendInstructorMonthlyReportEmail(
  report: InstructorMonthlyReport,
  excelBuffer: Buffer,
  recipients?: string[],
): Promise<void> {
  const to = (recipients && recipients.length > 0) ? recipients : DEFAULT_RECIPIENTS;
  const filename = `דוח_מדריכים_${report.monthLabel.replace(' ', '_')}.xlsx`;

  await sendEmail({
    to,
    subject: `📊 דוח פעילות מדריכים — ${report.monthLabel}`,
    html: buildEmailHtml(report),
    attachments: [
      {
        filename,
        content: excelBuffer,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    ],
  });

  console.log(`✅ Instructor report email sent to ${to.join(', ')} for ${report.monthLabel}`);
}
