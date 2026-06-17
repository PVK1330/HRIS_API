'use strict';

const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const BRAND = { color: 'FF0F766E', hex: '#0F766E' };
const COMPANY = process.env.COMPANY_NAME || 'Company';

function formatFilterSummary(q) {
  const parts = [];
  if (q.search) parts.push(`Search: "${q.search}"`);
  if (q.status && String(q.status).toLowerCase() !== 'all') parts.push(`Status: ${q.status}`);
  if (q.parent_id) parts.push(`Parent ID: ${q.parent_id}`);
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

function rowStatus(r) {
  if (r.status) return String(r.status).toLowerCase() === 'active' ? 'Active' : 'Inactive';
  return r.is_active ? 'Active' : 'Inactive';
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

async function buildExcel(res, rows, appliedFilters) {
  const wb = new ExcelJS.Workbook();
  wb.creator = COMPANY;
  wb.created = new Date();

  const ws = wb.addWorksheet('Departments', {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  // ── Row 1: Title ──
  ws.mergeCells('A1:I1');
  const titleCell = ws.getCell('A1');
  titleCell.value = `${COMPANY} — Departments Report`;
  titleCell.font = { size: 15, bold: true, color: { argb: 'FF0F172A' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
  ws.getRow(1).height = 28;

  // ── Row 2: Meta ──
  ws.mergeCells('A2:I2');
  const metaCell = ws.getCell('A2');
  metaCell.value = `Generated: ${formatDateDDMMMYYYY(new Date())}   |   Filters: ${formatFilterSummary(appliedFilters)}   |   Total Records: ${rows.length}`;
  metaCell.font = { size: 9, italic: true, color: { argb: 'FF475569' } };
  metaCell.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(2).height = 18;

  // ── Row 3: Blank spacer ──
  ws.getRow(3).height = 6;

  // ── Row 4: Headers ──
  const headers = ['#', 'Code', 'Department Name', 'Parent Dept', 'Description', 'Head of Dept', 'Employees', 'Status', 'Created'];
  const headerRow = ws.getRow(4);
  headerRow.height = 22;
  headers.forEach((h, i) => {
    const c = headerRow.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.color } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
    c.border = HEADER_BORDER;
  });
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: headers.length } };

  // ── Data rows ──
  rows.forEach((r, idx) => {
    const row = ws.getRow(5 + idx);
    row.height = 16;
    const isEven = idx % 2 === 0;
    const bg = isEven ? 'FFFFFFFF' : 'FFF8FAFC';
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
      c.alignment = { vertical: 'middle', horizontal: i === 0 || i === 6 ? 'center' : 'left', wrapText: false };
      c.border = THIN_BORDER;
      if (i === 7) {
        c.font = { color: { argb: v === 'Active' ? 'FF059669' : 'FF64748B' }, bold: true };
      }
    });
  });

  // ── Total row ──
  const totalRowIdx = 5 + rows.length;
  const totalRow = ws.getRow(totalRowIdx);
  totalRow.height = 18;
  totalRow.getCell(1).value = `Total: ${rows.length} record${rows.length !== 1 ? 's' : ''}`;
  totalRow.getCell(1).font = { bold: true, color: { argb: 'FF0F172A' } };
  totalRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };

  // ── Column widths ──
  const minWidths = [5, 14, 28, 22, 38, 22, 12, 12, 14];
  ws.columns.forEach((col, i) => {
    let max = minWidths[i] || 12;
    col.eachCell({ includeEmpty: false }, (cell) => {
      const len = cell.value != null ? String(cell.value).length : 0;
      if (len > max) max = len;
    });
    col.width = Math.min(max + 2, 45);
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  await wb.xlsx.write(res);
}

function buildPDF(res, rows, appliedFilters) {
  const generatedAt = new Date();
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true });

  res.setHeader('Content-Type', 'application/pdf');
  doc.pipe(res);

  const PAGE_W = doc.page.width;
  const MARGIN = 36;
  const CONTENT_W = PAGE_W - MARGIN * 2;

  // ── Page header (drawn once per page) ──
  function drawPageHeader() {
    doc.save();
    doc.rect(MARGIN, MARGIN, CONTENT_W, 32).fill('#0F766E');
    doc.fontSize(14).fillColor('#ffffff').font('Helvetica-Bold')
      .text(`${COMPANY} — Departments Report`, MARGIN + 12, MARGIN + 9, { width: CONTENT_W - 24 });
    doc.restore();
    doc.fontSize(8).fillColor('#475569').font('Helvetica')
      .text(
        `Generated: ${formatDateDDMMMYYYY(generatedAt)}   |   Filters: ${formatFilterSummary(appliedFilters)}   |   Total: ${rows.length}`,
        MARGIN, MARGIN + 38, { width: CONTENT_W },
      );
    doc.moveTo(MARGIN, MARGIN + 52).lineTo(MARGIN + CONTENT_W, MARGIN + 52).lineWidth(0.5).stroke('#CBD5E1');
  }

  function drawFooter(pageIdx, total) {
    doc.save();
    doc.fontSize(7).fillColor('#94A3B8').font('Helvetica')
      .text(
        `${COMPANY} Confidential  |  Page ${pageIdx + 1} of ${total}  |  ${generatedAt.toUTCString()}`,
        MARGIN, doc.page.height - 24, { width: CONTENT_W, align: 'center' },
      );
    doc.restore();
  }

  const cols = [
    { w: 26, title: '#', key: (r, i) => String(i + 1), align: 'center' },
    { w: 62, title: 'Code', key: (r) => r.code || '' },
    { w: 118, title: 'Department Name', key: (r) => r.name || '' },
    { w: 85, title: 'Parent Dept', key: (r) => r.parent_name || '' },
    { w: 130, title: 'Description', key: (r) => r.description || '' },
    { w: 88, title: 'Head of Dept', key: (r) => r.head || r.manager_emp_id || '' },
    { w: 46, title: 'Employees', key: (r) => String(r.employee_count ?? r.employeeCount ?? 0), align: 'center' },
    { w: 52, title: 'Status', key: (r) => rowStatus(r), align: 'center' },
    { w: 68, title: 'Created', key: (r) => formatDateDDMMMYYYY(r.created_at) },
  ];

  const TABLE_TOP = MARGIN + 62;
  const ROW_H = 16;
  const HEADER_H = 18;
  const TABLE_W = cols.reduce((s, c) => s + c.w, 0);

  function truncate(s, max) {
    const t = String(s ?? '');
    return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
  }

  function drawTableHeader(y) {
    let x = MARGIN;
    doc.save();
    doc.rect(MARGIN, y, TABLE_W, HEADER_H).fill('#0F766E');
    doc.fontSize(7.5).fillColor('#ffffff').font('Helvetica-Bold');
    cols.forEach((c) => {
      doc.text(c.title, x + 4, y + 5, { width: c.w - 8, align: c.align || 'left', ellipsis: true });
      x += c.w;
    });
    doc.restore();
    return y + HEADER_H;
  }

  drawPageHeader();
  let y = TABLE_TOP;
  y = drawTableHeader(y);

  rows.forEach((r, idx) => {
    if (y + ROW_H > doc.page.height - 40) {
      doc.addPage();
      drawPageHeader();
      y = TABLE_TOP;
      y = drawTableHeader(y);
    }
    const isEven = idx % 2 === 0;
    const bg = isEven ? '#FFFFFF' : '#F8FAFC';
    let x = MARGIN;
    doc.save();
    cols.forEach((c) => {
      doc.rect(x, y, c.w, ROW_H).fillAndStroke(bg, '#E2E8F0');
      x += c.w;
    });
    doc.restore();
    x = MARGIN;
    doc.fontSize(7).fillColor('#1E293B').font('Helvetica');
    cols.forEach((c, ci) => {
      const raw = c.key(r, idx);
      const maxChars = Math.floor(c.w / 4.2);
      const val = truncate(raw, maxChars);
      if (ci === 7) {
        doc.fillColor(val === 'Active' ? '#059669' : '#64748B').font('Helvetica-Bold');
      } else {
        doc.fillColor('#1E293B').font('Helvetica');
      }
      doc.text(val, x + 4, y + 5, { width: c.w - 8, align: c.align || 'left', ellipsis: true });
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

module.exports = { buildExcel, buildPDF, formatDateDDMMMYYYY, formatFilterSummary };
