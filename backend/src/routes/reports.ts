import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import {
  buildInstructorMonthlyReport,
  getPreviousMonth,
} from '../services/instructorReport.service.js';
import { generateInstructorReportExcel } from '../utils/excelReportGenerator.js';
import { sendInstructorMonthlyReportEmail } from '../services/email/instructorReportEmail.js';

export const reportsRouter = Router();

// All routes require auth + admin/manager
reportsRouter.use(authenticate);
reportsRouter.use(authorize('admin', 'manager'));

// ─── GET /api/reports/instructors/months ──────────────────────────────────────
// List available months (last 12)
reportsRouter.get('/instructors/months', (_req: Request, res: Response) => {
  const months: Array<{ value: string; label: string }> = [];
  const now = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }),
  );

  const HEBREW_MONTHS = [
    'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
    'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
  ];

  for (let i = 1; i <= 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const mStr = String(m).padStart(2, '0');
    months.push({
      value: `${y}-${mStr}`,
      label: `${HEBREW_MONTHS[m - 1]} ${y}`,
    });
  }

  res.json({ months });
});

// ─── GET /api/reports/instructors?month=YYYY-MM ───────────────────────────────
// Return report as JSON
reportsRouter.get('/instructors', async (req: Request, res: Response) => {
  try {
    const month = (req.query.month as string) || getPreviousMonth();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'month must be YYYY-MM' });
    }
    const report = await buildInstructorMonthlyReport(month);
    res.json(report);
  } catch (err) {
    console.error('❌ Report error:', err);
    res.status(500).json({ error: 'שגיאה ביצירת הדוח' });
  }
});

// ─── GET /api/reports/instructors/excel?month=YYYY-MM ─────────────────────────
// Download Excel file
reportsRouter.get('/instructors/excel', async (req: Request, res: Response) => {
  try {
    const month = (req.query.month as string) || getPreviousMonth();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'month must be YYYY-MM' });
    }
    const report = await buildInstructorMonthlyReport(month);
    const buf    = await generateInstructorReportExcel(report);

    const filename = `דוח_מדריכים_${report.monthLabel.replace(' ', '_')}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buf);
  } catch (err) {
    console.error('❌ Excel generation error:', err);
    res.status(500).json({ error: 'שגיאה ביצירת קובץ Excel' });
  }
});

// ─── POST /api/reports/instructors/send ──────────────────────────────────────
// Send report via email to recipients
// Body: { month: "YYYY-MM", recipients?: string[] }
reportsRouter.post('/instructors/send', async (req: Request, res: Response) => {
  try {
    const { month: monthParam, recipients } = req.body as {
      month?: string;
      recipients?: string[];
    };

    const month = monthParam || getPreviousMonth();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'month must be YYYY-MM' });
    }

    const report = await buildInstructorMonthlyReport(month);
    const buf    = await generateInstructorReportExcel(report);

    await sendInstructorMonthlyReportEmail(report, buf, recipients);

    res.json({
      success: true,
      message: `דוח ${report.monthLabel} נשלח בהצלחה`,
      instructors: report.instructors.length,
      grandTotal: report.summaryGrandTotal,
    });
  } catch (err) {
    console.error('❌ Send report error:', err);
    res.status(500).json({ error: 'שגיאה בשליחת הדוח' });
  }
});
