// Email template types
export type TemplateId = 
  | 'instructor-reminder'
  | 'parent-reminder'
  | 'management-summary'
  | 'newsletter';

// Base URL from environment
const getBaseUrl = () => process.env.FRONTEND_URL || 'https://crm.orma-ai.com';

// Template data interfaces
export interface InstructorReminderData {
  instructorName: string;
  className: string;
  date: string;
  time: string;
  location: string;
  studentCount: number;
  zoomLink?: string;
  meetingId?: string;
  remainingMeetings?: number;
  totalMeetings?: number;
  completedMeetings?: number;
}

export interface ParentReminderData {
  parentName: string;
  studentName: string;
  className: string;
  date: string;
  time: string;
  location: string;
  instructorName: string;
  isOnline: boolean;
  zoomLink?: string;
}

export interface ManagementSummaryData {
  date: string;
  totalClasses: number;
  completedClasses: number;
  cancelledClasses: number;
  totalStudents: number;
  attendanceRate: number;
  // Financial — from meetings
  totalRevenue?: number;
  totalInstructorPayment?: number;
  totalProfit?: number;
  // WooCommerce payments (digital courses, Passover camp, private courses)
  wooPayments?: {
    count: number;
    total: number;
    payments: Array<{ customerName: string; amount: number; description: string }>;
  };
  // Insights
  insights?: string[];
  upcomingClasses: Array<{
    name: string;
    date: string;
    instructor: string;
    students: number;
  }>;
  alerts: string[];
}

export interface NewsletterData {
  title: string;
  content: string;
  ctaText?: string;
  ctaLink?: string;
}

// Common styles
const baseStyles = `
  <style>
    body { font-family: Arial, 'Helvetica Neue', sans-serif; line-height: 1.6; color: #1f2937; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
    .header h1 { margin: 0; font-size: 24px; }
    .content { background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; }
    .footer { background: #f9fafb; padding: 20px; text-align: center; border-radius: 0 0 8px 8px; border: 1px solid #e5e7eb; border-top: none; }
    .btn { display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; }
    .btn:hover { background: #1d4ed8; }
    .info-box { background: #eff6ff; border-right: 4px solid #2563eb; padding: 15px; margin: 15px 0; border-radius: 4px; }
    .alert { background: #fef2f2; border-right: 4px solid #ef4444; padding: 15px; margin: 10px 0; border-radius: 4px; color: #991b1b; }
    .success { background: #f0fdf4; border-right: 4px solid #22c55e; padding: 15px; margin: 10px 0; border-radius: 4px; color: #166534; }
    table { width: 100%; border-collapse: collapse; margin: 15px 0; }
    th, td { padding: 12px; text-align: right; border-bottom: 1px solid #e5e7eb; }
    th { background: #f9fafb; font-weight: bold; }
  </style>
`;

// Instructor reminder template (same-day morning reminder)
export const instructorReminderTemplate = (data: InstructorReminderData): string => `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8">
  ${baseStyles}
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎓 תזכורת שיעור - היום</h1>
    </div>
    <div class="content">
      <p>שלום ${data.instructorName},</p>
      <p>זוהי תזכורת לשיעור שמתקיים <strong>היום</strong>:</p>
      
      <div class="info-box">
        <p><strong>📚 קורס:</strong> ${data.className}</p>
        <p><strong>📅 תאריך:</strong> ${data.date}</p>
        <p><strong>🕐 שעה:</strong> ${data.time}</p>
        <p><strong>📍 מיקום:</strong> ${data.location}</p>
        <p><strong>👥 מספר תלמידים:</strong> ${data.studentCount}</p>
        ${data.remainingMeetings !== undefined ? `
        <p><strong>📊 התקדמות:</strong> שיעור ${(data.completedMeetings || 0) + 1} מתוך ${data.totalMeetings || '?'} | נותרו <strong>${data.remainingMeetings}</strong> שיעורים</p>
        ` : ''}
      </div>
      
      ${data.zoomLink ? `
      <div class="success">
        <p><strong>🔗 קישור לזום:</strong></p>
        <p><a href="${data.zoomLink}" class="btn">כניסה לשיעור</a></p>
      </div>
      ` : ''}
      
      ${data.meetingId ? `
      <div style="background: #f0fdf4; border-right: 4px solid #22c55e; padding: 15px; margin: 15px 0; border-radius: 4px; text-align: center;">
        <p><strong>📝 עדכון סטטוס הפגישה:</strong></p>
        <p><a href="${getBaseUrl()}/meetings/${data.meetingId}" class="btn" style="background: #22c55e;">עדכן סטטוס פגישה</a></p>
      </div>
      ` : ''}
      
      <p>אנא וודא/י שהכל מוכן לשיעור. בהצלחה! 🌟</p>
    </div>
    <div class="footer">
      <p style="color: #6b7280; font-size: 12px;">
        HaiTech - בית הספר לקוד<br>
        מייל זה נשלח אוטומטית
      </p>
    </div>
  </div>
</body>
</html>
`;

// Parent reminder template (day before)
export const parentReminderTemplate = (data: ParentReminderData): string => `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8">
  ${baseStyles}
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📚 תזכורת שיעור - ${data.studentName}</h1>
    </div>
    <div class="content">
      <p>שלום ${data.parentName},</p>
      <p>תזכורת ל-${data.studentName} - יש שיעור <strong>מחר</strong>:</p>
      
      <div class="info-box">
        <p><strong>📚 קורס:</strong> ${data.className}</p>
        <p><strong>📅 תאריך:</strong> ${data.date}</p>
        <p><strong>🕐 שעה:</strong> ${data.time}</p>
        <p><strong>📍 מיקום:</strong> ${data.isOnline ? 'שיעור אונליין (זום)' : data.location}</p>
        <p><strong>👨‍🏫 מדריך/ה:</strong> ${data.instructorName}</p>
      </div>
      
      ${data.isOnline && data.zoomLink ? `
      <div class="success">
        <p><strong>🔗 קישור לשיעור:</strong></p>
        <p><a href="${data.zoomLink}" class="btn">כניסה לזום</a></p>
        <p style="font-size: 12px; color: #6b7280;">מומלץ להיכנס 5 דקות לפני תחילת השיעור</p>
      </div>
      ` : ''}
      
      <p>נשמח לראות את ${data.studentName} בשיעור! 🚀</p>
    </div>
    <div class="footer">
      <p style="color: #6b7280; font-size: 12px;">
        HaiTech - בית הספר לקוד<br>
        לשאלות: info@hai.tech
      </p>
    </div>
  </div>
</body>
</html>
`;

// Format currency in ILS
const formatCurrency = (amount: number): string =>
  '₪' + amount.toLocaleString('he-IL', { maximumFractionDigits: 0 });

// Management daily summary template
export const managementSummaryTemplate = (data: ManagementSummaryData): string => `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8">
  ${baseStyles}
  <style>
    .financial-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 20px; margin: 20px 0; }
    .woo-box { background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 8px; padding: 20px; margin: 20px 0; }
    .woo-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f3e8ff; font-size: 14px; }
    .financial-grid { display: flex; gap: 12px; flex-wrap: wrap; }
    .financial-item { flex: 1; min-width: 140px; background: white; border-radius: 6px; padding: 14px; text-align: center; border: 1px solid #e5e7eb; }
    .financial-item .label { font-size: 12px; color: #6b7280; margin-bottom: 6px; }
    .financial-item .value { font-size: 20px; font-weight: bold; }
    .revenue { color: #16a34a; }
    .expense { color: #dc2626; }
    .profit { color: #2563eb; }
    .insight-box { background: #eff6ff; border-right: 4px solid #2563eb; padding: 14px 18px; margin: 8px 0; border-radius: 4px; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📊 סיכום יומי - ${data.date}</h1>
    </div>
    <div class="content">

      <h2>📋 סטטיסטיקות היום</h2>
      <table>
        <tr><th>מדד</th><th>ערך</th></tr>
        <tr><td>סה"כ שיעורים</td><td><strong>${data.totalClasses}</strong></td></tr>
        <tr><td>שיעורים שהתקיימו</td><td style="color:#16a34a"><strong>${data.completedClasses}</strong> ✅</td></tr>
        <tr><td>שיעורים שבוטלו</td><td style="color:#dc2626">${data.cancelledClasses} ❌</td></tr>
        <tr><td>תלמידים שהשתתפו</td><td>${data.totalStudents}</td></tr>
        <tr><td>אחוז נוכחות</td><td><strong>${data.attendanceRate}%</strong></td></tr>
      </table>

      ${(data.totalRevenue !== undefined) ? `
      <h2>💰 נתונים כספיים</h2>
      <div class="financial-box">
        <div class="financial-grid">
          <div class="financial-item">
            <div class="label">הכנסות</div>
            <div class="value revenue">${formatCurrency(data.totalRevenue!)}</div>
          </div>
          <div class="financial-item">
            <div class="label">תשלומי מדריכים</div>
            <div class="value expense">${formatCurrency(data.totalInstructorPayment!)}</div>
          </div>
          <div class="financial-item">
            <div class="label">רווח נקי</div>
            <div class="value profit">${formatCurrency(data.totalProfit!)}</div>
          </div>
          <div class="financial-item">
            <div class="label">מרווח רווח</div>
            <div class="value profit">${data.totalRevenue! > 0 ? Math.round((data.totalProfit! / data.totalRevenue!) * 100) : 0}%</div>
          </div>
        </div>
        <p style="font-size:12px;color:#6b7280;margin:10px 0 0">
          ממוצע הכנסה לשיעור: ${data.completedClasses > 0 ? formatCurrency(Math.round(data.totalRevenue! / data.completedClasses)) : '—'}
        </p>
      </div>
      ` : ''}

      ${data.wooPayments && data.wooPayments.count > 0 ? `
      <h2>🛒 רכישות אונליין היום (${data.wooPayments.count})</h2>
      <div class="woo-box">
        <div class="financial-grid" style="margin-bottom:14px">
          <div class="financial-item">
            <div class="label">מספר רכישות</div>
            <div class="value revenue">${data.wooPayments.count}</div>
          </div>
          <div class="financial-item">
            <div class="label">סה"כ הכנסות אונליין</div>
            <div class="value revenue">${formatCurrency(data.wooPayments.total)}</div>
          </div>
        </div>
        ${data.wooPayments.payments.map(p => `
        <div class="woo-row">
          <span>${p.customerName}</span>
          <span style="color:#6b7280;font-size:13px">${p.description}</span>
          <span style="font-weight:bold;color:#7c3aed">${formatCurrency(p.amount)}</span>
        </div>`).join('')}
      </div>
      ` : ''}

      ${data.insights && data.insights.length > 0 ? `
      <h2>💡 תובנות</h2>
      ${data.insights.map(i => `<div class="insight-box">${i}</div>`).join('')}
      ` : ''}

      ${data.alerts.length > 0 ? `
      <h2>⚠️ התראות</h2>
      ${data.alerts.map(alert => `<div class="alert">${alert}</div>`).join('')}
      ` : '<div class="success">✅ אין התראות להיום</div>'}

      ${data.upcomingClasses.length > 0 ? `
      <h2>📅 שיעורים קרובים</h2>
      <table>
        <tr><th>קורס</th><th>תאריך</th><th>מדריך</th><th>תלמידים</th></tr>
        ${data.upcomingClasses.map(cls => `
        <tr>
          <td>${cls.name}</td>
          <td>${cls.date}</td>
          <td>${cls.instructor}</td>
          <td>${cls.students}</td>
        </tr>
        `).join('')}
      </table>
      ` : ''}

    </div>
    <div class="footer">
      <p style="color:#6b7280;font-size:12px;">
        HaiTech CRM - דוח אוטומטי<br>
        ${new Date().toLocaleString('he-IL')}
      </p>
    </div>
  </div>
</body>
</html>
`;

// Newsletter/announcement template
export const newsletterTemplate = (data: NewsletterData): string => `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8">
  ${baseStyles}
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📣 ${data.title}</h1>
    </div>
    <div class="content">
      ${data.content}
      
      ${data.ctaText && data.ctaLink ? `
      <div style="text-align: center; margin-top: 30px;">
        <a href="${data.ctaLink}" class="btn">${data.ctaText}</a>
      </div>
      ` : ''}
    </div>
    <div class="footer">
      <p style="color: #6b7280; font-size: 12px;">
        HaiTech - בית הספר לקוד<br>
        <a href="https://hai.tech" style="color: #2563eb;">www.hai.tech</a>
      </p>
    </div>
  </div>
</body>
</html>
`;

// Template registry
export const templates: Record<TemplateId, (data: any) => string> = {
  'instructor-reminder': instructorReminderTemplate,
  'parent-reminder': parentReminderTemplate,
  'management-summary': managementSummaryTemplate,
  'newsletter': newsletterTemplate,
};

// Get template by ID
export const getTemplate = (templateId: TemplateId, data: any): string => {
  const template = templates[templateId];
  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }
  return template(data);
};

// List available templates
export const listTemplates = () => [
  { id: 'instructor-reminder', name: 'תזכורת למדריך', description: 'תזכורת 24 שעות לפני שיעור' },
  { id: 'parent-reminder', name: 'תזכורת להורים', description: 'תזכורת יום לפני שיעור' },
  { id: 'management-summary', name: 'סיכום יומי להנהלה', description: 'דוח סטטיסטי יומי' },
  { id: 'newsletter', name: 'ניוזלטר / הודעה', description: 'הודעה כללית או פרסום' },
];
