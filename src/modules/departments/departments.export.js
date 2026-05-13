'use strict';

const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const COMPANY = process.env.COMPANY_NAME || 'Company';

function formatFilterSummary(q) {
  const parts = [];
  if (q.search) parts.push(`search=${q.search}`);
  if (q.status && String(q.status).toLowerCase() !== 'all') parts.push(`status=${q.status}`);
  if (q.parent_id) parts.push(`parent_id=${q.parent_id}`);
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
  if (r.status) return String(r.status).toLowerCase() === 'active' ? 'Active' : 'Inactive';
  return r.is_active ? 'Active' : 'Inactive';
}

/**
 * @param {import('express').Response} res
 * @param {Array<object>} rows
 * @param {object} appliedFilters
 */
async function buildExcel(res, rows, appliedFilters) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Departments', {
    views: [{ state: 'frozen', ySplit: 4 }],
  });

  ws.mergeCells('A1:I1');
  const title = ws.getCell('A1');
  title.value = `${COMPANY} — Departments`;
  title.font = { size: 14, bold: true };
  title.alignment = { vertical: 'middle', horizontal: 'center' };

  ws.mergeCells('A2:I2');
  ws.getCell('A2').value = `Generated on: ${formatDateDDMMMYYYY(new Date())} | Filters: ${formatFilterSummary(appliedFilters)}`;
  ws.getCell('A2').font = { size: 11 };

  ws.getRow(3).values = [];

  const headers = [
    '#',
    'Code',
    'Department Name',
    'Parent Dept',
    'Description',
    'Manager',
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
    const vals = [
      idx + 1,
      r.code || '',
      r.name || '',
      r.parent_name || '',
      r.description || '',
      r.head || r.manager_emp_id || '',
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

  const totalRow = ws.getRow(5 + rows.length);
  totalRow.getCell(1).value = `Total records: ${rows.length}`;
  totalRow.font = { bold: true };

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

/**
 * @param {import('express').Response} res
 * @param {Array<object>} rows
 * @param {object} appliedFilters
 */
function buildPDF(res, rows, appliedFilters) {
  const generatedAt = new Date();
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: 36,
    bufferPages: true,
  });

  res.setHeader('Content-Type', 'application/pdf');
  doc.pipe(res);

  const cols = [
    { w: 28, title: '#' },
    { w: 70, title: 'Code' },
    { w: 120, title: 'Department' },
    { w: 90, title: 'Parent' },
    { w: 130, title: 'Description' },
    { w: 90, title: 'Manager' },
    { w: 55, title: 'Count' },
    { w: 50, title: 'Status' },
    { w: 75, title: 'Created' },
  ];

  function truncate(s, max) {
    const t = String(s ?? '');
    return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
  }

  function drawPageChrome(pageIndex, totalPages) {
    doc.fontSize(8).fillColor('#64748b');
    doc.text(
      `Page ${pageIndex + 1} of ${totalPages}  ·  ${generatedAt.toISOString()}`,
      36,
      doc.page.height - 32,
      { width: doc.page.width - 72, align: 'center' },
    );
  }

  doc.rect(36, 36, 60, 22).stroke('#cbd5e1');
  doc.fontSize(8).fillColor('#64748b').text('LOGO', 52, 44);
  doc.fontSize(14).fillColor('#0f172a').text('Departments Report', 110, 38, {
    align: 'right',
    width: doc.page.width - 146,
  });
  doc.fontSize(9)
    .fillColor('#475569')
    .text(`Generated: ${formatDateDDMMMYYYY(generatedAt)} | Filters: ${formatFilterSummary(appliedFilters)}`, 36, 64, {
      width: doc.page.width - 72,
    });
  doc.moveTo(36, 82).lineTo(doc.page.width - 36, 82).stroke('#e2e8f0');

  let y = 92;
  const rowH = 18;
  const tableLeft = 36;
  const tableWidth = cols.reduce((s, c) => s + c.w, 0);

  function drawTableHeader() {
    let x = tableLeft;
    doc.save();
    doc.rect(tableLeft, y, tableWidth, rowH).fill('#0F766E');
    doc.fontSize(8).fillColor('#ffffff');
    cols.forEach((c) => {
      doc.text(c.title, x + 3, y + 5, { width: c.w - 6 });
      x += c.w;
    });
    doc.restore();
    y += rowH;
  }

  drawTableHeader();

  rows.forEach((r, idx) => {
    if (y + rowH > doc.page.height - 48) {
      doc.addPage();
      y = 50;
      drawTableHeader();
    }
    const bg = idx % 2 === 0 ? '#ffffff' : '#F5F5F5';
    let x = tableLeft;
    doc.save();
    cols.forEach((c) => {
      doc.rect(x, y, c.w, rowH).fillAndStroke(bg, '#d1d5db');
      x += c.w;
    });
    doc.restore();
    x = tableLeft;
    doc.fontSize(7).fillColor('#111827');
    const cells = [
      String(idx + 1),
      truncate(r.code, 18),
      truncate(r.name, 40),
      truncate(r.parent_name, 28),
      truncate(r.description, 60),
      truncate(r.head || r.manager_emp_id, 28),
      String(r.employee_count ?? r.employeeCount ?? 0),
      truncate(rowStatus(r), 12),
      formatDateDDMMMYYYY(r.created_at),
    ];
    cells.forEach((val, i) => {
      doc.text(val, x + 3, y + 5, { width: cols[i].w - 6, ellipsis: true });
      x += cols[i].w;
    });
    y += rowH;
  });

  const range = doc.bufferedPageRange();
  const totalPages = range.count;
  for (let i = 0; i < totalPages; i += 1) {
    doc.switchToPage(range.start + i);
    drawPageChrome(i, totalPages);
  }

  doc.end();
}

module.exports = { buildExcel, buildPDF, formatDateDDMMMYYYY, formatFilterSummary };
