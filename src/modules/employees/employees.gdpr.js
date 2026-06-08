'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

// Bundled fallback; override with LOGO_PATH env var if a custom asset is preferred.
const DEFAULT_LOGO = path.join(__dirname, '../../assets/HRIS_Logo.png');
const LOGO_PATH = process.env.LOGO_PATH || DEFAULT_LOGO;

/**
 * Streams a GDPR Article 15 personal-data export PDF to `res`.
 * @param {import('express').Response} res
 * @param {object} employee  Row returned by employees.service.getEmployee
 * @param {string|number} userId
 */
function streamGdprPdf(res, employee, userId) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="GDPR_Data_Export_${userId}.pdf"`);

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  doc.pipe(res);

  if (fs.existsSync(LOGO_PATH)) {
    doc.image(LOGO_PATH, 50, 45, { width: 120 });
  }

  doc.fillColor('#0F766E').fontSize(18).text('GDPR Personal Data Export', { align: 'right' });
  doc.moveDown(0.5);
  doc.fillColor('#374151').fontSize(10)
    .text(`Generated On: ${new Date().toLocaleDateString()}`, { align: 'right' })
    .text('Compliance: GDPR Article 15 - Right of access', { align: 'right' });
  doc.moveDown(3);

  const field = (label, value) => {
    doc.font('Helvetica-Bold').text(`${label}: `, { continued: true });
    doc.font('Helvetica').text(value || 'N/A');
  };

  doc.fillColor('#0F766E').fontSize(14).text('Employee Profile', { underline: true });
  doc.moveDown(0.5);
  doc.fillColor('#1e293b').fontSize(11);

  field('Full Name', employee.full_name || `${employee.first_name || ''} ${employee.last_name || ''}`.trim());
  field('Employee ID', employee.emp_id);
  field('Personal Email', employee.personal_email);
  field('Work Email', employee.work_email);
  field('Phone', employee.phone_number);
  field('Job Title', employee.job_title);
  field('Department', employee.department);
  field('Employment Status', employee.employment_status);
  field('Join Date', employee.join_date ? new Date(employee.join_date).toLocaleDateString() : 'N/A');

  doc.moveDown(2);
  doc.fillColor('#0F766E').fontSize(14).text('Address Information', { underline: true });
  doc.moveDown(0.5);
  doc.fillColor('#1e293b').fontSize(11);

  field('Present Address', employee.present_address);
  field('Permanent Address', employee.permanent_address);

  doc.end();
}

module.exports = { streamGdprPdf };
