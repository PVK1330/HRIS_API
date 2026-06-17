'use strict';

const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const BRAND = { color: 'FF0F766E', hex: '#0F766E' };
const COMPANY = process.env.COMPANY_NAME || 'Company';

function formatFilterSummary(q) {
  const parts = [];
  if (q.search) parts.push(`Search: "${q.search}"`);
  if (q.department) parts.push(`Dept: ${q.department}`);
  if (q.status) parts.push(`Status: ${q.status}`);
  if (q.workMode) parts.push(`Mode: ${q.workMode}`);
  if (q.jobTitle) parts.push(`Title: ${q.jobTitle}`);
  if (q.workLocation) parts.push(`Location: ${q.workLocation}`);
  if (q.joinDateFrom) parts.push(`From: ${q.joinDateFrom}`);
  if (q.joinDateTo) parts.push(`To: ${q.joinDateTo}`);
  return parts.length ? parts.join('  |  ') : 'All records';
}

function formatDateDDMMMYYYY(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mon = dt.toLocaleString('en-GB', { month: 'short' });
  return `${dd}-${mon}-${dt.getFullYear()}`;
}

function yn(v) { return v ? 'Yes' : 'No'; }

function parseJoinDate(row) {
  if (!row.join_date) return '';
  if (row.join_date instanceof Date) return row.join_date;
  const s = String(row.join_date);
  const d = new Date(s.includes('T') ? s : `${s}T12:00:00`);
  return Number.isNaN(d.getTime()) ? s : d;
}

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

function applyHeaderRow(ws, headers, rowNum) {
  const headerRow = ws.getRow(rowNum);
  headerRow.height = 22;
  headers.forEach((h, i) => {
    const c = headerRow.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.color } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
    c.border = HEADER_BORDER;
  });
  return headerRow;
}

async function buildExcel(res, rows) {
  const wb = new ExcelJS.Workbook();
  wb.creator = COMPANY;
  wb.created = new Date();
  const dateStyle = { numFmt: 'dd-mmm-yyyy' };

  // ── Sheet 1: Employee List ──
  const ws1 = wb.addWorksheet('Employee List', {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  ws1.mergeCells('A1:P1');
  const t1 = ws1.getCell('A1');
  t1.value = `${COMPANY} — Employee List`;
  t1.font = { size: 15, bold: true, color: { argb: 'FF0F172A' } };
  t1.alignment = { horizontal: 'center', vertical: 'middle' };
  t1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
  ws1.getRow(1).height = 28;

  ws1.mergeCells('A2:P2');
  const m1 = ws1.getCell('A2');
  m1.value = `Generated: ${formatDateDDMMMYYYY(new Date())}   |   Total Employees: ${rows.length}`;
  m1.font = { size: 9, italic: true, color: { argb: 'FF475569' } };
  m1.alignment = { horizontal: 'center', vertical: 'middle' };
  ws1.getRow(2).height = 18;
  ws1.getRow(3).height = 6;

  const h1 = ['#', 'Emp ID', 'Full Name', 'Department', 'Designation', 'Emp Type', 'Work Location', 'Work Mode', 'Join Date', 'Status', 'Phone', 'Work Email', 'Manager', 'Grade', 'Salary', 'Portal'];
  applyHeaderRow(ws1, h1, 4);
  ws1.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: h1.length } };

  rows.forEach((r, idx) => {
    const row = ws1.getRow(5 + idx);
    row.height = 16;
    const bg = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC';
    const jd = parseJoinDate(r);
    const vals = [
      idx + 1, r.emp_id, r.full_name, r.department, r.job_title,
      r.employment_type, r.work_location || '', r.work_mode || '', jd,
      r.employment_status || '', r.phone_number || '', r.work_email || '',
      r.manager_name || r.manager_emp_id || '', r.grade || '',
      r.salary != null ? Number(r.salary) : '', yn(r.portal_enabled),
    ];
    vals.forEach((v, i) => {
      const c = row.getCell(i + 1);
      c.value = v;
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      c.alignment = { vertical: 'middle', horizontal: i === 0 || i === 14 ? 'center' : 'left', wrapText: false };
      c.border = THIN_BORDER;
      if (i === 8 && jd instanceof Date) c.style = { ...c.style, numFmt: dateStyle.numFmt };
      if (i === 9) c.font = { color: { argb: String(v).toLowerCase() === 'active' ? 'FF059669' : 'FF64748B' }, bold: true };
    });
  });

  ws1.getRow(5 + rows.length).height = 18;
  ws1.getRow(5 + rows.length).getCell(1).value = `Total: ${rows.length} employees`;
  ws1.getRow(5 + rows.length).getCell(1).font = { bold: true };
  ws1.getRow(5 + rows.length).getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };

  // ── Sheet 2: Personal & Bank Details ──
  const ws2 = wb.addWorksheet('Personal & Bank Details', {
    views: [{ state: 'frozen', ySplit: 4 }],
  });

  ws2.mergeCells('A1:S1');
  const t2 = ws2.getCell('A1');
  t2.value = `${COMPANY} — Personal & Bank Details (Confidential)`;
  t2.font = { size: 15, bold: true, color: { argb: 'FF7C2D12' } };
  t2.alignment = { horizontal: 'center', vertical: 'middle' };
  t2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7ED' } };
  ws2.getRow(1).height = 28;

  ws2.mergeCells('A2:S2');
  const m2 = ws2.getCell('A2');
  m2.value = `Generated: ${formatDateDDMMMYYYY(new Date())}   |   Total Employees: ${rows.length}   |   ⚠ CONFIDENTIAL — Handle with care`;
  m2.font = { size: 9, italic: true, color: { argb: 'FF92400E' } };
  m2.alignment = { horizontal: 'center', vertical: 'middle' };
  ws2.getRow(2).height = 18;
  ws2.getRow(3).height = 6;

  const h2 = ['Emp ID', 'Full Name', 'Date of Birth', 'Gender', 'Nationality', 'Marital Status', 'Religion', 'Personal Email', 'Home Address', 'Bank Name', 'Account No', 'IFSC Code', 'Branch Address', 'Passport No', 'Passport Expiry', 'Emirates ID', 'Emirates ID Expiry', 'Visa Type', 'Visa Expiry'];
  applyHeaderRow(ws2, h2, 4);
  ws2.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: h2.length } };

  const dateColsWs2 = new Set([2, 13, 15, 17]);
  rows.forEach((r, idx) => {
    const row = ws2.getRow(5 + idx);
    row.height = 16;
    const bg = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC';
    const dob = r.date_of_birth ? new Date(`${String(r.date_of_birth).split('T')[0]}T12:00:00`) : '';
    const pex = r.passport_expiry ? new Date(`${String(r.passport_expiry).split('T')[0]}T12:00:00`) : '';
    const eex = r.emirates_id_expiry ? new Date(`${String(r.emirates_id_expiry).split('T')[0]}T12:00:00`) : '';
    const vex = r.visa_expiry_date ? new Date(`${String(r.visa_expiry_date).split('T')[0]}T12:00:00`) : '';
    const vals = [
      r.emp_id, r.full_name, dob, r.gender || '', r.nationality || '',
      r.marital_status || '', r.religion || '', r.personal_email || '',
      r.home_address || '', r.bank_name || '', r.bank_account_no || '',
      r.ifsc_code || '', r.branch_address || '', r.passport_number || '',
      pex, r.emirates_id_number || '', eex, r.visa_type || '', vex,
    ];
    vals.forEach((v, i) => {
      const c = row.getCell(i + 1);
      c.value = v;
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      c.alignment = { vertical: 'middle', horizontal: 'left', wrapText: false };
      c.border = THIN_BORDER;
      if (dateColsWs2.has(i) && v instanceof Date) c.style = { ...c.style, numFmt: dateStyle.numFmt };
    });
  });

  ws2.getRow(5 + rows.length).height = 18;
  ws2.getRow(5 + rows.length).getCell(1).value = `Total: ${rows.length} employees`;
  ws2.getRow(5 + rows.length).getCell(1).font = { bold: true };
  ws2.getRow(5 + rows.length).getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };

  // ── Auto column widths ──
  [ws1, ws2].forEach((ws) => {
    ws.columns.forEach((col) => {
      let max = 10;
      col.eachCell({ includeEmpty: false }, (cell) => {
        const len = cell.value != null ? String(cell.value).length : 0;
        if (len > max) max = len;
      });
      col.width = Math.min(max + 2, 48);
    });
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  await wb.xlsx.write(res);
}

function buildPDF(res, rows, appliedFilters) {
  const generatedAt = new Date();
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28, bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  doc.pipe(res);

  const PAGE_W = doc.page.width;
  const MARGIN = 28;
  const CONTENT_W = PAGE_W - MARGIN * 2;

  function drawPageHeader() {
    doc.save();
    doc.rect(MARGIN, MARGIN, CONTENT_W, 30).fill('#0F766E');
    doc.fontSize(12).fillColor('#ffffff').font('Helvetica-Bold')
      .text(`${COMPANY} — Employee List`, MARGIN + 10, MARGIN + 9, { width: CONTENT_W - 20 });
    doc.restore();
    doc.fontSize(7.5).fillColor('#475569').font('Helvetica')
      .text(
        `Generated: ${formatDateDDMMMYYYY(generatedAt)}   |   ${formatFilterSummary(appliedFilters)}   |   Total: ${rows.length}`,
        MARGIN, MARGIN + 36, { width: CONTENT_W },
      );
    doc.moveTo(MARGIN, MARGIN + 50).lineTo(MARGIN + CONTENT_W, MARGIN + 50).lineWidth(0.5).stroke('#CBD5E1');
  }

  function drawFooter(pageIdx, total) {
    doc.fontSize(6.5).fillColor('#94A3B8').font('Helvetica')
      .text(
        `${COMPANY} Confidential  |  Page ${pageIdx + 1} of ${total}  |  Personal & bank details: Excel only  |  ${generatedAt.toUTCString()}`,
        MARGIN, doc.page.height - 22, { width: CONTENT_W, align: 'center' },
      );
  }

  const cols = [
    { w: 20, title: '#', key: (r, i) => String(i + 1), align: 'center' },
    { w: 50, title: 'Emp ID', key: (r) => r.emp_id || '' },
    { w: 82, title: 'Full Name', key: (r) => r.full_name || '' },
    { w: 62, title: 'Department', key: (r) => r.department || '' },
    { w: 70, title: 'Designation', key: (r) => r.job_title || '' },
    { w: 48, title: 'Emp Type', key: (r) => r.employment_type || '' },
    { w: 56, title: 'Location', key: (r) => r.work_location || '' },
    { w: 40, title: 'Mode', key: (r) => r.work_mode || '' },
    { w: 56, title: 'Join Date', key: (r) => formatDateDDMMMYYYY(parseJoinDate(r)) },
    { w: 48, title: 'Status', key: (r) => r.employment_status || '', align: 'center' },
    { w: 50, title: 'Phone', key: (r) => r.phone_number || '' },
    { w: 88, title: 'Work Email', key: (r) => r.work_email || '' },
    { w: 66, title: 'Manager', key: (r) => r.manager_name || r.manager_emp_id || '' },
    { w: 28, title: 'Grade', key: (r) => r.grade || '', align: 'center' },
    { w: 40, title: 'Salary', key: (r) => r.salary != null ? String(r.salary) : '', align: 'right' },
  ];

  const TABLE_TOP = MARGIN + 60;
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
    doc.rect(MARGIN, y, TABLE_W, HEADER_H).fill('#0F766E');
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
    if (y + ROW_H > doc.page.height - 36) {
      doc.addPage();
      drawPageHeader();
      y = TABLE_TOP;
      y = drawTableHeader(y);
    }
    const bg = idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
    let x = MARGIN;
    doc.save();
    cols.forEach((c) => {
      doc.rect(x, y, c.w, ROW_H).fillAndStroke(bg, '#E2E8F0');
      x += c.w;
    });
    doc.restore();
    x = MARGIN;
    doc.fontSize(6.5).font('Helvetica');
    cols.forEach((c, ci) => {
      const raw = c.key(r, idx);
      const maxChars = Math.floor(c.w / 3.8);
      const val = truncate(raw, maxChars);
      if (ci === 9) {
        doc.fillColor(String(raw).toLowerCase() === 'active' ? '#059669' : '#64748B').font('Helvetica-Bold');
      } else {
        doc.fillColor('#1E293B').font('Helvetica');
      }
      doc.text(val, x + 3, y + 4, { width: c.w - 6, align: c.align || 'left', ellipsis: true });
      x += c.w;
    });
    y += ROW_H;
  });

  const range = doc.bufferedPageRange();
  for (let p = 0; p < range.count; p += 1) {
    doc.switchToPage(range.start + p);
    drawFooter(p, range.count);
  }
  doc.end();
}

module.exports = { buildExcel, buildPDF, formatFilterSummary, formatDateDDMMMYYYY };
