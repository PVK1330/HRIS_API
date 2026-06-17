'use strict';

const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const BRAND = { color: 'FF0F766E', hex: '#0F766E' };
const COMPANY = process.env.COMPANY_NAME || 'Company';

function formatFilterSummary(q) {
  const parts = [];
  if (q.search) parts.push(`Search: "${q.search}"`);
  if (q.department) parts.push(`Dept: ${q.department}`);
  if (q.location) parts.push(`Location: ${q.location}`);
  if (q.visaType) parts.push(`Visa Type: ${q.visaType}`);
  if (q.expiryWindow && q.expiryWindow !== 'all') parts.push(`Window: ${q.expiryWindow}`);
  return parts.length ? parts.join('  |  ') : 'All records';
}

function formatDateDDMMMYYYY(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d).slice(0, 10);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mon = dt.toLocaleString('en-GB', { month: 'short' });
  return `${dd}-${mon}-${dt.getFullYear()}`;
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

  const ws = wb.addWorksheet('Visa Records', {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const COL_COUNT = 15;
  const lastCol = String.fromCharCode(64 + COL_COUNT);

  ws.mergeCells(`A1:${lastCol}1`);
  const titleCell = ws.getCell('A1');
  titleCell.value = `${COMPANY} — Visa & Nationality Compliance`;
  titleCell.font = { size: 15, bold: true, color: { argb: 'FF0F172A' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
  ws.getRow(1).height = 28;

  ws.mergeCells(`A2:${lastCol}2`);
  const metaCell = ws.getCell('A2');
  metaCell.value = `Generated: ${formatDateDDMMMYYYY(new Date())}   |   Filters: ${formatFilterSummary(appliedFilters)}   |   Total: ${rows.length}`;
  metaCell.font = { size: 9, italic: true, color: { argb: 'FF475569' } };
  metaCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(2).height = 18;
  ws.getRow(3).height = 6;

  const headers = ['#', 'Employee Name', 'Emp ID', 'Department', 'Nationality', 'Passport No', 'Passport Expiry', 'Visa Type', 'Visa Number', 'Visa Expiry', 'Sponsoring Entity', 'Emirates ID No', 'Emirates ID Expiry', 'Status', 'Created'];
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

  rows.forEach((r, idx) => {
    const row = ws.getRow(5 + idx);
    row.height = 16;
    const st = r.compliance_status || 'Valid';
    let bg;
    if (st === 'Expired') bg = 'FFFCEBEB';
    else if (st === 'Expiring Soon') bg = 'FFFAEEDA';
    else bg = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC';

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
      c.alignment = { vertical: 'middle', horizontal: i === 0 ? 'center' : 'left', wrapText: false };
      c.border = THIN_BORDER;
      if (i === 13) {
        const color = st === 'Expired' ? 'FFDC2626' : st === 'Expiring Soon' ? 'FFD97706' : 'FF059669';
        c.font = { bold: true, color: { argb: color } };
      }
    });
  });

  const summaryRow = ws.getRow(5 + rows.length);
  summaryRow.height = 18;
  summaryRow.getCell(1).value = `Total: ${rows.length} record${rows.length !== 1 ? 's' : ''}`;
  summaryRow.getCell(1).font = { bold: true };
  summaryRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };

  ws.columns.forEach((col) => {
    let max = 10;
    col.eachCell({ includeEmpty: false }, (cell) => {
      const len = cell.value != null ? String(cell.value).length : 0;
      if (len > max) max = len;
    });
    col.width = Math.min(max + 2, 40);
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  await wb.xlsx.write(res);
}

function buildPDF(res, rows, appliedFilters) {
  const generatedAt = new Date();
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 24, bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  doc.pipe(res);

  const PAGE_W = doc.page.width;
  const MARGIN = 24;
  const CONTENT_W = PAGE_W - MARGIN * 2;

  function drawPageHeader() {
    doc.save();
    doc.rect(MARGIN, MARGIN, CONTENT_W, 28).fill('#0F766E');
    doc.fontSize(12).fillColor('#ffffff').font('Helvetica-Bold')
      .text(`${COMPANY} — Visa & Nationality Compliance`, MARGIN + 10, MARGIN + 8, { width: CONTENT_W - 20 });
    doc.restore();
    doc.fontSize(7.5).fillColor('#475569').font('Helvetica')
      .text(
        `Generated: ${formatDateDDMMMYYYY(generatedAt)}   |   ${formatFilterSummary(appliedFilters)}   |   Total: ${rows.length}`,
        MARGIN, MARGIN + 34, { width: CONTENT_W },
      );
    doc.moveTo(MARGIN, MARGIN + 48).lineTo(MARGIN + CONTENT_W, MARGIN + 48).lineWidth(0.5).stroke('#CBD5E1');
  }

  function drawFooter(pageIdx, total) {
    doc.fontSize(6.5).fillColor('#94A3B8').font('Helvetica')
      .text(
        `${COMPANY} Confidential  |  Page ${pageIdx + 1} of ${total}  |  ${generatedAt.toUTCString()}`,
        MARGIN, doc.page.height - 18, { width: CONTENT_W, align: 'center' },
      );
  }

  const cols = [
    { w: 18, title: '#', key: (r, i) => String(i + 1), align: 'center' },
    { w: 70, title: 'Name', key: (r) => r.full_name || '' },
    { w: 44, title: 'Emp ID', key: (r) => r.emp_id || '' },
    { w: 52, title: 'Dept', key: (r) => r.department || '' },
    { w: 48, title: 'Nationality', key: (r) => r.nationality || '' },
    { w: 52, title: 'Passport No', key: (r) => r.passport_number || '' },
    { w: 52, title: 'PPT Expiry', key: (r) => formatDateDDMMMYYYY(r.passport_expiry_date) },
    { w: 50, title: 'Visa Type', key: (r) => r.visa_type_display || r.visa_type_name || '' },
    { w: 48, title: 'Visa No', key: (r) => r.visa_number || '' },
    { w: 52, title: 'Visa Expiry', key: (r) => formatDateDDMMMYYYY(r.visa_expiry_date) },
    { w: 56, title: 'Sponsor', key: (r) => r.sponsoring_entity || '' },
    { w: 44, title: 'Emirates ID', key: (r) => r.emirates_id_number || '' },
    { w: 50, title: 'EID Expiry', key: (r) => formatDateDDMMMYYYY(r.emirates_id_expiry) },
    { w: 46, title: 'Status', key: (r) => r.compliance_status || 'Valid', align: 'center' },
  ];

  const TABLE_TOP = MARGIN + 58;
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
    if (y + ROW_H > doc.page.height - 30) {
      doc.addPage();
      drawPageHeader();
      y = TABLE_TOP;
      y = drawTableHeader(y);
    }
    const st = r.compliance_status || 'Valid';
    let bg;
    if (st === 'Expired') bg = '#FCEBEB';
    else if (st === 'Expiring Soon') bg = '#FAEEDA';
    else bg = idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC';

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
      if (ci === 13) {
        const color = st === 'Expired' ? '#DC2626' : st === 'Expiring Soon' ? '#D97706' : '#059669';
        doc.fillColor(color).font('Helvetica-Bold');
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

module.exports = { buildExcel, buildPDF, formatDateDDMMMYYYY, formatFilterSummary };
