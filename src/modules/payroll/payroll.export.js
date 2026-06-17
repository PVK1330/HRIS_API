'use strict';

const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const BRAND = { color: 'FF0F766E', hex: '#0F766E' };
const COMPANY = process.env.COMPANY_NAME || 'Company';

const THIN_BORDER = {
  top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
};
const HEADER_BORDER = {
  top: { style: 'thin', color: { argb: BRAND.color } },
  left: { style: 'thin', color: { argb: BRAND.color } },
  bottom: { style: 'medium', color: { argb: 'FF064E3B' } },
  right: { style: 'thin', color: { argb: BRAND.color } },
};

function fmtDate(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d).slice(0, 10);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mon = dt.toLocaleString('en-GB', { month: 'short' });
  return `${dd}-${mon}-${dt.getFullYear()}`;
}

function fmtMoney(v) {
  if (v == null || v === '') return '';
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function runStatusColor(s) {
  const v = String(s || '').toUpperCase();
  if (v === 'APPROVED') return 'FF059669';
  if (v === 'COMPLETED') return 'FF2563EB';
  if (v === 'PROCESSING') return 'FFD97706';
  if (v === 'DRAFT') return 'FF64748B';
  if (v === 'CANCELLED' || v === 'FAILED') return 'FFDC2626';
  return 'FF64748B';
}

// ── Runs List Excel ───────────────────────────────────────────────────────────

const RUN_HEADERS = ['#', 'Run ID', 'Period', 'Year', 'Month', 'Status', 'Period Status', 'Start Date', 'End Date', 'Total Employees', 'Gross Pay', 'Net Pay', 'Created At'];

async function buildRunsExcel(res, runs, branding = {}) {
  const companyName = branding.companyName || COMPANY;
  const wb = new ExcelJS.Workbook();
  wb.creator = companyName;
  wb.created = new Date();

  const ws = wb.addWorksheet('Payroll Runs', {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const lastCol = String.fromCharCode(64 + RUN_HEADERS.length);

  if (branding.logoBuffer) {
    try {
      const imgId = wb.addImage({ buffer: branding.logoBuffer, extension: branding.logoExt || 'png' });
      ws.addImage(imgId, { tl: { col: 0, row: 0 }, br: { col: 2, row: 2 }, editAs: 'oneCell' });
      ws.getRow(1).height = 40;
    } catch (_) {}
  }

  ws.mergeCells(`A1:${lastCol}1`);
  const titleCell = ws.getCell('A1');
  titleCell.value = `${companyName} — Payroll Runs`;
  titleCell.font = { size: 15, bold: true, color: { argb: 'FF0F172A' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
  if (!branding.logoBuffer) ws.getRow(1).height = 28;

  ws.mergeCells(`A2:${lastCol}2`);
  const metaCell = ws.getCell('A2');
  metaCell.value = `Generated: ${fmtDate(new Date())}   |   Total Runs: ${runs.length}   |   ${companyName}`;
  metaCell.font = { size: 9, italic: true, color: { argb: 'FF475569' } };
  metaCell.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(2).height = 18;
  ws.getRow(3).height = 6;

  const headerRow = ws.getRow(4);
  headerRow.height = 22;
  RUN_HEADERS.forEach((h, i) => {
    const c = headerRow.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.color } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
    c.border = HEADER_BORDER;
  });
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: RUN_HEADERS.length } };

  runs.forEach((r, idx) => {
    const row = ws.getRow(5 + idx);
    row.height = 16;
    const bg = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC';
    const vals = [
      idx + 1,
      r.id,
      r.period_name || '',
      r.period_year || '',
      r.period_month || '',
      (r.status || '').toUpperCase(),
      (r.period_status || '').toUpperCase(),
      fmtDate(r.start_date),
      fmtDate(r.end_date),
      r.total_employees ?? '',
      fmtMoney(r.total_gross_pay),
      fmtMoney(r.total_net_pay),
      fmtDate(r.created_at),
    ];
    vals.forEach((v, i) => {
      const c = row.getCell(i + 1);
      c.value = v;
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      c.alignment = { vertical: 'middle', horizontal: i === 0 || i === 1 ? 'center' : 'left', wrapText: false };
      c.border = THIN_BORDER;
      if (i === 5) c.font = { bold: true, color: { argb: runStatusColor(r.status) } };
    });
  });

  const totalRow = ws.getRow(5 + runs.length);
  totalRow.height = 18;
  totalRow.getCell(1).value = `Total: ${runs.length} run${runs.length !== 1 ? 's' : ''}`;
  totalRow.getCell(1).font = { bold: true };
  totalRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };

  const minWidths = [5, 8, 22, 8, 8, 12, 14, 14, 14, 16, 16, 16, 14];
  ws.columns.forEach((col, i) => {
    let max = minWidths[i] || 12;
    col.eachCell({ includeEmpty: false }, (cell) => {
      const len = cell.value != null ? String(cell.value).length : 0;
      if (len > max) max = len;
    });
    col.width = Math.min(max + 2, 36);
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  await wb.xlsx.write(res);
}

// ── Run Detail Excel (2 sheets: summary + employee breakdown) ─────────────────

const EMP_HEADERS = ['#', 'Emp Code', 'Name', 'Email', 'Department', 'Designation', 'Basic', 'Allowances', 'Gross Pay', 'Deductions', 'Net Pay', 'Status'];

async function buildRunDetailExcel(res, run, branding = {}) {
  const companyName = branding.companyName || COMPANY;
  const wb = new ExcelJS.Workbook();
  wb.creator = companyName;
  wb.created = new Date();

  // ── Sheet 1: Run Summary ──
  const ws1 = wb.addWorksheet('Run Summary');
  const infoRows = [
    ['Period', run.period_name || ''],
    ['Year / Month', `${run.period_year || ''} / ${run.period_month || ''}`],
    ['Status', (run.status || '').toUpperCase()],
    ['Period Status', (run.period_status || '').toUpperCase()],
    ['Start Date', fmtDate(run.start_date)],
    ['End Date', fmtDate(run.end_date)],
    ['Total Employees', run.total_employees ?? (run.employees || []).length],
    ['Gross Pay', fmtMoney(run.total_gross_pay)],
    ['Net Pay', fmtMoney(run.total_net_pay)],
    ['Generated At', fmtDate(new Date())],
  ];

  if (branding.logoBuffer) {
    try {
      const imgId = wb.addImage({ buffer: branding.logoBuffer, extension: branding.logoExt || 'png' });
      ws1.addImage(imgId, { tl: { col: 0, row: 0 }, br: { col: 1, row: 2 }, editAs: 'oneCell' });
      ws1.getRow(1).height = 40;
    } catch (_) {}
  }

  ws1.mergeCells('A1:C1');
  ws1.getCell('A1').value = `${companyName} — Payroll Run #${run.id}`;
  ws1.getCell('A1').font = { size: 14, bold: true, color: { argb: 'FF0F172A' } };
  ws1.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center' };
  ws1.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
  if (!branding.logoBuffer) ws1.getRow(1).height = 28;
  ws1.getRow(2).height = 6;

  infoRows.forEach(([label, value], idx) => {
    const r = ws1.getRow(3 + idx);
    r.height = 18;
    const lc = r.getCell(1);
    lc.value = label;
    lc.font = { bold: true };
    lc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    lc.border = THIN_BORDER;
    const vc = r.getCell(2);
    vc.value = value;
    vc.border = THIN_BORDER;
    if (label === 'Status') vc.font = { bold: true, color: { argb: runStatusColor(run.status) } };
  });

  ws1.getColumn(1).width = 20;
  ws1.getColumn(2).width = 28;

  // ── Sheet 2: Employee Breakdown ──
  const employees = run.employees || [];
  const ws2 = wb.addWorksheet('Employee Breakdown', {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const lastCol = String.fromCharCode(64 + EMP_HEADERS.length);

  ws2.mergeCells(`A1:${lastCol}1`);
  ws2.getCell('A1').value = `${companyName} — Payroll Run #${run.id} — Employee Breakdown`;
  ws2.getCell('A1').font = { size: 13, bold: true, color: { argb: 'FF0F172A' } };
  ws2.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center' };
  ws2.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
  ws2.getRow(1).height = 28;

  ws2.mergeCells(`A2:${lastCol}2`);
  ws2.getCell('A2').value = `Period: ${run.period_name || ''}   |   Employees: ${employees.length}   |   Generated: ${fmtDate(new Date())}`;
  ws2.getCell('A2').font = { size: 9, italic: true, color: { argb: 'FF475569' } };
  ws2.getCell('A2').alignment = { vertical: 'middle', horizontal: 'center' };
  ws2.getRow(2).height = 18;
  ws2.getRow(3).height = 6;

  const headerRow = ws2.getRow(4);
  headerRow.height = 22;
  EMP_HEADERS.forEach((h, i) => {
    const c = headerRow.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.color } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
    c.border = HEADER_BORDER;
  });
  ws2.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: EMP_HEADERS.length } };

  employees.forEach((e, idx) => {
    const row = ws2.getRow(5 + idx);
    row.height = 16;
    const bg = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC';
    const vals = [
      idx + 1,
      e.emp_code || e.emp_id || '',
      `${e.first_name || ''} ${e.last_name || ''}`.trim(),
      e.email || e.work_email || '',
      e.department_name || '',
      e.designation || e.job_title || '',
      fmtMoney(e.basic_pay || e.basic_salary),
      fmtMoney(e.total_allowances),
      fmtMoney(e.gross_pay),
      fmtMoney(e.total_deductions),
      fmtMoney(e.net_pay),
      (e.status || '').toUpperCase(),
    ];
    vals.forEach((v, i) => {
      const c = row.getCell(i + 1);
      c.value = v;
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      c.alignment = { vertical: 'middle', horizontal: i === 0 ? 'center' : 'left', wrapText: false };
      c.border = THIN_BORDER;
      if (i === 11) c.font = { bold: true, color: { argb: runStatusColor(e.status) } };
    });
  });

  const totRow = ws2.getRow(5 + employees.length);
  totRow.height = 18;
  totRow.getCell(1).value = `Total: ${employees.length} employee${employees.length !== 1 ? 's' : ''}`;
  totRow.getCell(1).font = { bold: true };
  totRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };

  const minWidths2 = [5, 12, 26, 28, 22, 20, 14, 14, 14, 14, 14, 12];
  ws2.columns.forEach((col, i) => {
    let max = minWidths2[i] || 12;
    col.eachCell({ includeEmpty: false }, (cell) => {
      const len = cell.value != null ? String(cell.value).length : 0;
      if (len > max) max = len;
    });
    col.width = Math.min(max + 2, 36);
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  await wb.xlsx.write(res);
}

// ── Runs List PDF ─────────────────────────────────────────────────────────────

function buildRunsPDF(res, runs, branding = {}) {
  const companyName = branding.companyName || COMPANY;
  const generatedAt = new Date();
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28, bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  doc.pipe(res);

  const PAGE_W = doc.page.width;
  const MARGIN = 28;
  const CONTENT_W = PAGE_W - MARGIN * 2;

  function drawPageHeader() {
    doc.save();
    doc.rect(MARGIN, MARGIN, CONTENT_W, 40).fill(BRAND.hex);
    if (branding.logoBuffer) {
      try { doc.image(branding.logoBuffer, MARGIN + 5, MARGIN + 4, { height: 32 }); } catch (_) {}
    }
    const titleX = branding.logoBuffer ? MARGIN + 58 : MARGIN + 12;
    doc.fontSize(13).fillColor('#ffffff').font('Helvetica-Bold')
      .text(`${companyName} — Payroll Runs`, titleX, MARGIN + 13, { width: CONTENT_W - (titleX - MARGIN) - 8 });
    doc.restore();
    doc.fontSize(7.5).fillColor('#475569').font('Helvetica')
      .text(`Generated: ${fmtDate(generatedAt)}   |   Total: ${runs.length} run${runs.length !== 1 ? 's' : ''}`, MARGIN, MARGIN + 46, { width: CONTENT_W });
    doc.moveTo(MARGIN, MARGIN + 58).lineTo(MARGIN + CONTENT_W, MARGIN + 58).lineWidth(0.5).stroke('#CBD5E1');
  }

  function drawFooter(pageIdx, total) {
    doc.fontSize(6.5).fillColor('#94A3B8').font('Helvetica')
      .text(`${companyName} Confidential  |  Page ${pageIdx + 1} of ${total}  |  ${generatedAt.toUTCString()}`,
        MARGIN, doc.page.height - 20, { width: CONTENT_W, align: 'center' });
  }

  const cols = [
    { w: 22, title: '#', key: (r, i) => String(i + 1), align: 'center' },
    { w: 40, title: 'Run ID', key: (r) => String(r.id), align: 'center' },
    { w: 100, title: 'Period', key: (r) => r.period_name || '' },
    { w: 40, title: 'Year', key: (r) => String(r.period_year || '') },
    { w: 40, title: 'Month', key: (r) => String(r.period_month || '') },
    { w: 62, title: 'Status', key: (r) => (r.status || '').toUpperCase(), align: 'center' },
    { w: 60, title: 'Start Date', key: (r) => fmtDate(r.start_date) },
    { w: 60, title: 'End Date', key: (r) => fmtDate(r.end_date) },
    { w: 52, title: 'Employees', key: (r) => String(r.total_employees ?? ''), align: 'center' },
    { w: 68, title: 'Gross Pay', key: (r) => fmtMoney(r.total_gross_pay) },
    { w: 68, title: 'Net Pay', key: (r) => fmtMoney(r.total_net_pay) },
  ];

  const TABLE_TOP = MARGIN + 68;
  const ROW_H = 14;
  const HEADER_H = 17;
  const TABLE_W = cols.reduce((a, c) => a + c.w, 0);

  function truncate(s, max) {
    const t = String(s ?? '');
    return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
  }

  function drawTableHeader(y) {
    let x = MARGIN;
    doc.save();
    doc.rect(MARGIN, y, TABLE_W, HEADER_H).fill(BRAND.hex);
    doc.fontSize(7).fillColor('#ffffff').font('Helvetica-Bold');
    cols.forEach((c) => {
      doc.text(c.title, x + 3, y + 5, { width: c.w - 6, align: c.align || 'left', ellipsis: true });
      x += c.w;
    });
    doc.restore();
    return y + HEADER_H;
  }

  drawPageHeader();
  let y = TABLE_TOP;
  y = drawTableHeader(y);

  runs.forEach((r, idx) => {
    if (y + ROW_H > doc.page.height - 30) {
      doc.addPage();
      drawPageHeader();
      y = TABLE_TOP;
      y = drawTableHeader(y);
    }
    const bg = idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
    let x = MARGIN;
    doc.save();
    cols.forEach((c) => { doc.rect(x, y, c.w, ROW_H).fillAndStroke(bg, '#E2E8F0'); x += c.w; });
    doc.restore();
    x = MARGIN;
    doc.fontSize(6.5).font('Helvetica');
    cols.forEach((c, ci) => {
      const raw = c.key(r, idx);
      const val = truncate(raw, Math.floor(c.w / 3.5));
      const color = ci === 5 ? `#${runStatusColor(r.status).slice(2)}` : '#1E293B';
      doc.fillColor(color).font(ci === 5 ? 'Helvetica-Bold' : 'Helvetica');
      doc.text(val, x + 3, y + 4, { width: c.w - 6, align: c.align || 'left', ellipsis: true });
      x += c.w;
    });
    y += ROW_H;
  });

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    drawFooter(i, range.count);
  }
  doc.end();
}

// ── Run Detail PDF ────────────────────────────────────────────────────────────

function buildRunDetailPDF(res, run, branding = {}) {
  const companyName = branding.companyName || COMPANY;
  const generatedAt = new Date();
  const employees = run.employees || [];
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28, bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  doc.pipe(res);

  const PAGE_W = doc.page.width;
  const MARGIN = 28;
  const CONTENT_W = PAGE_W - MARGIN * 2;

  function drawPageHeader() {
    doc.save();
    doc.rect(MARGIN, MARGIN, CONTENT_W, 40).fill(BRAND.hex);
    if (branding.logoBuffer) {
      try { doc.image(branding.logoBuffer, MARGIN + 5, MARGIN + 4, { height: 32 }); } catch (_) {}
    }
    const titleX = branding.logoBuffer ? MARGIN + 58 : MARGIN + 12;
    doc.fontSize(12).fillColor('#ffffff').font('Helvetica-Bold')
      .text(`${companyName} — Payroll Run #${run.id} (${run.period_name || ''})`, titleX, MARGIN + 13, { width: CONTENT_W - (titleX - MARGIN) - 8 });
    doc.restore();
    doc.fontSize(7.5).fillColor('#475569').font('Helvetica')
      .text(
        `Status: ${(run.status || '').toUpperCase()}   |   Period: ${fmtDate(run.start_date)} – ${fmtDate(run.end_date)}   |   Employees: ${employees.length}   |   Generated: ${fmtDate(generatedAt)}`,
        MARGIN, MARGIN + 46, { width: CONTENT_W },
      );
    doc.moveTo(MARGIN, MARGIN + 58).lineTo(MARGIN + CONTENT_W, MARGIN + 58).lineWidth(0.5).stroke('#CBD5E1');
  }

  function drawFooter(pageIdx, total) {
    doc.fontSize(6.5).fillColor('#94A3B8').font('Helvetica')
      .text(`${companyName} Confidential  |  Page ${pageIdx + 1} of ${total}  |  ${generatedAt.toUTCString()}`,
        MARGIN, doc.page.height - 20, { width: CONTENT_W, align: 'center' });
  }

  const cols = [
    { w: 22, title: '#', key: (e, i) => String(i + 1), align: 'center' },
    { w: 46, title: 'Emp Code', key: (e) => e.emp_code || e.emp_id || '' },
    { w: 80, title: 'Name', key: (e) => `${e.first_name || ''} ${e.last_name || ''}`.trim() },
    { w: 90, title: 'Email', key: (e) => e.email || e.work_email || '' },
    { w: 68, title: 'Department', key: (e) => e.department_name || '' },
    { w: 68, title: 'Designation', key: (e) => e.designation || e.job_title || '' },
    { w: 58, title: 'Gross Pay', key: (e) => fmtMoney(e.gross_pay) },
    { w: 58, title: 'Deductions', key: (e) => fmtMoney(e.total_deductions) },
    { w: 58, title: 'Net Pay', key: (e) => fmtMoney(e.net_pay) },
    { w: 54, title: 'Status', key: (e) => (e.status || '').toUpperCase(), align: 'center' },
  ];

  const TABLE_TOP = MARGIN + 68;
  const ROW_H = 14;
  const HEADER_H = 17;
  const TABLE_W = cols.reduce((a, c) => a + c.w, 0);

  function truncate(s, max) {
    const t = String(s ?? '');
    return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
  }

  function drawTableHeader(y) {
    let x = MARGIN;
    doc.save();
    doc.rect(MARGIN, y, TABLE_W, HEADER_H).fill(BRAND.hex);
    doc.fontSize(7).fillColor('#ffffff').font('Helvetica-Bold');
    cols.forEach((c) => {
      doc.text(c.title, x + 3, y + 5, { width: c.w - 6, align: c.align || 'left', ellipsis: true });
      x += c.w;
    });
    doc.restore();
    return y + HEADER_H;
  }

  drawPageHeader();
  let y = TABLE_TOP;
  y = drawTableHeader(y);

  employees.forEach((e, idx) => {
    if (y + ROW_H > doc.page.height - 30) {
      doc.addPage();
      drawPageHeader();
      y = TABLE_TOP;
      y = drawTableHeader(y);
    }
    const bg = idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
    let x = MARGIN;
    doc.save();
    cols.forEach((c) => { doc.rect(x, y, c.w, ROW_H).fillAndStroke(bg, '#E2E8F0'); x += c.w; });
    doc.restore();
    x = MARGIN;
    doc.fontSize(6.5).font('Helvetica');
    cols.forEach((c, ci) => {
      const raw = c.key(e, idx);
      const val = truncate(raw, Math.floor(c.w / 3.5));
      const color = ci === 9 ? `#${runStatusColor(e.status).slice(2)}` : '#1E293B';
      doc.fillColor(color).font(ci === 9 ? 'Helvetica-Bold' : 'Helvetica');
      doc.text(val, x + 3, y + 4, { width: c.w - 6, align: c.align || 'left', ellipsis: true });
      x += c.w;
    });
    y += ROW_H;
  });

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    drawFooter(i, range.count);
  }
  doc.end();
}

// ── Salary List Excel ─────────────────────────────────────────────────────────

const SAL_HEADERS = ['#', 'Emp Code', 'Name', 'Email', 'Department', 'Designation', 'Net Salary', 'Earnings', 'Deductions', 'Updated At'];

async function buildSalaryExcel(res, rows, branding = {}) {
  const companyName = branding.companyName || COMPANY;
  const wb = new ExcelJS.Workbook();
  wb.creator = companyName;
  wb.created = new Date();

  const ws = wb.addWorksheet('Salary Registry', {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const lastCol = String.fromCharCode(64 + SAL_HEADERS.length);

  if (branding.logoBuffer) {
    try {
      const imgId = wb.addImage({ buffer: branding.logoBuffer, extension: branding.logoExt || 'png' });
      ws.addImage(imgId, { tl: { col: 0, row: 0 }, br: { col: 2, row: 2 }, editAs: 'oneCell' });
      ws.getRow(1).height = 40;
    } catch (_) {}
  }

  ws.mergeCells(`A1:${lastCol}1`);
  const titleCell = ws.getCell('A1');
  titleCell.value = `${companyName} — Salary Registry`;
  titleCell.font = { size: 15, bold: true, color: { argb: 'FF0F172A' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
  if (!branding.logoBuffer) ws.getRow(1).height = 28;

  ws.mergeCells(`A2:${lastCol}2`);
  const metaCell = ws.getCell('A2');
  metaCell.value = `Generated: ${fmtDate(new Date())}   |   Total Records: ${rows.length}   |   ${companyName}`;
  metaCell.font = { size: 9, italic: true, color: { argb: 'FF475569' } };
  metaCell.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(2).height = 18;
  ws.getRow(3).height = 6;

  const headerRow = ws.getRow(4);
  headerRow.height = 22;
  SAL_HEADERS.forEach((h, i) => {
    const c = headerRow.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.color } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
    c.border = HEADER_BORDER;
  });
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: SAL_HEADERS.length } };

  rows.forEach((r, idx) => {
    const row = ws.getRow(5 + idx);
    row.height = 16;
    const bg = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC';
    const earningsTotal = r.earnings ? Object.values(r.earnings).reduce((a, v) => a + Number(v || 0), 0) : 0;
    const deductionsTotal = r.deductions ? Object.values(r.deductions).reduce((a, v) => a + Number(v || 0), 0) : 0;
    const vals = [
      idx + 1,
      r.emp_code || r.emp_id || '',
      `${r.first_name || ''} ${r.last_name || ''}`.trim(),
      r.email || r.work_email || '',
      r.department_name || '',
      r.designation_name || r.job_title || '',
      fmtMoney(r.net_salary),
      fmtMoney(earningsTotal),
      fmtMoney(deductionsTotal),
      fmtDate(r.updated_at || r.created_at),
    ];
    vals.forEach((v, i) => {
      const c = row.getCell(i + 1);
      c.value = v;
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      c.alignment = { vertical: 'middle', horizontal: i === 0 ? 'center' : 'left', wrapText: false };
      c.border = THIN_BORDER;
    });
  });

  const totalRow = ws.getRow(5 + rows.length);
  totalRow.height = 18;
  totalRow.getCell(1).value = `Total: ${rows.length} record${rows.length !== 1 ? 's' : ''}`;
  totalRow.getCell(1).font = { bold: true };
  totalRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };

  const minWidths = [5, 12, 26, 28, 22, 20, 14, 14, 14, 14];
  ws.columns.forEach((col, i) => {
    let max = minWidths[i] || 12;
    col.eachCell({ includeEmpty: false }, (cell) => {
      const len = cell.value != null ? String(cell.value).length : 0;
      if (len > max) max = len;
    });
    col.width = Math.min(max + 2, 36);
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  await wb.xlsx.write(res);
}

// ── Salary List PDF ───────────────────────────────────────────────────────────

function buildSalaryPDF(res, rows, branding = {}) {
  const companyName = branding.companyName || COMPANY;
  const generatedAt = new Date();
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28, bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  doc.pipe(res);

  const PAGE_W = doc.page.width;
  const MARGIN = 28;
  const CONTENT_W = PAGE_W - MARGIN * 2;

  function drawPageHeader() {
    doc.save();
    doc.rect(MARGIN, MARGIN, CONTENT_W, 40).fill(BRAND.hex);
    if (branding.logoBuffer) {
      try { doc.image(branding.logoBuffer, MARGIN + 5, MARGIN + 4, { height: 32 }); } catch (_) {}
    }
    const titleX = branding.logoBuffer ? MARGIN + 58 : MARGIN + 12;
    doc.fontSize(13).fillColor('#ffffff').font('Helvetica-Bold')
      .text(`${companyName} — Salary Registry`, titleX, MARGIN + 13, { width: CONTENT_W - (titleX - MARGIN) - 8 });
    doc.restore();
    doc.fontSize(7.5).fillColor('#475569').font('Helvetica')
      .text(`Generated: ${fmtDate(generatedAt)}   |   Total: ${rows.length} records`, MARGIN, MARGIN + 46, { width: CONTENT_W });
    doc.moveTo(MARGIN, MARGIN + 58).lineTo(MARGIN + CONTENT_W, MARGIN + 58).lineWidth(0.5).stroke('#CBD5E1');
  }

  function drawFooter(pageIdx, total) {
    doc.fontSize(6.5).fillColor('#94A3B8').font('Helvetica')
      .text(`${companyName} Confidential  |  Page ${pageIdx + 1} of ${total}  |  ${generatedAt.toUTCString()}`,
        MARGIN, doc.page.height - 20, { width: CONTENT_W, align: 'center' });
  }

  const cols = [
    { w: 22, title: '#', key: (r, i) => String(i + 1), align: 'center' },
    { w: 46, title: 'Emp Code', key: (r) => r.emp_code || r.emp_id || '' },
    { w: 82, title: 'Name', key: (r) => `${r.first_name || ''} ${r.last_name || ''}`.trim() },
    { w: 90, title: 'Email', key: (r) => r.email || r.work_email || '' },
    { w: 68, title: 'Department', key: (r) => r.department_name || '' },
    { w: 68, title: 'Designation', key: (r) => r.designation_name || r.job_title || '' },
    { w: 58, title: 'Net Salary', key: (r) => fmtMoney(r.net_salary) },
    { w: 58, title: 'Earnings', key: (r) => r.earnings ? fmtMoney(Object.values(r.earnings).reduce((a, v) => a + Number(v || 0), 0)) : '' },
    { w: 58, title: 'Deductions', key: (r) => r.deductions ? fmtMoney(Object.values(r.deductions).reduce((a, v) => a + Number(v || 0), 0)) : '' },
  ];

  const TABLE_TOP = MARGIN + 68;
  const ROW_H = 14;
  const HEADER_H = 17;
  const TABLE_W = cols.reduce((a, c) => a + c.w, 0);

  function truncate(s, max) {
    const t = String(s ?? '');
    return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
  }

  function drawTableHeader(y) {
    let x = MARGIN;
    doc.save();
    doc.rect(MARGIN, y, TABLE_W, HEADER_H).fill(BRAND.hex);
    doc.fontSize(7).fillColor('#ffffff').font('Helvetica-Bold');
    cols.forEach((c) => {
      doc.text(c.title, x + 3, y + 5, { width: c.w - 6, align: c.align || 'left', ellipsis: true });
      x += c.w;
    });
    doc.restore();
    return y + HEADER_H;
  }

  drawPageHeader();
  let y = TABLE_TOP;
  y = drawTableHeader(y);

  rows.forEach((r, idx) => {
    if (y + ROW_H > doc.page.height - 30) {
      doc.addPage();
      drawPageHeader();
      y = TABLE_TOP;
      y = drawTableHeader(y);
    }
    const bg = idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
    let x = MARGIN;
    doc.save();
    cols.forEach((c) => { doc.rect(x, y, c.w, ROW_H).fillAndStroke(bg, '#E2E8F0'); x += c.w; });
    doc.restore();
    x = MARGIN;
    doc.fontSize(6.5).fillColor('#1E293B').font('Helvetica');
    cols.forEach((c) => {
      const raw = c.key(r, idx);
      const val = truncate(raw, Math.floor(c.w / 3.5));
      doc.text(val, x + 3, y + 4, { width: c.w - 6, align: c.align || 'left', ellipsis: true });
      x += c.w;
    });
    y += ROW_H;
  });

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    drawFooter(i, range.count);
  }
  doc.end();
}

module.exports = { buildRunsExcel, buildRunDetailExcel, buildRunsPDF, buildRunDetailPDF, buildSalaryExcel, buildSalaryPDF };
