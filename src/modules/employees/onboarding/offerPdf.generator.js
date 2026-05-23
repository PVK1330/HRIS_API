'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

/**
 * Generate offer letter PDF; returns { filePath, fileName, relativeUrl }.
 */
async function generateOfferLetterPdf({
  uploadDir,
  employeeId,
  companyName,
  candidateName,
  jobTitle,
  department,
  joinDate,
  annualCtc,
  currency,
  dateOfOffer,
  offerExpiryDate,
  employmentType,
  managerName,
}) {
  const dir = path.join(uploadDir, 'onboarding', String(employeeId));
  fs.mkdirSync(dir, { recursive: true });
  const fileName = `offer-letter-${employeeId}-${Date.now()}.pdf`;
  const filePath = path.join(dir, fileName);
  const relativeUrl = `/uploads/onboarding/${employeeId}/${fileName}`;

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 56, size: 'A4' });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.on('error', reject);

    const company = companyName || 'Your Company';
    doc.fontSize(20).fillColor('#0F766E').text(company, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(14).fillColor('#334155').text('Offer of Employment', { align: 'center' });
    doc.moveDown(1.5);

    doc.fontSize(11).fillColor('#0f172a');
    doc.text(`Date: ${dateOfOffer || new Date().toISOString().slice(0, 10)}`);
    doc.moveDown(0.8);
    doc.text(`Dear ${candidateName || 'Candidate'},`);
    doc.moveDown(0.6);
    doc.text(
      `We are pleased to offer you the position of ${jobTitle || '—'} in the ${department || '—'} department at ${company}.`,
      { align: 'left' },
    );
    doc.moveDown(0.8);

    const rows = [
      ['Position', jobTitle || '—'],
      ['Department', department || '—'],
      ['Expected joining date', joinDate || '—'],
      ['Employment type', employmentType || '—'],
      ['Reporting manager', managerName || '—'],
      [
        'Annual CTC',
        annualCtc != null ? `${currency || ''} ${annualCtc}`.trim() : '—',
      ],
      ['Offer valid until', offerExpiryDate || '—'],
    ];
    rows.forEach(([label, value]) => {
      doc.font('Helvetica-Bold').text(`${label}: `, { continued: true });
      doc.font('Helvetica').text(String(value));
    });

    doc.moveDown(1.2);
    doc.text(
      'Please review this offer. Use the link in your email to accept or reject. Upon acceptance you may sign this offer digitally.',
    );
    doc.moveDown(2);
    doc.fontSize(10).fillColor('#64748b').text('This is a system-generated offer letter.', {
      align: 'center',
    });

    doc.end();
  });

  const stat = fs.statSync(filePath);
  return { filePath, fileName, relativeUrl, fileSize: stat.size };
}

module.exports = { generateOfferLetterPdf };
