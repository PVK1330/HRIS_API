'use strict';

const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const COMPANY = process.env.COMPANY_NAME || 'Company';

function formatFilterSummary(q) {
  const parts = [];
  if (q.search) parts.push(`search=${q.search}`);
  if (q.department) parts.push(`department=${q.department}`);
  if (q.status) parts.push(`status=${q.status}`);
  if (q.workMode) parts.push(`workMode=${q.workMode}`);
  if (q.jobTitle) parts.push(`jobTitle=${q.jobTitle}`);
  if (q.workLocation) parts.push(`workLocation=${q.workLocation}`);
  if (q.joinDateFrom) parts.push(`joinDateFrom=${q.joinDateFrom}`);
  if (q.joinDateTo) parts.push(`joinDateTo=${q.joinDateTo}`);
  return parts.length ? parts.join(' | ') : 'none';
}

function formatDateDDMMMYYYY(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mon = dt.toLocaleString('en-GB', { month: 'short' });
  const yy = dt.getFullYear();
  return `${dd}-${mon}-${yy}`;
}

function yn(v) {
  return v ? 'Yes' : 'No';
}

function parseJoinDate(row) {
  if (!row.join_date) return '';
  if (row.join_date instanceof Date) return row.join_date;
  const s = String(row.join_date);
  const d = new Date(s.includes('T') ? s : `${s}T12:00:00`);
  return Number.isNaN(d.getTime()) ? s : d;
}

async function buildExcel(res, rows) {
  const wb = new ExcelJS.Workbook();
  const dateStyle = { numFmt: 'dd-mmm-yyyy' };

  const ws1 = wb.addWorksheet('Employee List', { views: [{ state: 'frozen', ySplit: 4 }] });
  ws1.mergeCells('A1:Q1');
  ws1.getCell('A1').value = `${COMPANY} — Employee List`;
  ws1.getCell('A1').font = { size: 14, bold: true };
  ws1.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  ws1.mergeCells('A2:Q2');
  ws1.getCell('A2').value = `Generated on: ${formatDateDDMMMYYYY(new Date())}`;
  ws1.getRow(3).values = [];

  const h1 = [
    '#',
    'Emp ID',
    'Full Name',
    'Department',
    'Designation',
    'Employment Type',
    'Work Location',
    'Work Mode',
    'Join Date',
    'Status',
    'Phone',
    'Work Email',
    'Reporting Manager',
    'Grade',
    'Salary',
    'Portal Enabled',
  ];
  const r4 = ws1.getRow(4);
  h1.forEach((h, i) => {
    const c = r4.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
  });
  ws1.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: h1.length } };

  rows.forEach((r, idx) => {
    const row = ws1.getRow(5 + idx);
    const bg = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC';
    const jd = parseJoinDate(r);
    const cells = [
      idx + 1,
      r.emp_id,
      r.full_name,
      r.department,
      r.job_title,
      r.employment_type,
      r.work_location || '',
      r.work_mode || '',
      jd,
      r.employment_status || '',
      r.phone_number || '',
      r.work_email || '',
      r.manager_name || r.manager_emp_id || '',
      r.grade || '',
      r.salary != null ? Number(r.salary) : '',
      yn(r.portal_enabled),
    ];
    cells.forEach((v, i) => {
      const c = row.getCell(i + 1);
      c.value = v;
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      if (i === 8 && jd instanceof Date) c.style = dateStyle;
    });
  });
  ws1.getRow(5 + rows.length).getCell(1).value = `Total: ${rows.length}`;
  ws1.getRow(5 + rows.length).font = { bold: true };

  const ws2 = wb.addWorksheet('Personal & Bank Details', { views: [{ state: 'frozen', ySplit: 4 }] });
  ws2.mergeCells('A1:T1');
  ws2.getCell('A1').value = `${COMPANY} — Personal & Bank Details`;
  ws2.getCell('A1').font = { size: 14, bold: true };
  ws2.mergeCells('A2:T2');
  ws2.getCell('A2').value = `Generated on: ${formatDateDDMMMYYYY(new Date())}`;
  ws2.getRow(3).values = [];
  const h2 = [
    'Emp ID',
    'Full Name',
    'Date of Birth',
    'Gender',
    'Nationality',
    'Marital Status',
    'Religion',
    'Personal Email',
    'Home Address',
    'Bank Name',
    'Account No',
    'IFSC Code',
    'Branch Address',
    'Passport No',
    'Passport Expiry',
    'Emirates ID',
    'Emirates ID Expiry',
    'Visa Type',
    'Visa Expiry',
  ];
  const r4b = ws2.getRow(4);
  h2.forEach((h, i) => {
    const c = r4b.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
  });
  ws2.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: h2.length } };

  rows.forEach((r, idx) => {
    const row = ws2.getRow(5 + idx);
    const bg = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC';
    const dob = r.date_of_birth ? new Date(`${String(r.date_of_birth).split('T')[0]}T12:00:00`) : '';
    const pex = r.passport_expiry ? new Date(`${String(r.passport_expiry).split('T')[0]}T12:00:00`) : '';
    const eex = r.emirates_id_expiry ? new Date(`${String(r.emirates_id_expiry).split('T')[0]}T12:00:00`) : '';
    const vex = r.visa_expiry_date ? new Date(`${String(r.visa_expiry_date).split('T')[0]}T12:00:00`) : '';
    const vals = [
      r.emp_id,
      r.full_name,
      dob,
      r.gender || '',
      r.nationality || '',
      r.marital_status || '',
      r.religion || '',
      r.personal_email || '',
      r.home_address || '',
      r.bank_name || '',
      r.bank_account_no || '',
      r.ifsc_code || '',
      r.branch_address || '',
      r.passport_number || '',
      pex,
      r.emirates_id_number || '',
      eex,
      r.visa_type || '',
      vex,
    ];
    vals.forEach((v, i) => {
      const c = row.getCell(i + 1);
      c.value = v;
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      if ([2, 13, 15, 17].includes(i) && v instanceof Date) c.style = dateStyle;
    });
  });
  ws2.getRow(5 + rows.length).getCell(1).value = `Total: ${rows.length}`;
  ws2.getRow(5 + rows.length).font = { bold: true };

  [ws1, ws2].forEach((ws) => {
    ws.columns.forEach((col) => {
      let max = 10;
      col.eachCell({ includeEmpty: true }, (cell) => {
        const len = cell.value != null ? String(cell.value).length : 0;
        if (len > max) max = len;
      });
      col.width = Math.min(Math.max(max + 2, 10), 48);
    });
  });

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  await wb.xlsx.write(res);
}

function buildPDF(res, rows, appliedFilters) {
  const generatedAt = new Date();
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: 28,
    bufferPages: true,
  });
  res.setHeader('Content-Type', 'application/pdf');
  doc.pipe(res);

  const cols = [
    { w: 20, t: '#' },
    { w: 52, t: 'Emp ID' },
    { w: 85, t: 'Name' },
    { w: 62, t: 'Dept' },
    { w: 72, t: 'Designation' },
    { w: 48, t: 'Type' },
    { w: 58, t: 'Location' },
    { w: 42, t: 'Mode' },
    { w: 58, t: 'Join' },
    { w: 48, t: 'Status' },
    { w: 52, t: 'Phone' },
    { w: 92, t: 'Email' },
    { w: 68, t: 'Manager' },
    { w: 32, t: 'Grd' },
    { w: 42, t: 'Salary' },
    { w: 28, t: 'Prt' },
  ];

  function trunc(s, n) {
    const t = String(s ?? '');
    return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
  }

  doc.fontSize(12).fillColor('#0f172a').text(`${COMPANY} — Employee List`, 28, 28, {
    width: doc.page.width - 56,
    align: 'center',
  });
  doc.fontSize(8)
    .fillColor('#475569')
    .text(`Generated: ${formatDateDDMMMYYYY(generatedAt)} | ${formatFilterSummary(appliedFilters)}`, 28, 46, {
      width: doc.page.width - 56,
    });
  doc.moveTo(28, 62).lineTo(doc.page.width - 28, 62).stroke('#e2e8f0');

  let y = 70;
  const rowH = 14;
  const left = 28;
  const tw = cols.reduce((a, c) => a + c.w, 0);

  function drawHead() {
    let x = left;
    doc.save();
    doc.rect(left, y, tw, rowH).fill('#0F766E');
    doc.fontSize(6.5).fillColor('#ffffff');
    cols.forEach((c) => {
      doc.text(c.t, x + 2, y + 3, { width: c.w - 4 });
      x += c.w;
    });
    doc.restore();
    y += rowH;
  }

  drawHead();

  rows.forEach((r, idx) => {
    if (y + rowH > doc.page.height - 56) {
      doc.addPage();
      y = 36;
      drawHead();
    }
    const bg = idx % 2 === 0 ? '#ffffff' : '#F5F5F5';
    let x = left;
    doc.save();
    cols.forEach((c) => {
      doc.rect(x, y, c.w, rowH).fillAndStroke(bg, '#d1d5db');
      x += c.w;
    });
    doc.restore();
    x = left;
    doc.fontSize(6).fillColor('#111');
    const cells = [
      String(idx + 1),
      trunc(r.emp_id, 10),
      trunc(r.full_name, 26),
      trunc(r.department, 18),
      trunc(r.job_title, 22),
      trunc(r.employment_type, 10),
      trunc(r.work_location, 14),
      trunc(r.work_mode, 10),
      formatDateDDMMMYYYY(parseJoinDate(r)),
      trunc(r.employment_status, 10),
      trunc(r.phone_number, 12),
      trunc(r.work_email, 36),
      trunc(r.manager_name || r.manager_emp_id, 18),
      trunc(r.grade, 6),
      r.salary != null ? String(r.salary) : '',
      yn(r.portal_enabled).slice(0, 3),
    ];
    cells.forEach((val, i) => {
      doc.text(String(val), x + 2, y + 3, { width: cols[i].w - 4, ellipsis: true });
      x += cols[i].w;
    });
    y += rowH;
  });

  const noteY = Math.min(y + 10, doc.page.height - 48);
  doc.fontSize(8).fillColor('#b45309').text(
    'Personal & bank details are available in the Excel export only.',
    left,
    noteY,
    { width: doc.page.width - 56 },
  );

  const range = doc.bufferedPageRange();
  const tot = range.count;
  for (let p = 0; p < tot; p += 1) {
    doc.switchToPage(range.start + p);
    doc.fontSize(7).fillColor('#64748b').text(
      `Page ${p + 1} of ${tot}  ·  ${generatedAt.toISOString()}`,
      28,
      doc.page.height - 28,
      { width: doc.page.width - 56, align: 'center' },
    );
  }

  doc.end();
}

module.exports = { buildExcel, buildPDF, formatFilterSummary, formatDateDDMMMYYYY };
