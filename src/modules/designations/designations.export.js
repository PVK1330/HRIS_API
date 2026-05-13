'use strict';

const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const COMPANY = process.env.COMPANY_NAME || 'Company';

function formatFilterSummary(q) {
  const parts = [];
  if (q.search) parts.push(`search=${q.search}`);
  if (q.status && String(q.status).toLowerCase() !== 'all') parts.push(`status=${q.status}`);
  const did = q.department_id ?? q.departmentId;
  if (did) parts.push(`department_id=${did}`);
  if (q.department_name || q.departmentName) {
    parts.push(`department_name=${q.department_name || q.departmentName}`);
  }
  if (q.grade) parts.push(`grade=${q.grade}`);
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

function rowStatus(r) {
  if (r.status && typeof r.status === 'string') {
    return String(r.status).toLowerCase() === 'active' ? 'Active' : 'Inactive';
  }
  return r.is_active ? 'Active' : 'Inactive';
}

async function buildExcel(res, rows, appliedFilters) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Designations', { views: [{ state: 'frozen', ySplit: 4 }] });

  ws.mergeCells('A1:H1');
  const t1 = ws.getCell('A1');
  t1.value = `${COMPANY} — Designations`;
  t1.font = { size: 14, bold: true };
  t1.alignment = { vertical: 'middle', horizontal: 'center' };

  ws.mergeCells('A2:H2');
  ws.getCell('A2').value = `Generated on: ${formatDateDDMMMYYYY(new Date())} | Filters: ${formatFilterSummary(appliedFilters)}`;
  ws.getRow(3).values = [];

  const headers = [
    '#',
    'Designation Name',
    'Department',
    'Grade',
    'Description',
    'Employee Count',
    'Status',
    'Created At',
  ];
  const headerRow = ws.getRow(4);
  headers.forEach((h, i) => {
    const c = headerRow.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
    c.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: headers.length } };

  rows.forEach((r, idx) => {
    const row = ws.getRow(5 + idx);
    const bg = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC';
    const dept = r.department_name || r.department || '';
    const vals = [
      idx + 1,
      r.name || '',
      dept,
      r.grade || '',
      r.description || '',
      r.employee_count ?? r.employeeCount ?? 0,
      rowStatus(r),
      formatDateDDMMMYYYY(r.created_at),
    ];
    vals.forEach((v, i) => {
      const c = row.getCell(i + 1);
      c.value = v;
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
    });
  });

  ws.getRow(5 + rows.length).getCell(1).value = `Total records: ${rows.length}`;
  ws.getRow(5 + rows.length).font = { bold: true };

  ws.columns.forEach((col) => {
    let max = 10;
    col.eachCell({ includeEmpty: true }, (cell) => {
      const len = cell.value != null ? String(cell.value).length : 0;
      if (len > max) max = len;
    });
    col.width = Math.min(Math.max(max + 2, 12), 45);
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
    layout: 'portrait',
    margin: 36,
    bufferPages: true,
  });
  res.setHeader('Content-Type', 'application/pdf');
  doc.pipe(res);

  const cols = [
    { w: 22, title: '#' },
    { w: 110, title: 'Name' },
    { w: 85, title: 'Dept' },
    { w: 40, title: 'Grade' },
    { w: 120, title: 'Description' },
    { w: 38, title: 'Cnt' },
    { w: 48, title: 'Status' },
    { w: 68, title: 'Created' },
  ];

  function truncate(s, max) {
    const t = String(s ?? '');
    return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
  }

  function drawFooter(pageIndex, totalPages) {
    doc.fontSize(8).fillColor('#64748b');
    doc.text(
      `Page ${pageIndex + 1} of ${totalPages}  ·  ${generatedAt.toISOString()}`,
      36,
      doc.page.height - 32,
      { width: doc.page.width - 72, align: 'center' },
    );
  }

  doc.rect(36, 36, 50, 18).stroke('#cbd5e1');
  doc.fontSize(7).fillColor('#64748b').text('LOGO', 48, 42);
  doc.fontSize(13).fillColor('#0f172a').text('Designations Report', 95, 36, {
    align: 'right',
    width: doc.page.width - 130,
  });
  doc.fontSize(8)
    .fillColor('#475569')
    .text(`Generated: ${formatDateDDMMMYYYY(generatedAt)} | ${formatFilterSummary(appliedFilters)}`, 36, 58, {
      width: doc.page.width - 72,
    });
  doc.moveTo(36, 74).lineTo(doc.page.width - 36, 74).stroke('#e2e8f0');

  let y = 82;
  const rowH = 16;
  const tableLeft = 36;
  const tableWidth = cols.reduce((s, c) => s + c.w, 0);

  function drawHeader() {
    let x = tableLeft;
    doc.save();
    doc.rect(tableLeft, y, tableWidth, rowH).fill('#0F766E');
    doc.fontSize(7).fillColor('#ffffff');
    cols.forEach((c) => {
      doc.text(c.title, x + 2, y + 4, { width: c.w - 4 });
      x += c.w;
    });
    doc.restore();
    y += rowH;
  }

  drawHeader();

  rows.forEach((r, idx) => {
    if (y + rowH > doc.page.height - 44) {
      doc.addPage();
      y = 44;
      drawHeader();
    }
    const bg = idx % 2 === 0 ? '#ffffff' : '#F5F5F5';
    let x = tableLeft;
    doc.save();
    cols.forEach((c) => {
      doc.rect(x, y, c.w, rowH).fillAndStroke(bg, '#d1d5db');
      x += c.w;
    });
    doc.restore();
    const dept = r.department_name || r.department || '';
    x = tableLeft;
    doc.fontSize(6.5).fillColor('#111827');
    const cells = [
      String(idx + 1),
      truncate(r.name, 48),
      truncate(dept, 34),
      truncate(r.grade, 10),
      truncate(r.description, 70),
      String(r.employee_count ?? r.employeeCount ?? 0),
      truncate(rowStatus(r), 10),
      formatDateDDMMMYYYY(r.created_at),
    ];
    cells.forEach((val, i) => {
      doc.text(val, x + 2, y + 4, { width: cols[i].w - 4, ellipsis: true });
      x += cols[i].w;
    });
    y += rowH;
  });

  const range = doc.bufferedPageRange();
  const totalPages = range.count;
  for (let i = 0; i < totalPages; i += 1) {
    doc.switchToPage(range.start + i);
    drawFooter(i, totalPages);
  }
  doc.end();
}

module.exports = { buildExcel, buildPDF, formatDateDDMMMYYYY, formatFilterSummary };
