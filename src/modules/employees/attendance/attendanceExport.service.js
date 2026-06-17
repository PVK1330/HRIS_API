'use strict';

const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const { labelForField } = require('./attendanceLabels');

const BRAND_ARGB = 'FF0F766E';

const REPORT_TITLES = {
  employee: 'Employee Attendance Report',
  department: 'Department Attendance Report',
  organization: 'Organisation Attendance Report',
  summary: 'Attendance Summary Report',
  overtime: 'Overtime Report',
  late: 'Late Arrival Report',
  absenteeism: 'Absenteeism Report',
  regularization: 'Regularization Report',
  payroll: 'Payroll Attendance Report',
  leave: 'Leave & Absence Report',
  leave_balance: 'Leave Balance Report',
};

function formatDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mon = dt.toLocaleString('en-GB', { month: 'short' });
  return `${dd}-${mon}-${dt.getFullYear()}`;
}

function resolveLogoPath(logoUrl) {
  if (!logoUrl) return null;
  if (logoUrl.startsWith('http')) return null;
  try {
    const env = require('../../../config/env');
    const uploadBase = (env.UPLOAD && env.UPLOAD.dir) ? env.UPLOAD.dir : path.join(__dirname, '..', '..', '..', 'uploads');
    const relPath = String(logoUrl).replace(/^\/uploads\//, '');
    const absPath = path.resolve(process.cwd(), uploadBase, relPath);
    return fs.existsSync(absPath) ? absPath : null;
  } catch (_) {
    return null;
  }
}

const THIN_BORDER = {
  top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
};
const HEADER_BORDER = {
  top: { style: 'thin', color: { argb: BRAND_ARGB } },
  left: { style: 'thin', color: { argb: BRAND_ARGB } },
  bottom: { style: 'medium', color: { argb: 'FF064E3B' } },
  right: { style: 'thin', color: { argb: BRAND_ARGB } },
};

async function buildExcel(branding, reportType, rows, filtersSummary) {
  const wb = new ExcelJS.Workbook();
  wb.creator = branding.companyName || 'Organisation';
  wb.created = new Date();
  const title = REPORT_TITLES[reportType] || 'Attendance Report';
  const companyName = branding.companyName || 'Organisation';

  const ws = wb.addWorksheet('Report', {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  if (!rows.length) {
    ws.getCell('A1').value = 'No data for selected filters';
    return wb;
  }

  const headers = Object.keys(rows[0]);
  const lastCol = String.fromCharCode(64 + Math.min(headers.length, 26));

  // ── Row 1: Title ──
  const logoPath = resolveLogoPath(branding.logoUrl);
  if (logoPath) {
    try {
      const logoBuffer = fs.readFileSync(logoPath);
      const ext = path.extname(logoPath).toLowerCase().replace('.', '') || 'png';
      const imgId = wb.addImage({ buffer: logoBuffer, extension: ext === 'jpg' ? 'jpeg' : ext });
      ws.addImage(imgId, { tl: { col: 0, row: 0 }, br: { col: 2, row: 2 }, editAs: 'oneCell' });
      ws.getRow(1).height = 40;
    } catch (_) {}
  }

  ws.mergeCells(`A1:${lastCol}1`);
  const t = ws.getCell('A1');
  t.value = `${companyName} — ${title}`;
  t.font = { size: 14, bold: true, color: { argb: 'FF0F172A' } };
  t.alignment = { vertical: 'middle', horizontal: 'center' };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
  if (!logoPath) ws.getRow(1).height = 28;

  // ── Row 2: Meta ──
  ws.mergeCells(`A2:${lastCol}2`);
  const m = ws.getCell('A2');
  m.value = `Generated: ${formatDate(new Date())}  |  ${filtersSummary || 'All records'}  |  Total: ${rows.length}`;
  m.font = { size: 9, italic: true, color: { argb: 'FF475569' } };
  m.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(2).height = 18;
  ws.getRow(3).height = 6;

  // ── Row 4: Headers ──
  const headerRow = ws.getRow(4);
  headerRow.height = 22;
  headers.forEach((h, i) => {
    const c = headerRow.getCell(i + 1);
    c.value = labelForField(h);
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_ARGB } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
    c.border = HEADER_BORDER;
  });
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: headers.length } };

  // ── Data rows ──
  rows.forEach((r, idx) => {
    const row = ws.getRow(5 + idx);
    row.height = 16;
    const bg = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC';
    headers.forEach((h, i) => {
      const c = row.getCell(i + 1);
      c.value = r[h] ?? '';
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      c.alignment = { vertical: 'middle', horizontal: i === 0 ? 'center' : 'left', wrapText: false };
      c.border = THIN_BORDER;
    });
  });

  const totalRow = ws.getRow(5 + rows.length);
  totalRow.height = 18;
  totalRow.getCell(1).value = `Total: ${rows.length} records`;
  totalRow.getCell(1).font = { bold: true };
  totalRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };

  // ── Column widths ──
  ws.columns.forEach((col) => {
    let max = 12;
    col.eachCell({ includeEmpty: false }, (cell) => {
      const len = cell.value != null ? String(cell.value).length : 0;
      if (len > max) max = len;
    });
    col.width = Math.min(max + 2, 40);
  });

  return wb;
}

function buildPdf(branding, reportType, rows, filtersSummary, generatedBy) {
  return new Promise((resolve, reject) => {
    const companyName = branding.companyName || 'Organisation';
    const title = REPORT_TITLES[reportType] || 'Attendance Report';
    const logoPath = resolveLogoPath(branding.logoUrl);
    const generatedAt = new Date();

    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const PAGE_W = doc.page.width;
    const MARGIN = 30;
    const CONTENT_W = PAGE_W - MARGIN * 2;

    function drawPageHeader() {
      doc.save();
      doc.rect(MARGIN, MARGIN, CONTENT_W, 40).fill('#0F766E');
      if (logoPath) {
        try { doc.image(logoPath, MARGIN + 5, MARGIN + 4, { height: 32 }); } catch (_) {}
      }
      const titleX = logoPath ? MARGIN + 58 : MARGIN + 12;
      doc.fontSize(12).fillColor('#ffffff').font('Helvetica-Bold')
        .text(`${companyName} — ${title}`, titleX, MARGIN + 13, { width: CONTENT_W - (titleX - MARGIN) - 8 });
      doc.restore();
      doc.fontSize(7.5).fillColor('#475569').font('Helvetica')
        .text(
          `Generated: ${formatDate(generatedAt)}${generatedBy ? `  |  By: ${generatedBy}` : ''}  |  ${filtersSummary || 'All records'}  |  Total: ${rows.length}`,
          MARGIN, MARGIN + 46, { width: CONTENT_W },
        );
      doc.moveTo(MARGIN, MARGIN + 58).lineTo(MARGIN + CONTENT_W, MARGIN + 58).lineWidth(0.5).stroke('#CBD5E1');
    }

    if (!rows.length) {
      drawPageHeader();
      doc.fontSize(10).fillColor('#475569').text('No data for selected filters.', MARGIN, MARGIN + 75);
      doc.end();
      return;
    }

    const headers = Object.keys(rows[0]);
    const colWidth = Math.floor(CONTENT_W / headers.length);
    const TABLE_TOP = MARGIN + 68;
    const ROW_H = 14;
    const HEADER_H = 17;

    function drawTableHeader(y) {
      let x = MARGIN;
      doc.save();
      doc.rect(MARGIN, y, CONTENT_W, HEADER_H).fill('#0F766E');
      doc.fontSize(7).fillColor('#ffffff').font('Helvetica-Bold');
      headers.forEach((h) => {
        doc.text(labelForField(h), x + 2, y + 5, { width: colWidth - 4, ellipsis: true });
        x += colWidth;
      });
      doc.restore();
      return y + HEADER_H;
    }

    drawPageHeader();
    let y = TABLE_TOP;
    y = drawTableHeader(y);

    rows.forEach((row, idx) => {
      if (y + ROW_H > doc.page.height - 30) {
        doc.addPage();
        drawPageHeader();
        y = TABLE_TOP;
        y = drawTableHeader(y);
      }
      const bg = idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
      let x = MARGIN;
      doc.save();
      headers.forEach(() => {
        doc.rect(x, y, colWidth, ROW_H).fillAndStroke(bg, '#E2E8F0');
        x += colWidth;
      });
      doc.restore();
      x = MARGIN;
      doc.fontSize(6.5).fillColor('#1E293B').font('Helvetica');
      headers.forEach((h) => {
        doc.text(String(row[h] ?? ''), x + 2, y + 4, { width: colWidth - 4, ellipsis: true });
        x += colWidth;
      });
      y += ROW_H;
    });

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
      doc.switchToPage(range.start + i);
      doc.fontSize(7).fillColor('#94A3B8').font('Helvetica')
        .text(
          `${companyName} Confidential  |  Page ${i + 1} of ${range.count}  |  ${generatedAt.toUTCString()}`,
          MARGIN, doc.page.height - 22, { width: CONTENT_W, align: 'center' },
        );
    }

    doc.end();
  });
}

module.exports = {
  REPORT_TITLES,
  buildExcel,
  buildPdf,
};
