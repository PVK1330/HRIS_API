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

function fmtStep(step) {
  if (!step) return '';
  return `Step ${step}`;
}

function fmtWorkflowStatus(s) {
  if (!s) return '';
  return String(s)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtApprovalStatus(s) {
  if (!s) return '';
  return String(s).charAt(0).toUpperCase() + String(s).slice(1).toLowerCase();
}

function approvalColor(s) {
  const v = String(s || '').toLowerCase();
  if (v === 'approved') return 'FF059669';
  if (v === 'rejected') return 'FFDC2626';
  if (v === 'pending') return 'FFD97706';
  return 'FF64748B';
}

function workflowColor(s) {
  const v = String(s || '').toLowerCase();
  if (v.includes('complete')) return 'FF059669';
  if (v.includes('reject') || v.includes('cancel')) return 'FFDC2626';
  if (v.includes('offer')) return 'FF2563EB';
  if (v.includes('document')) return 'FFD97706';
  return 'FF64748B';
}

const HEADERS = [
  '#', 'Emp ID', 'Full Name', 'Work Email', 'Phone', 'Department',
  'Job Title', 'Employment Type', 'Work Location', 'Join Date',
  'Onboarding Step', 'Approval Status', 'Workflow Status', 'Manager',
];

async function buildExcel(res, rows, branding = {}) {
  const companyName = branding.companyName || COMPANY;
  const wb = new ExcelJS.Workbook();
  wb.creator = companyName;
  wb.created = new Date();

  const ws = wb.addWorksheet('Onboarding', {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const lastCol = String.fromCharCode(64 + HEADERS.length);

  if (branding.logoBuffer) {
    try {
      const imgId = wb.addImage({ buffer: branding.logoBuffer, extension: branding.logoExt || 'png' });
      ws.addImage(imgId, { tl: { col: 0, row: 0 }, br: { col: 2, row: 2 }, editAs: 'oneCell' });
      ws.getRow(1).height = 40;
    } catch (_) {}
  }

  ws.mergeCells(`A1:${lastCol}1`);
  const titleCell = ws.getCell('A1');
  titleCell.value = `${companyName} — Onboarding Report`;
  titleCell.font = { size: 15, bold: true, color: { argb: 'FF0F172A' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
  if (!branding.logoBuffer) ws.getRow(1).height = 28;

  ws.mergeCells(`A2:${lastCol}2`);
  const metaCell = ws.getCell('A2');
  metaCell.value = `Generated: ${fmtDate(new Date())}   |   Total Candidates: ${rows.length}   |   ${companyName}`;
  metaCell.font = { size: 9, italic: true, color: { argb: 'FF475569' } };
  metaCell.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(2).height = 18;
  ws.getRow(3).height = 6;

  const headerRow = ws.getRow(4);
  headerRow.height = 22;
  HEADERS.forEach((h, i) => {
    const c = headerRow.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.color } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
    c.border = HEADER_BORDER;
  });
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: HEADERS.length } };

  rows.forEach((r, idx) => {
    const row = ws.getRow(5 + idx);
    row.height = 16;
    const bg = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC';
    const approvalStatus = fmtApprovalStatus(r.onboarding_approval_status);
    const workflowStatus = fmtWorkflowStatus(r.onboarding_workflow_status);
    const vals = [
      idx + 1,
      r.emp_id || '',
      r.full_name || '',
      r.work_email || '',
      r.phone_number || '',
      r.department_name || r.department || '',
      r.job_title || '',
      r.employment_type || '',
      r.work_location || '',
      fmtDate(r.join_date),
      fmtStep(r.onboarding_step),
      approvalStatus,
      workflowStatus,
      r.manager_name || '',
    ];
    vals.forEach((v, i) => {
      const c = row.getCell(i + 1);
      c.value = v;
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      c.alignment = { vertical: 'middle', horizontal: i === 0 || i === 10 ? 'center' : 'left', wrapText: false };
      c.border = THIN_BORDER;
      if (i === 11) c.font = { bold: true, color: { argb: approvalColor(r.onboarding_approval_status) } };
      if (i === 12) c.font = { bold: true, color: { argb: workflowColor(r.onboarding_workflow_status) } };
    });
  });

  const totalRow = ws.getRow(5 + rows.length);
  totalRow.height = 18;
  totalRow.getCell(1).value = `Total: ${rows.length} candidate${rows.length !== 1 ? 's' : ''}`;
  totalRow.getCell(1).font = { bold: true };
  totalRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };

  const minWidths = [5, 12, 26, 28, 16, 22, 22, 18, 18, 14, 14, 16, 22, 22];
  ws.columns.forEach((col, i) => {
    let max = minWidths[i] || 12;
    col.eachCell({ includeEmpty: false }, (cell) => {
      const len = cell.value != null ? String(cell.value).length : 0;
      if (len > max) max = len;
    });
    col.width = Math.min(max + 2, 40);
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  await wb.xlsx.write(res);
}

function buildPDF(res, rows, branding = {}) {
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
      .text(`${companyName} — Onboarding Report`, titleX, MARGIN + 13, { width: CONTENT_W - (titleX - MARGIN) - 8 });
    doc.restore();
    doc.fontSize(7.5).fillColor('#475569').font('Helvetica')
      .text(
        `Generated: ${fmtDate(generatedAt)}   |   Total: ${rows.length} candidates`,
        MARGIN, MARGIN + 46, { width: CONTENT_W },
      );
    doc.moveTo(MARGIN, MARGIN + 58).lineTo(MARGIN + CONTENT_W, MARGIN + 58).lineWidth(0.5).stroke('#CBD5E1');
  }

  function drawFooter(pageIdx, total) {
    doc.fontSize(6.5).fillColor('#94A3B8').font('Helvetica')
      .text(
        `${companyName} Confidential  |  Page ${pageIdx + 1} of ${total}  |  ${generatedAt.toUTCString()}`,
        MARGIN, doc.page.height - 20, { width: CONTENT_W, align: 'center' },
      );
  }

  const cols = [
    { w: 20, title: '#', key: (r, i) => String(i + 1), align: 'center' },
    { w: 48, title: 'Emp ID', key: (r) => r.emp_id || '' },
    { w: 82, title: 'Full Name', key: (r) => r.full_name || '' },
    { w: 90, title: 'Email', key: (r) => r.work_email || '' },
    { w: 55, title: 'Department', key: (r) => r.department_name || r.department || '' },
    { w: 70, title: 'Job Title', key: (r) => r.job_title || '' },
    { w: 52, title: 'Emp Type', key: (r) => r.employment_type || '' },
    { w: 52, title: 'Join Date', key: (r) => fmtDate(r.join_date) },
    { w: 38, title: 'Step', key: (r) => fmtStep(r.onboarding_step), align: 'center' },
    { w: 58, title: 'Approval', key: (r) => fmtApprovalStatus(r.onboarding_approval_status), align: 'center' },
    { w: 90, title: 'Workflow Status', key: (r) => fmtWorkflowStatus(r.onboarding_workflow_status) },
    { w: 65, title: 'Manager', key: (r) => r.manager_name || '' },
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
    doc.fontSize(6.5).font('Helvetica');
    cols.forEach((c, ci) => {
      const raw = c.key(r, idx);
      const val = truncate(raw, Math.floor(c.w / 3.5));
      let color = '#1E293B';
      if (ci === 9) color = `#${approvalColor(r.onboarding_approval_status).slice(2)}`;
      if (ci === 10) color = `#${workflowColor(r.onboarding_workflow_status).slice(2)}`;
      doc.fillColor(color).font(ci === 9 || ci === 10 ? 'Helvetica-Bold' : 'Helvetica');
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

module.exports = { buildExcel, buildPDF };
