'use strict';

const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

/**
 * Export policy acknowledgements to Excel workbook.
 * Includes: policy metadata + employee acknowledgement tracking.
 */
async function exportToExcel(policy, acknowledgements, employees = []) {
  const workbook = new ExcelJS.Workbook();

  // Sheet 1: Policy Metadata
  const infoSheet = workbook.addWorksheet('Policy Info');
  infoSheet.columns = [
    { header: 'Field', key: 'field', width: 20 },
    { header: 'Value', key: 'value', width: 40 },
  ];

  const policyData = [
    { field: 'Policy ID', value: policy.id },
    { field: 'Title', value: policy.title },
    { field: 'Category', value: policy.category },
    { field: 'Description', value: policy.description || '' },
    { field: 'Status', value: policy.status },
    { field: 'Content Version', value: policy.contentVersion || policy.content_version },
    { field: 'Effective Date', value: formatDate(policy.effectiveDate || policy.effective_date) },
    { field: 'Review Date', value: formatDate(policy.reviewDate || policy.review_date) },
    { field: 'Acknowledgement Required', value: policy.ackRequired ?? policy.ack_required ? 'Yes' : 'No' },
    { field: 'Audience Type', value: policy.audienceConfig?.type || 'all' },
    { field: 'Published At', value: formatDate(policy.publishedAt || policy.published_at) },
    { field: 'Created At', value: formatDate(policy.createdAt || policy.created_at) },
    { field: 'Updated At', value: formatDate(policy.updatedAt || policy.updated_at) },
  ];

  policyData.forEach((row) => {
    const r = infoSheet.addRow(row);
    r.getCell(1).font = { bold: true };
    r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCCCCCC' } };
  });

  // Sheet 2: Acknowledgements
  const ackSheet = workbook.addWorksheet('Acknowledgements');
  ackSheet.columns = [
    { header: 'Employee ID', key: 'employeeId', width: 12 },
    { header: 'Employee Name', key: 'employeeName', width: 25 },
    { header: 'Email', key: 'email', width: 30 },
    { header: 'Department', key: 'department', width: 20 },
    { header: 'Status', key: 'status', width: 15 },
    { header: 'Acknowledged At', key: 'acknowledgedAt', width: 20 },
    { header: 'Version', key: 'acknowledgedVersion', width: 10 },
  ];

  // Add header styling
  const headerRow = ackSheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };

  // Build acknowledgement records
  const empMap = new Map(employees.map((e) => [e.id, e]));
  const ackMap = new Map(acknowledgements.map((a) => [a.employeeId || a.employee_id, a]));

  acknowledgements.forEach((ack) => {
    const emp = empMap.get(ack.employeeId || ack.employee_id);
    const row = ackSheet.addRow({
      employeeId: ack.employeeId || ack.employee_id,
      employeeName: emp?.fullName || emp?.full_name || emp?.name || '—',
      email: emp?.email || '—',
      department: emp?.departmentName || emp?.department_name || '—',
      status: ack.status || 'Pending',
      acknowledgedAt: ack.acknowledgedAt || ack.acknowledged_at ? formatDate(ack.acknowledgedAt || ack.acknowledged_at) : '—',
      acknowledgedVersion: ack.acknowledgedVersion || ack.acknowledged_version || '—',
    });

    // Alternate row coloring
    if (row.number % 2 === 0) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
    }

    // Status color coding
    const statusCell = row.getCell('status');
    if (ack.status === 'Acknowledged') {
      statusCell.font = { color: { argb: 'FF059669' }, bold: true };
    } else if (ack.status === 'Pending') {
      statusCell.font = { color: { argb: 'FFD97706' }, bold: true };
    }
  });

  // Sheet 3: Summary
  const summarySheet = workbook.addWorksheet('Summary');
  const totalEmps = acknowledgements.length;
  const ackedEmps = acknowledgements.filter((a) => a.status === 'Acknowledged').length;
  const pendingEmps = totalEmps - ackedEmps;
  const ackedPct = totalEmps > 0 ? Math.round((ackedEmps / totalEmps) * 100) : 0;

  summarySheet.columns = [
    { header: 'Metric', key: 'metric', width: 25 },
    { header: 'Value', key: 'value', width: 15 },
  ];

  const summaryData = [
    { metric: 'Total Employees', value: totalEmps },
    { metric: 'Acknowledged', value: ackedEmps },
    { metric: 'Pending', value: pendingEmps },
    { metric: 'Acknowledgement %', value: `${ackedPct}%` },
    { metric: 'Export Date', value: formatDate(new Date()) },
  ];

  summaryData.forEach((row) => {
    const r = summarySheet.addRow(row);
    r.getCell(1).font = { bold: true };
    r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCCCCCC' } };
  });

  return workbook;
}

/**
 * Export policy acknowledgements to PDF.
 * Includes: policy info + summary + detailed table.
 */
async function exportToPDF(policy, acknowledgements, employees = []) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40 });
      const buffers = [];

      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      // Title
      doc.fontSize(20).font('Helvetica-Bold').text(`Policy Acknowledgement Report`, { align: 'center' });
      doc.moveDown(0.5);

      // Policy Info
      doc.fontSize(11).font('Helvetica-Bold').text('Policy Information', { underline: true });
      doc.fontSize(9).font('Helvetica');
      doc.text(`Title: ${policy.title}`);
      doc.text(`Category: ${policy.category}`);
      doc.text(`Status: ${policy.status}`);
      doc.text(`Version: ${policy.contentVersion || policy.content_version || 1}`);
      doc.text(`Effective Date: ${formatDate(policy.effectiveDate || policy.effective_date)}`);
      doc.text(`Acknowledgement Required: ${policy.ackRequired ?? policy.ack_required ? 'Yes' : 'No'}`);
      doc.moveDown(0.5);

      // Summary
      const totalEmps = acknowledgements.length;
      const ackedEmps = acknowledgements.filter((a) => a.status === 'Acknowledged').length;
      const pendingEmps = totalEmps - ackedEmps;
      const ackedPct = totalEmps > 0 ? Math.round((ackedEmps / totalEmps) * 100) : 0;

      doc.fontSize(11).font('Helvetica-Bold').text('Summary', { underline: true });
      doc.fontSize(9).font('Helvetica');
      doc.text(`Total Employees: ${totalEmps}`);
      doc.text(`Acknowledged: ${ackedEmps} (${ackedPct}%)`);
      doc.text(`Pending: ${pendingEmps}`);
      doc.text(`Report Generated: ${formatDate(new Date())}`);
      doc.moveDown(0.5);

      // Table Header
      const empMap = new Map(employees.map((e) => [e.id, e]));
      const tableTop = doc.y;
      const col1 = 40;
      const col2 = 150;
      const col3 = 280;
      const col4 = 380;
      const col5 = 500;
      const rowHeight = 18;

      // Draw header
      doc.fontSize(8).font('Helvetica-Bold');
      doc.fillColor('#0F766E').rect(40, tableTop, 520, rowHeight).fill();
      doc.fillColor('white');
      doc.text('Employee ID', col1, tableTop + 4, { width: 100 });
      doc.text('Name', col2, tableTop + 4, { width: 120 });
      doc.text('Department', col3, tableTop + 4, { width: 90 });
      doc.text('Status', col4, tableTop + 4, { width: 90 });
      doc.text('Ack Date', col5, tableTop + 4, { width: 60 });

      let currentY = tableTop + rowHeight;

      // Draw rows
      doc.font('Helvetica').fontSize(8);
      acknowledgements.forEach((ack, idx) => {
        const emp = empMap.get(ack.employeeId || ack.employee_id);
        const bgColor = idx % 2 === 0 ? '#F5F5F5' : 'white';
        const status = ack.status || 'Pending';

        // Row background
        doc.fillColor(bgColor).rect(40, currentY, 520, rowHeight).fill();

        // Row text
        doc.fillColor('black');
        doc.text(String(ack.employeeId || ack.employee_id), col1, currentY + 4, { width: 100 });
        doc.text(emp?.fullName || emp?.full_name || emp?.name || '—', col2, currentY + 4, { width: 120 });
        doc.text(emp?.departmentName || emp?.department_name || '—', col3, currentY + 4, { width: 90 });

        // Status color
        doc.fillColor(status === 'Acknowledged' ? '#059669' : '#D97706');
        doc.text(status, col4, currentY + 4, { width: 90 });
        doc.fillColor('black');

        const ackDate = ack.acknowledgedAt || ack.acknowledged_at ? formatDate(ack.acknowledgedAt || ack.acknowledged_at) : '—';
        doc.text(ackDate, col5, currentY + 4, { width: 60 });

        currentY += rowHeight;

        // Page break if needed
        if (currentY > 700) {
          doc.addPage();
          currentY = 40;
        }
      });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Generate CSV content as a string.
 * Format: Employee ID, Name, Email, Department, Status, Acknowledged At, Version
 */
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
      ack.acknowledgedAt || ack.acknowledged_at ? formatDate(ack.acknowledgedAt || ack.acknowledged_at) : '—',
      ack.acknowledgedVersion || ack.acknowledged_version || '—',
    ];
  });

  // Escape CSV values and join
  const csv = [
    headers.map(escapeCSV).join(','),
    ...rows.map((row) => row.map(escapeCSV).join(',')),
  ].join('\n');

  return csv;
}

function escapeCSV(value) {
  if (!value) return '""';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatDate(date) {
  if (!date) return '—';
  const d = new Date(date);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });
}

module.exports = {
  exportToExcel,
  exportToPDF,
  exportToCSV,
};
