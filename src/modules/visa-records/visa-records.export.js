'use strict';

const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const COMPANY = process.env.COMPANY_NAME || 'Company';

function formatFilterSummary(q) {
  const parts = [];
  if (q.search) parts.push(`search=${q.search}`);
  if (q.department) parts.push(`dept=${q.department}`);
  if (q.location) parts.push(`loc=${q.location}`);
  if (q.visaType) parts.push(`visaType=${q.visaType}`);
  if (q.expiryWindow && q.expiryWindow !== 'all') parts.push(`window=${q.expiryWindow}`);
  return parts.length ? parts.join(' | ') : 'none';
}

function formatDateDDMMMYYYY(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d).slice(0, 10);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mon = dt.toLocaleString('en-GB', { month: 'short' });
  const yy = dt.getFullYear();
  return `${dd}-${mon}-${yy}`;
}

async function buildExcel(res, rows, appliedFilters) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Visa Records', { views: [{ state: 'frozen', ySplit: 4 }] });

  const lastCol = 'O';
  ws.mergeCells(`A1:${lastCol}1`);
  ws.getCell('A1').value = `${COMPANY} — Visa & Nationality Compliance`;
  ws.getCell('A1').font = { size: 14, bold: true };
  ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };

  ws.mergeCells(`A2:${lastCol}2`);
  ws.getCell('A2').value = `Generated: ${formatDateDDMMMYYYY(new Date())} | Filters: ${formatFilterSummary(appliedFilters)}`;
  ws.getRow(3).values = [];

  const headers = [
    '#',
    'Employee Name',
    'Emp ID',
    'Department',
    'Nationality',
    'Passport No',
    'Passport Expiry',
    'Visa Type',
    'Visa Number',
    'Visa Expiry',
    'Sponsoring Entity',
    'Emirates ID No',
    'Emirates ID Expiry',
    'Status',
    'Created At',
  ];
  const hr = ws.getRow(4);
  headers.forEach((h, i) => {
    const c = hr.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
  });
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: headers.length } };

  rows.forEach((r, idx) => {
    const row = ws.getRow(5 + idx);
    const st = r.compliance_status || 'Valid';
    let bg = 'FFFFFFFF';
    if (st === 'Expired') bg = 'FFFCEBEB';
    else if (st === 'Expiring Soon') bg = 'FFFAEEDA';
    const vals = [
      idx + 1,
      r.full_name || '',
      r.emp_id || '',
      r.department || '',
      r.nationality || '',
      r.passport_number || '',
      formatDateDDMMMYYYY(r.passport_expiry_date),
      r.visa_type_display || r.visa_type_name || '',
      r.visa_number || '',
      formatDateDDMMMYYYY(r.visa_expiry_date),
      r.sponsoring_entity || '',
      r.emirates_id_number || '',
      formatDateDDMMMYYYY(r.emirates_id_expiry),
      st,
      formatDateDDMMMYYYY(r.created_at),
    ];
    vals.forEach((v, i) => {
      const c = row.getCell(i + 1);
      c.value = v;
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
    });
  });

  const summaryRow = ws.getRow(5 + rows.length);
  summaryRow.getCell(1).value = `Total: ${rows.length}`;
  summaryRow.font = { bold: true };

  ws.columns.forEach((col) => {
    let max = 10;
    col.eachCell({ includeEmpty: true }, (cell) => {
      const len = cell.value != null ? String(cell.value).length : 0;
      if (len > max) max = len;
    });
    col.width = Math.min(Math.max(max + 1, 10), 40);
  });

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  await wb.xlsx.write(res);
}

function buildPDF(res, rows, appliedFilters) {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: 24,
    bufferPages: true,
  });
  res.setHeader('Content-Type', 'application/pdf');
  doc.pipe(res);

  const cols = [
    { w: 18, t: '#' },
    { w: 72, t: 'Name' },
    { w: 44, t: 'Emp' },
    { w: 52, t: 'Dept' },
    { w: 48, t: 'Nat' },
    { w: 52, t: 'PPT#' },
    { w: 52, t: 'PPT exp' },
    { w: 50, t: 'Visa T' },
    { w: 48, t: 'Visa #' },
    { w: 52, t: 'Visa exp' },
    { w: 56, t: 'Sponsor' },
    { w: 44, t: 'EID' },
    { w: 48, t: 'EID exp' },
    { w: 44, t: 'Status' },
    { w: 48, t: 'Created' },
  ];

  function trunc(s, n) {
    const t = String(s ?? '');
    return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
  }

  doc.fontSize(11).fillColor('#0f172a').text(`${COMPANY} — Visa Compliance`, 24, 20, {
    width: doc.page.width - 48,
    align: 'center',
  });
  doc.fontSize(8).fillColor('#64748b').text(formatFilterSummary(appliedFilters), 24, 38, {
    width: doc.page.width - 48,
  });

  let y = 54;
  const rowH = 14;
  const left = 24;
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
    if (y + rowH > doc.page.height - 40) {
      doc.addPage();
      y = 30;
      drawHead();
    }
    const st = r.compliance_status || 'Valid';
    let bg = '#ffffff';
    if (st === 'Expired') bg = '#FCEBEB';
    else if (st === 'Expiring Soon') bg = '#FAEEDA';
    let x = left;
    doc.save();
    cols.forEach((c) => {
      doc.rect(x, y, c.w, rowH).fillAndStroke(bg, '#e5e7eb');
      x += c.w;
    });
    doc.restore();
    x = left;
    doc.fontSize(5.5).fillColor('#111');
    const cells = [
      String(idx + 1),
      trunc(r.full_name, 22),
      trunc(r.emp_id, 10),
      trunc(r.department, 12),
      trunc(r.nationality, 10),
      trunc(r.passport_number, 12),
      formatDateDDMMMYYYY(r.passport_expiry_date),
      trunc(r.visa_type_display || r.visa_type_name, 12),
      trunc(r.visa_number, 12),
      formatDateDDMMMYYYY(r.visa_expiry_date),
      trunc(r.sponsoring_entity, 14),
      trunc(r.emirates_id_number, 10),
      formatDateDDMMMYYYY(r.emirates_id_expiry),
      trunc(st, 10),
      formatDateDDMMMYYYY(r.created_at),
    ];
    cells.forEach((val, i) => {
      doc.text(String(val), x + 2, y + 3, { width: cols[i].w - 4, ellipsis: true });
      x += cols[i].w;
    });
    y += rowH;
  });

  const range = doc.bufferedPageRange();
  const tot = range.count;
  for (let p = 0; p < tot; p += 1) {
    doc.switchToPage(range.start + p);
    doc.fontSize(7).fillColor('#64748b').text(
      `Page ${p + 1} of ${tot}`,
      24,
      doc.page.height - 22,
      { width: doc.page.width - 48, align: 'center' },
    );
  }
  doc.end();
}

module.exports = { buildExcel, buildPDF, formatDateDDMMMYYYY, formatFilterSummary };
