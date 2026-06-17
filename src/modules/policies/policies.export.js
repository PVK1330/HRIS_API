'use strict';

const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const BRAND = { color: 'FF0F766E', hex: '#0F766E' };
const COMPANY = process.env.COMPANY_NAME || 'Company';

function formatDate(date) {
  if (!date) return '—';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mon = d.toLocaleString('en-GB', { month: 'short' });
  return `${dd}-${mon}-${d.getFullYear()}`;
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

async function exportToExcel(policy, acknowledgements, employees = []) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = COMPANY;
  workbook.created = new Date();

  // ── Sheet 1: Policy Info ──
  const infoSheet = workbook.addWorksheet('Policy Info');

  infoSheet.mergeCells('A1:B1');
  infoSheet.getCell('A1').value = `${COMPANY} — Policy Report`;
  infoSheet.getCell('A1').font = { size: 14, bold: true, color: { argb: 'FF0F172A' } };
  infoSheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  infoSheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
  infoSheet.getRow(1).height = 28;
  infoSheet.getRow(2).height = 8;

  infoSheet.columns = [
    { key: 'field', width: 28 },
    { key: 'value', width: 45 },
  ];

  const policyData = [
    { field: 'Policy ID', value: policy.id },
    { field: 'Title', value: policy.title },
    { field: 'Category', value: policy.category },
    { field: 'Description', value: policy.description || '—' },
    { field: 'Status', value: policy.status },
    { field: 'Content Version', value: policy.contentVersion || policy.content_version },
    { field: 'Effective Date', value: formatDate(policy.effectiveDate || policy.effective_date) },
    { field: 'Review Date', value: formatDate(policy.reviewDate || policy.review_date) },
    { field: 'Acknowledgement Required', value: (policy.ackRequired ?? policy.ack_required) ? 'Yes' : 'No' },
    { field: 'Audience Type', value: policy.audienceConfig?.type || 'all' },
    { field: 'Published At', value: formatDate(policy.publishedAt || policy.published_at) },
    { field: 'Created At', value: formatDate(policy.createdAt || policy.created_at) },
    { field: 'Updated At', value: formatDate(policy.updatedAt || policy.updated_at) },
  ];

  policyData.forEach((rowData, idx) => {
    const r = infoSheet.addRow([rowData.field, rowData.value]);
    r.height = 18;
    const labelCell = r.getCell(1);
    labelCell.font = { bold: true, color: { argb: 'FF0F172A' } };
    labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: idx % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF' } };
    labelCell.border = THIN_BORDER;
    labelCell.alignment = { vertical: 'middle' };
    const valCell = r.getCell(2);
    valCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: idx % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF' } };
    valCell.border = THIN_BORDER;
    valCell.alignment = { vertical: 'middle' };
  });

  // ── Sheet 2: Acknowledgements ──
  const totalEmps = acknowledgements.length;
  const ackedEmps = acknowledgements.filter((a) => a.status === 'Acknowledged').length;
  const pendingEmps = totalEmps - ackedEmps;
  const ackedPct = totalEmps > 0 ? Math.round((ackedEmps / totalEmps) * 100) : 0;

  const ackSheet = workbook.addWorksheet('Acknowledgements', { views: [{ state: 'frozen', ySplit: 5 }] });

  ackSheet.mergeCells('A1:G1');
  ackSheet.getCell('A1').value = `${policy.title} — Acknowledgement Tracking`;
  ackSheet.getCell('A1').font = { size: 13, bold: true, color: { argb: 'FF0F172A' } };
  ackSheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  ackSheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
  ackSheet.getRow(1).height = 26;

  ackSheet.mergeCells('A2:G2');
  ackSheet.getCell('A2').value = `Generated: ${formatDate(new Date())}   |   Total: ${totalEmps}   |   Acknowledged: ${ackedEmps} (${ackedPct}%)   |   Pending: ${pendingEmps}`;
  ackSheet.getCell('A2').font = { size: 9, italic: true, color: { argb: 'FF475569' } };
  ackSheet.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' };
  ackSheet.getRow(2).height = 18;
  ackSheet.getRow(3).height = 6;

  const ackHeaders = ['#', 'Employee ID', 'Employee Name', 'Email', 'Department', 'Status', 'Acknowledged At'];
  const ackHeaderRow = ackSheet.getRow(4);
  ackHeaderRow.height = 22;
  ackHeaders.forEach((h, i) => {
    const c = ackHeaderRow.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.color } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
    c.border = HEADER_BORDER;
  });
  ackSheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: ackHeaders.length } };

  const empMap = new Map(employees.map((e) => [e.id, e]));

  acknowledgements.forEach((ack, idx) => {
    const emp = empMap.get(ack.employeeId || ack.employee_id);
    const status = ack.status || 'Pending';
    const bg = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC';
    const row = ackSheet.addRow([
      idx + 1,
      ack.employeeId || ack.employee_id,
      emp?.fullName || emp?.full_name || emp?.name || '—',
      emp?.email || '—',
      emp?.departmentName || emp?.department_name || '—',
      status,
      (ack.acknowledgedAt || ack.acknowledged_at) ? formatDate(ack.acknowledgedAt || ack.acknowledged_at) : '—',
    ]);
    row.height = 16;
    row.eachCell((c, colNum) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      c.border = THIN_BORDER;
      c.alignment = { vertical: 'middle', horizontal: colNum === 1 || colNum === 6 ? 'center' : 'left' };
    });
    const statusCell = row.getCell(6);
    statusCell.font = {
      bold: true,
      color: { argb: status === 'Acknowledged' ? 'FF059669' : 'FFD97706' },
    };
  });

  // ── Sheet 3: Summary ──
  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [{ key: 'metric', width: 28 }, { key: 'value', width: 18 }];

  summarySheet.mergeCells('A1:B1');
  summarySheet.getCell('A1').value = 'Acknowledgement Summary';
  summarySheet.getCell('A1').font = { size: 13, bold: true };
  summarySheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  summarySheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
  summarySheet.getRow(1).height = 26;
  summarySheet.getRow(2).height = 8;

  const summaryData = [
    { metric: 'Policy Title', value: policy.title },
    { metric: 'Total Employees', value: totalEmps },
    { metric: 'Acknowledged', value: ackedEmps },
    { metric: 'Pending', value: pendingEmps },
    { metric: 'Acknowledgement %', value: `${ackedPct}%` },
    { metric: 'Export Date', value: formatDate(new Date()) },
  ];

  summaryData.forEach((rowData, idx) => {
    const r = summarySheet.addRow([rowData.metric, rowData.value]);
    r.height = 18;
    const bg = idx % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF';
    r.getCell(1).font = { bold: true };
    r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
    r.getCell(1).border = THIN_BORDER;
    r.getCell(1).alignment = { vertical: 'middle' };
    r.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
    r.getCell(2).border = THIN_BORDER;
    r.getCell(2).alignment = { vertical: 'middle' };
  });

  // ── Auto column widths for ack sheet ──
  ackSheet.columns.forEach((col) => {
    let max = 12;
    col.eachCell({ includeEmpty: false }, (cell) => {
      const len = cell.value != null ? String(cell.value).length : 0;
      if (len > max) max = len;
    });
    col.width = Math.min(max + 2, 40);
  });

  return workbook;
}

async function exportToPDF(policy, acknowledgements, employees = []) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', layout: 'portrait', margin: 40, bufferPages: true });
      const buffers = [];
      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      const PAGE_W = doc.page.width;
      const MARGIN = 40;
      const CONTENT_W = PAGE_W - MARGIN * 2;
      const totalEmps = acknowledgements.length;
      const ackedEmps = acknowledgements.filter((a) => a.status === 'Acknowledged').length;
      const pendingEmps = totalEmps - ackedEmps;
      const ackedPct = totalEmps > 0 ? Math.round((ackedEmps / totalEmps) * 100) : 0;
      const empMap = new Map(employees.map((e) => [e.id, e]));

      // ── Header banner ──
      doc.rect(MARGIN, MARGIN, CONTENT_W, 36).fill('#0F766E');
      doc.fontSize(14).fillColor('#ffffff').font('Helvetica-Bold')
        .text('Policy Acknowledgement Report', MARGIN + 12, MARGIN + 11, { width: CONTENT_W - 24, align: 'center' });
      doc.fillColor('#1E293B');

      let y = MARGIN + 50;

      // ── Policy info block ──
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#0F766E').text('Policy Information', MARGIN, y);
      y += 16;
      doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).lineWidth(0.5).stroke('#CBD5E1');
      y += 6;

      const infoRows = [
        ['Title', policy.title],
        ['Category', policy.category || '—'],
        ['Status', policy.status || '—'],
        ['Version', String(policy.contentVersion || policy.content_version || 1)],
        ['Effective Date', formatDate(policy.effectiveDate || policy.effective_date)],
        ['Acknowledgement Required', (policy.ackRequired ?? policy.ack_required) ? 'Yes' : 'No'],
      ];

      doc.fontSize(8.5).font('Helvetica');
      infoRows.forEach(([label, val], idx) => {
        const bg = idx % 2 === 0 ? '#F8FAFC' : '#FFFFFF';
        doc.rect(MARGIN, y, CONTENT_W, 16).fill(bg);
        doc.fillColor('#64748B').text(label, MARGIN + 6, y + 4, { width: 130 });
        doc.fillColor('#0F172A').text(String(val ?? '—'), MARGIN + 140, y + 4, { width: CONTENT_W - 146 });
        y += 16;
      });

      y += 12;

      // ── Summary block ──
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#0F766E').text('Acknowledgement Summary', MARGIN, y);
      y += 16;
      doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).lineWidth(0.5).stroke('#CBD5E1');
      y += 8;

      const metrics = [
        ['Total Employees', String(totalEmps)],
        ['Acknowledged', `${ackedEmps} (${ackedPct}%)`],
        ['Pending', String(pendingEmps)],
        ['Report Generated', formatDate(new Date())],
      ];
      const boxW = (CONTENT_W - 12) / 4;
      metrics.forEach(([label, val], i) => {
        const bx = MARGIN + i * (boxW + 4);
        doc.rect(bx, y, boxW, 44).fill(i < 2 ? '#F0FDF4' : i === 2 ? '#FFFBEB' : '#F1F5F9').stroke('#E2E8F0');
        doc.fontSize(7).font('Helvetica').fillColor('#64748B').text(label.toUpperCase(), bx + 4, y + 6, { width: boxW - 8, align: 'center' });
        doc.fontSize(13).font('Helvetica-Bold').fillColor('#0F172A').text(val, bx + 4, y + 18, { width: boxW - 8, align: 'center' });
      });
      y += 56;

      // ── Table ──
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#0F766E').text('Employee Acknowledgements', MARGIN, y);
      y += 16;

      const cols = [
        { w: 28, title: '#', align: 'center' },
        { w: 120, title: 'Employee Name' },
        { w: 90, title: 'Department' },
        { w: 70, title: 'Status', align: 'center' },
        { w: 80, title: 'Acknowledged At' },
      ];
      const TABLE_W = cols.reduce((a, c) => a + c.w, 0);
      const ROW_H = 16;
      const HEADER_H = 18;

      function drawTableHeader(ty) {
        let x = MARGIN;
        doc.save();
        doc.rect(MARGIN, ty, TABLE_W, HEADER_H).fill('#0F766E');
        doc.fontSize(7.5).fillColor('#ffffff').font('Helvetica-Bold');
        cols.forEach((c) => {
          doc.text(c.title, x + 4, ty + 5, { width: c.w - 8, align: c.align || 'left' });
          x += c.w;
        });
        doc.restore();
        return ty + HEADER_H;
      }

      y = drawTableHeader(y);

      function truncate(s, max) {
        const t = String(s ?? '');
        return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
      }

      acknowledgements.forEach((ack, idx) => {
        if (y + ROW_H > doc.page.height - 48) {
          doc.addPage();
          y = MARGIN;
          y = drawTableHeader(y);
        }
        const emp = empMap.get(ack.employeeId || ack.employee_id);
        const status = ack.status || 'Pending';
        const bg = idx % 2 === 0 ? '#F8FAFC' : '#FFFFFF';
        const ackDate = (ack.acknowledgedAt || ack.acknowledged_at) ? formatDate(ack.acknowledgedAt || ack.acknowledged_at) : '—';

        let x = MARGIN;
        doc.save();
        cols.forEach((c) => {
          doc.rect(x, y, c.w, ROW_H).fillAndStroke(bg, '#E2E8F0');
          x += c.w;
        });
        doc.restore();

        x = MARGIN;
        const cellVals = [
          String(idx + 1),
          emp?.fullName || emp?.full_name || emp?.name || '—',
          emp?.departmentName || emp?.department_name || '—',
          status,
          ackDate,
        ];
        doc.fontSize(7).font('Helvetica');
        cellVals.forEach((val, ci) => {
          const c = cols[ci];
          const maxChars = Math.floor(c.w / 4);
          if (ci === 3) {
            doc.fillColor(status === 'Acknowledged' ? '#059669' : '#D97706').font('Helvetica-Bold');
          } else {
            doc.fillColor('#1E293B').font('Helvetica');
          }
          doc.text(truncate(val, maxChars), x + 4, y + 5, { width: c.w - 8, align: c.align || 'left', ellipsis: true });
          x += c.w;
        });
        y += ROW_H;
      });

      // ── Footer on all pages ──
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i += 1) {
        doc.switchToPage(range.start + i);
        doc.fontSize(7).fillColor('#94A3B8').font('Helvetica')
          .text(
            `${COMPANY} Confidential  |  Page ${i + 1} of ${range.count}  |  Generated: ${formatDate(new Date())}`,
            MARGIN, doc.page.height - 24, { width: CONTENT_W, align: 'center' },
          );
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function exportToCSV(policy, acknowledgements, employees = []) {
  const empMap = new Map(employees.map((e) => [e.id, e]));
  const headers = ['Employee ID', 'Name', 'Email', 'Department', 'Status', 'Acknowledged At', 'Version'];
  const rows = acknowledgements.map((ack) => {
    const emp = empMap.get(ack.employeeId || ack.employee_id);
    return [
      ack.employeeId || ack.employee_id,
      emp?.fullName || emp?.full_name || emp?.name || '—',
      emp?.email || '—',
      emp?.departmentName || emp?.department_name || '—',
      ack.status || 'Pending',
      (ack.acknowledgedAt || ack.acknowledged_at) ? formatDate(ack.acknowledgedAt || ack.acknowledged_at) : '—',
      ack.acknowledgedVersion || ack.acknowledged_version || '—',
    ];
  });
  const csv = [headers.map(escapeCSV).join(','), ...rows.map((r) => r.map(escapeCSV).join(','))].join('\n');
  return csv;
}

function escapeCSV(value) {
  if (!value) return '""';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

module.exports = { exportToExcel, exportToPDF, exportToCSV };
