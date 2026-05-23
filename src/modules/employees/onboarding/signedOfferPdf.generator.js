'use strict';

const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb } = require('pdf-lib');
const { generateOfferLetterPdf } = require('./offerPdf.generator');

function decodeSignatureImage(signatureData) {
  const raw = String(signatureData || '');
  const base64 = raw.includes(',') ? raw.split(',')[1] : raw;
  return Buffer.from(base64, 'base64');
}

/**
 * Build signed offer PDF (offer pages + signature block).
 */
async function generateSignedOfferPdf({
  uploadDir,
  employeeId,
  offerPdfPath,
  signatureData,
  signatureMode,
  typedName,
  companyName,
  candidateName,
}) {
  const dir = path.join(uploadDir, 'onboarding', String(employeeId));
  fs.mkdirSync(dir, { recursive: true });
  const fileName = `signed-offer-${employeeId}-${Date.now()}.pdf`;
  const filePath = path.join(dir, fileName);
  const relativeUrl = `/uploads/onboarding/${employeeId}/${fileName}`;

  let pdfDoc;
  if (offerPdfPath && fs.existsSync(offerPdfPath)) {
    const existing = fs.readFileSync(offerPdfPath);
    pdfDoc = await PDFDocument.load(existing);
  } else {
    const temp = await generateOfferLetterPdf({
      uploadDir,
      employeeId,
      companyName,
      candidateName,
    });
    const existing = fs.readFileSync(temp.filePath);
    pdfDoc = await PDFDocument.load(existing);
  }

  const page = pdfDoc.addPage([595, 842]);
  const { height } = page.getSize();
  const font = await pdfDoc.embedFont('Helvetica');
  const fontBold = await pdfDoc.embedFont('Helvetica-Bold');

  page.drawText('Candidate Acceptance & Signature', {
    x: 56,
    y: height - 80,
    size: 14,
    font: fontBold,
    color: rgb(0.06, 0.46, 0.43),
  });
  page.drawText(`Signed by: ${candidateName || 'Candidate'}`, {
    x: 56,
    y: height - 108,
    size: 11,
    font,
  });
  page.drawText(`Date: ${new Date().toISOString().slice(0, 10)}`, {
    x: 56,
    y: height - 126,
    size: 11,
    font,
  });

  if (signatureMode === 'type' && typedName) {
    page.drawText(typedName, {
      x: 56,
      y: height - 200,
      size: 28,
      font: fontBold,
      color: rgb(0.1, 0.1, 0.2),
    });
  } else if (signatureData) {
    try {
      const pngBytes = decodeSignatureImage(signatureData);
      const png = await pdfDoc.embedPng(pngBytes);
      const dims = png.scale(0.5);
      page.drawImage(png, {
        x: 56,
        y: height - 280,
        width: Math.min(dims.width, 400),
        height: Math.min(dims.height, 120),
      });
    } catch {
      page.drawText('[Signature on file]', { x: 56, y: height - 200, size: 12, font });
    }
  }

  const bytes = await pdfDoc.save();
  fs.writeFileSync(filePath, bytes);
  const stat = fs.statSync(filePath);
  return { filePath, fileName, relativeUrl, fileSize: stat.size };
}

module.exports = { generateSignedOfferPdf };
