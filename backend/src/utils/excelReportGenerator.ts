import ExcelJS from 'exceljs';
import type { InstructorMonthlyReport } from '../services/instructorReport.service.js';

// ─── Style helpers ────────────────────────────────────────────────────────────

const BRAND_BLUE  = '1E40AF'; // deep blue
const HEADER_BG   = '1E40AF';
const HEADER_FG   = 'FFFFFF';
const SUB_BG      = 'DBEAFE'; // light blue — used in style ref
const GRAND_BG    = '1E40AF';

const headerFill = (color = HEADER_BG): ExcelJS.Fill => ({
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF' + color },
});

const font = (opts: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({
  name: 'Arial',
  size: 11,
  family: 2,
  ...opts,
});

const center: Partial<ExcelJS.Alignment> = {
  horizontal: 'center',
  vertical:   'middle',
  readingOrder: 'rtl',
};
const right: Partial<ExcelJS.Alignment> = {
  horizontal: 'right',
  vertical:   'middle',
  readingOrder: 'rtl',
};

const border: Partial<ExcelJS.Borders> = {
  top:    { style: 'thin', color: { argb: 'FFBFDBFE' } },
  bottom: { style: 'thin', color: { argb: 'FFBFDBFE' } },
  left:   { style: 'thin', color: { argb: 'FFBFDBFE' } },
  right:  { style: 'thin', color: { argb: 'FFBFDBFE' } },
};

const thickBorder: Partial<ExcelJS.Borders> = {
  top:    { style: 'medium', color: { argb: 'FF' + BRAND_BLUE } },
  bottom: { style: 'medium', color: { argb: 'FF' + BRAND_BLUE } },
  left:   { style: 'medium', color: { argb: 'FF' + BRAND_BLUE } },
  right:  { style: 'medium', color: { argb: 'FF' + BRAND_BLUE } },
};

const moneyFmt = '#,##0.00 ₪';
const hoursFmt = '0.00';

// ─── Summary sheet ────────────────────────────────────────────────────────────

function buildSummarySheet(
  wb: ExcelJS.Workbook,
  report: InstructorMonthlyReport,
) {
  const ws = wb.addWorksheet('סיכום', { views: [{ rightToLeft: true }] });
  ws.properties.defaultRowHeight = 22;

  // ── Title ──────────────────────────────────────────────────────────────────
  ws.mergeCells('A1:F1');
  const titleCell = ws.getCell('A1');
  titleCell.value = `דוח פעילות מדריכים — ${report.monthLabel}`;
  titleCell.font  = font({ size: 16, bold: true, color: { argb: 'FF' + HEADER_FG } });
  titleCell.fill  = headerFill(HEADER_BG);
  titleCell.alignment = { ...center };
  titleCell.border = thickBorder;
  ws.getRow(1).height = 36;

  // ── Sub-title ──────────────────────────────────────────────────────────────
  ws.mergeCells('A2:F2');
  const sub = ws.getCell('A2');
  sub.value = `הופק: ${report.generatedAt.toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}`;
  sub.font  = font({ size: 10, italic: true, color: { argb: 'FF6B7280' } });
  sub.alignment = { ...center };
  ws.getRow(2).height = 18;

  // ── Headers ────────────────────────────────────────────────────────────────
  const COLS = ['מדריך', 'פגישות', 'שעות', 'תשלום פגישות', 'הוצאות נוספות', 'סה"כ לתשלום'];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ws.getRow(3) as any).values = ['', ...COLS]; // col A is spacer
  ws.columns = [
    { key: 'spacer',   width: 3 },
    { key: 'name',     width: 24 },
    { key: 'meetings', width: 10 },
    { key: 'hours',    width: 10 },
    { key: 'payment',  width: 18 },
    { key: 'expenses', width: 18 },
    { key: 'total',    width: 18 },
  ];
  const headerRow = ws.getRow(3);
  headerRow.height = 26;
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    if (col < 2) return;
    cell.fill      = headerFill(SUB_BG.replace('DBEAFE', '3B82F6'));
    cell.font      = font({ bold: true, color: { argb: 'FFFFFFFF' } });
    cell.alignment = { ...center };
    cell.border    = border;
  });

  // ── Data rows ──────────────────────────────────────────────────────────────
  let row = 4;
  for (const instr of report.instructors) {
    const r = ws.getRow(row++);
    r.values = [
      '',
      instr.instructorName,
      instr.totalMeetings,
      instr.totalHours,
      instr.totalPayment,
      instr.totalExpenses,
      instr.grandTotal,
    ];
    r.height = 22;
    r.getCell(2).font = font({ bold: true });
    r.getCell(2).alignment = { ...right };
    [3, 4].forEach(c => {
      r.getCell(c).numFmt    = hoursFmt;
      r.getCell(c).alignment = { ...center };
    });
    [5, 6, 7].forEach(c => {
      r.getCell(c).numFmt    = moneyFmt;
      r.getCell(c).alignment = { ...center };
    });
    r.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col < 2) return;
      cell.border = border;
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: row % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF' },
      };
    });
  }

  // ── Grand total row ────────────────────────────────────────────────────────
  ws.mergeCells(`B${row}:D${row}`);
  const totalRow = ws.getRow(row);
  totalRow.height = 28;
  totalRow.getCell(2).value     = 'סה"כ כולל';
  totalRow.getCell(2).font      = font({ bold: true, color: { argb: 'FFFFFFFF' } });
  totalRow.getCell(2).fill      = headerFill(GRAND_BG);
  totalRow.getCell(2).alignment = { ...center };
  totalRow.getCell(2).border    = thickBorder;

  [5, 6, 7].forEach((col, i) => {
    const vals = [
      report.summaryTotalPayment,
      report.summaryTotalExpenses,
      report.summaryGrandTotal,
    ];
    totalRow.getCell(col).value     = vals[i];
    totalRow.getCell(col).numFmt    = moneyFmt;
    totalRow.getCell(col).font      = font({ bold: true, color: { argb: 'FFFFFFFF' } });
    totalRow.getCell(col).fill      = headerFill(GRAND_BG);
    totalRow.getCell(col).alignment = { ...center };
    totalRow.getCell(col).border    = thickBorder;
  });
}

// ─── Per-instructor sheet ─────────────────────────────────────────────────────

function buildInstructorSheet(
  wb: ExcelJS.Workbook,
  instr: InstructorMonthlyReport['instructors'][number],
  monthLabel: string,
) {
  // Sheet name max 31 chars, no special chars
  const sheetName = instr.instructorName.slice(0, 31).replace(/[:/\\?*[\]]/g, '');
  const ws = wb.addWorksheet(sheetName, { views: [{ rightToLeft: true }] });
  ws.properties.defaultRowHeight = 22;

  // ── Title ──────────────────────────────────────────────────────────────────
  ws.mergeCells('A1:I1');
  const title = ws.getCell('A1');
  title.value = `${instr.instructorName} — פעילות ${monthLabel}`;
  title.font  = font({ size: 15, bold: true, color: { argb: 'FF' + HEADER_FG } });
  title.fill  = headerFill(HEADER_BG);
  title.alignment = { ...center };
  title.border = thickBorder;
  ws.getRow(1).height = 34;

  // ── Column definitions ─────────────────────────────────────────────────────
  ws.columns = [
    { key: 'date',        width: 14, header: 'תאריך' },
    { key: 'start',       width: 10, header: 'שעת התחלה' },
    { key: 'end',         width: 10, header: 'שעת סיום' },
    { key: 'duration',    width: 10, header: 'משך (שעות)' },
    { key: 'course',      width: 22, header: 'מחזור / קורס' },
    { key: 'activity',    width: 14, header: 'סוג פעילות' },
    { key: 'topic',       width: 22, header: 'נושא' },
    { key: 'payment',     width: 16, header: 'תשלום' },
    { key: 'expenses',    width: 16, header: 'הוצאות נוספות' },
    { key: 'total',       width: 16, header: 'סה"כ' },
  ];

  // ── Header row ─────────────────────────────────────────────────────────────
  const headerRow = ws.getRow(2);
  headerRow.values = ws.columns.map(c => (typeof c.header === 'string' ? c.header : '')) as ExcelJS.CellValue[];
  headerRow.height = 26;
  headerRow.eachCell({ includeEmpty: true }, cell => {
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
    cell.font      = font({ bold: true, color: { argb: 'FFFFFFFF' } });
    cell.alignment = { ...center };
    cell.border    = border;
  });

  // ── Data rows ──────────────────────────────────────────────────────────────
  let rowIdx = 3;
  for (const mtg of instr.meetings) {
    const dateStr = mtg.date instanceof Date
      ? mtg.date.toLocaleDateString('he-IL')
      : new Date(mtg.date).toLocaleDateString('he-IL');

    const r = ws.getRow(rowIdx);
    r.values = [
      dateStr,
      mtg.startTime,
      mtg.endTime,
      parseFloat(mtg.durationHours.toFixed(2)),
      mtg.cycleName,
      mtg.activityType ?? '—',
      mtg.topic ?? '—',
      mtg.instructorPayment,
      mtg.totalExpenses,
      mtg.total,
    ];
    r.height = 22;

    const rowFill: ExcelJS.Fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: rowIdx % 2 === 0 ? 'FFF0F9FF' : 'FFFFFFFF' },
    };

    r.eachCell({ includeEmpty: false }, (cell, col) => {
      cell.border = border;
      cell.fill   = rowFill;
      cell.alignment = { ...right, readingOrder: 'rtl' };
      if (col === 4) {
        cell.numFmt    = hoursFmt;
        cell.alignment = { ...center };
      }
      if (col >= 8) {
        cell.numFmt    = moneyFmt;
        cell.alignment = { ...center };
      }
    });

    // If there are extra expenses, add a sub-row for each
    if (mtg.expenses.length > 0) {
      for (const exp of mtg.expenses) {
        rowIdx++;
        const er = ws.getRow(rowIdx);
        er.values = [
          '',
          '',
          '',
          exp.hours ? parseFloat(exp.hours.toFixed(2)) : '',
          exp.description || exp.type,
          exp.rateType ?? '',
          '',
          '',
          exp.amount,
          '',
        ];
        er.height = 18;
        er.eachCell({ includeEmpty: false }, cell => {
          cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBFCFE' } };
          cell.font   = font({ size: 10, italic: true, color: { argb: 'FF6B7280' } });
          cell.border = border;
          cell.alignment = { ...right };
        });
        er.getCell(9).numFmt    = moneyFmt;
        er.getCell(9).alignment = { ...center };
      }
    }

    rowIdx++;
  }

  // ── Totals row ─────────────────────────────────────────────────────────────
  ws.mergeCells(`A${rowIdx}:G${rowIdx}`);
  const totalsRow = ws.getRow(rowIdx);
  totalsRow.height = 28;
  totalsRow.getCell(1).value     = `סה"כ — ${instr.instructorName}`;
  totalsRow.getCell(1).font      = font({ bold: true, color: { argb: 'FFFFFFFF' } });
  totalsRow.getCell(1).fill      = headerFill(GRAND_BG);
  totalsRow.getCell(1).alignment = { ...center };
  totalsRow.getCell(1).border    = thickBorder;

  [
    [8, instr.totalPayment],
    [9, instr.totalExpenses],
    [10, instr.grandTotal],
  ].forEach(([col, val]) => {
    const cell = totalsRow.getCell(col as number);
    cell.value     = val;
    cell.numFmt    = moneyFmt;
    cell.font      = font({ bold: true, color: { argb: 'FFFFFFFF' } });
    cell.fill      = headerFill(GRAND_BG);
    cell.alignment = { ...center };
    cell.border    = thickBorder;
  });

  // ── Stats block ────────────────────────────────────────────────────────────
  const statsRow = rowIdx + 2;
  [
    ['פגישות:',       instr.totalMeetings.toString()],
    ['סה"כ שעות:',    instr.totalHours.toFixed(2)],
    ['סה"כ לתשלום:', `₪${instr.grandTotal.toLocaleString('he-IL', { minimumFractionDigits: 2 })}`],
  ].forEach(([label, val], i) => {
    const r = statsRow + i;
    ws.getCell(`H${r}`).value      = label;
    ws.getCell(`H${r}`).font       = font({ bold: true });
    ws.getCell(`H${r}`).alignment  = { ...right };
    ws.getCell(`I${r}`).value      = val;
    ws.getCell(`I${r}`).font       = font({ color: { argb: 'FF1E40AF' } });
    ws.getCell(`I${r}`).alignment  = { ...center };
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate an Excel workbook buffer for the given instructor monthly report.
 */
export async function generateInstructorReportExcel(
  report: InstructorMonthlyReport,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator  = 'HaiTech CRM';
  wb.created  = report.generatedAt;
  wb.modified = report.generatedAt;

  // Summary sheet first
  buildSummarySheet(wb, report);

  // One sheet per instructor
  for (const instr of report.instructors) {
    buildInstructorSheet(wb, instr, report.monthLabel);
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
