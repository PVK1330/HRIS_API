const fs = require('fs');
const path = require('path');
const { generatePdfFromHtml, replacePlaceholders } = require('../../../utils/pdfGenerator');

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
  pool,
  tenant
}) {
  const dir = path.join(uploadDir, 'onboarding', String(employeeId));
  fs.mkdirSync(dir, { recursive: true });
  const fileName = `offer-letter-${employeeId}-${Date.now()}.pdf`;
  const filePath = path.join(dir, fileName);
  const relativeUrl = `/uploads/onboarding/${employeeId}/${fileName}`;

  const placeholders = {
    company_name: companyName || 'Your Company',
    candidate_name: candidateName || 'Candidate',
    job_title: jobTitle || 'an employee',
    department: department || '',
    join_date: joinDate || 'TBD',
    employment_type: employmentType || 'Full-time',
    manager_name: managerName || 'Manager',
    annual_ctc: annualCtc != null ? `${currency || ''} ${annualCtc}`.trim() : 'TBD',
    offer_expiry_date: offerExpiryDate || 'TBD',
    date_of_offer: dateOfOffer || new Date().toISOString().slice(0, 10),
  };

  let htmlBody = '';
  
  if (pool) {
    const { rows: templates } = await pool.query(`
      SELECT body FROM letter_templates 
      WHERE name ILIKE '%Offer Letter%' OR category = 'Recruitment' AND name ILIKE '%Offer%'
      LIMIT 1
    `);
    if (templates.length > 0) {
      htmlBody = templates[0].body;
    }
  }

  if (!htmlBody) {
    htmlBody = `
      <h2 style="text-align: center; color: #0F766E;">Offer of Employment</h2>
      <p>Date: {{date_of_offer}}</p>
      <p>Dear {{candidate_name}},</p>
      <p>We are pleased to offer you the position of {{job_title}} in the {{department}} department at {{company_name}}.</p>
      <table style="width: 100%; margin-top: 20px; margin-bottom: 20px; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><strong>Position:</strong></td>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">{{job_title}}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><strong>Department:</strong></td>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">{{department}}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><strong>Expected joining date:</strong></td>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">{{join_date}}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><strong>Employment type:</strong></td>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">{{employment_type}}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><strong>Reporting manager:</strong></td>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">{{manager_name}}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><strong>Annual CTC:</strong></td>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">{{annual_ctc}}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><strong>Offer valid until:</strong></td>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">{{offer_expiry_date}}</td>
        </tr>
      </table>
      <p>Please review this offer. Use the link in your email to accept or reject. Upon acceptance you may sign this offer digitally.</p>
      <p style="text-align: center; color: #64748b; font-size: 10px; margin-top: 40px;">This is a system-generated offer letter.</p>
    `;
  }

  htmlBody = replacePlaceholders(htmlBody, placeholders);
  
  const tenantData = tenant || { company_name: placeholders.company_name };
  const pdfBuffer = await generatePdfFromHtml(htmlBody, tenantData);
  fs.writeFileSync(filePath, pdfBuffer);

  const stat = fs.statSync(filePath);
  return { filePath, fileName, relativeUrl, fileSize: stat.size };
}

module.exports = { generateOfferLetterPdf };
