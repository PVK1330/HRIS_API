'use strict';

const { sendMail } = require('../../../utils/mail');
const {
  escapeHtml,
  brandedEmailLayout,
  offerActionButtons,
} = require('./onboarding.emailTemplate');

const STEP_LABELS = {
  1: 'Offer letter & acceptance',
  2: 'Signed offer letter',
  3: 'Document checklist',
};

async function sendOnboardingStepCompletedToCandidate({
  to,
  candidateName,
  step,
  companyName,
}) {
  const label = STEP_LABELS[step] || `Step ${step}`;
  const company = companyName || process.env.COMPANY_NAME || 'Your Company';
  const html = brandedEmailLayout({
    companyName: company,
    title: `Onboarding step ${step} received`,
    bodyHtml: `<p>Hi ${escapeHtml(candidateName)},</p>
<p>We received your update: <strong>${escapeHtml(label)}</strong>.</p>
<p>HR will review and contact you if anything else is needed.</p>`,
  });
  await sendMail({
    to,
    subject: `${company} — Onboarding step ${step} received`,
    html,
    text: `Hi ${candidateName}, Step ${step}: ${label}`,
  });
}

async function sendOnboardingStepNotifyToHr({
  to,
  candidateName,
  empId,
  step,
  companyName,
}) {
  const label = STEP_LABELS[step] || `Step ${step}`;
  const company = companyName || process.env.COMPANY_NAME || 'Your Company';
  const html = brandedEmailLayout({
    companyName: company,
    title: `Onboarding step ${step}`,
    bodyHtml: `<p><strong>${escapeHtml(candidateName)}</strong> (${escapeHtml(empId)}) completed step ${step}.</p>
<p>${escapeHtml(label)}</p>`,
  });
  await sendMail({
    to,
    subject: `[${company}] Onboarding step ${step} — ${candidateName}`,
    html,
    text: `Step ${step} for ${candidateName} (${empId}): ${label}`,
  });
}

async function sendOnboardingAcceptedToHr({
  to,
  candidateName,
  empId,
  department,
  jobTitle,
  personalEmail,
  companyName,
  attachments = [],
}) {
  const company = companyName || process.env.COMPANY_NAME || 'Your Company';
  const attachNote =
    attachments.length > 0
      ? `<p><strong>${attachments.length}</strong> file(s) attached.</p>`
      : `<p><em>No attachments on file yet.</em></p>`;
  const html = brandedEmailLayout({
    companyName: company,
    title: 'Onboarding accepted',
    bodyHtml: `<p><strong>${escapeHtml(candidateName)}</strong> (${escapeHtml(empId)}) accepted onboarding.</p>
<table style="font-size:14px;line-height:1.7;margin:12px 0">
<tr><td style="color:#64748b">Department</td><td><strong>${escapeHtml(department || '—')}</strong></td></tr>
<tr><td style="color:#64748b">Job title</td><td><strong>${escapeHtml(jobTitle || '—')}</strong></td></tr>
<tr><td style="color:#64748b">Email</td><td>${escapeHtml(personalEmail || '—')}</td></tr>
</table>${attachNote}`,
  });
  await sendMail({
    to,
    subject: `[${company}] Onboarding accepted — ${candidateName}`,
    html,
    text: `Accepted: ${candidateName} (${empId})`,
    attachments,
  });
}

async function sendOfferLetterToCandidate({
  to,
  candidateName,
  companyName,
  jobTitle,
  department,
  joinDate,
  currency,
  annualCtc,
  dateOfOffer,
  offerExpiryDate,
  acceptUrl,
  rejectUrl,
  requiredDocuments = [],
  attachments = [],
}) {
  const company = companyName || process.env.COMPANY_NAME || 'Your Company';
  const docsSection = Array.isArray(requiredDocuments) && requiredDocuments.length
    ? `<p style="margin-top:20px">After you accept, you'll be asked to upload these documents:</p>
<ul style="margin:12px 0;padding-left:20px;font-size:14px;line-height:1.8">${requiredDocuments
        .map((d) => `<li>${escapeHtml(d)}</li>`)
        .join('')}</ul>
<p style="color:#64748b;font-size:13px">Keep digital copies ready to speed up your onboarding.</p>`
    : '';
  const html = brandedEmailLayout({
    companyName: company,
    title: 'Your offer of employment',
    bodyHtml: `<p>Dear ${escapeHtml(candidateName)},</p>
<p>Congratulations. We are pleased to extend an offer with <strong>${escapeHtml(company)}</strong>.</p>
<p>Your offer letter is attached as a PDF. Please review the details below and choose an action.</p>
<table style="font-size:14px;line-height:1.8;margin:16px 0;width:100%">
<tr><td style="color:#64748b;width:40%">Position</td><td><strong>${escapeHtml(jobTitle || '—')}</strong></td></tr>
<tr><td style="color:#64748b">Department</td><td><strong>${escapeHtml(department || '—')}</strong></td></tr>
<tr><td style="color:#64748b">Joining date</td><td><strong>${escapeHtml(joinDate || '—')}</strong></td></tr>
<tr><td style="color:#64748b">Annual CTC</td><td><strong>${escapeHtml(annualCtc != null ? `${currency || ''} ${annualCtc}`.trim() : '—')}</strong></td></tr>
<tr><td style="color:#64748b">Date of offer</td><td><strong>${escapeHtml(dateOfOffer || '—')}</strong></td></tr>
<tr><td style="color:#64748b">Valid until</td><td><strong>${escapeHtml(offerExpiryDate || '—')}</strong></td></tr>
</table>
${docsSection}
${offerActionButtons({ acceptUrl, rejectUrl })}`,
  });
  await sendMail({
    to,
    subject: `${company} — Your offer letter`,
    html,
    text: `Offer for ${candidateName}. Accept: ${acceptUrl} Reject: ${rejectUrl}`,
    attachments,
  });
}

async function sendDocumentChecklistToCandidate({
  to,
  candidateName,
  companyName,
  documentsUrl,
  checklist = [],
}) {
  const company = companyName || process.env.COMPANY_NAME || 'Your Company';
  const list = checklist.length
    ? `<ul style="margin:12px 0;padding-left:20px;">${checklist.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`
    : '<p>Passport, National ID, education and experience documents.</p>';
  const html = brandedEmailLayout({
    companyName: company,
    title: 'Document checklist',
    bodyHtml: `<p>Hi ${escapeHtml(candidateName)},</p>
<p>Please upload the following documents using your secure link:</p>
${list}
<p>HR will review each document after upload.</p>`,
    primaryCta: { href: documentsUrl, label: 'Upload documents →' },
  });
  await sendMail({
    to,
    subject: `${company} — Upload your onboarding documents`,
    html,
    text: `Upload documents: ${documentsUrl}`,
  });
}

function buildOnboardingEmailTemplate({ company, title, bodyHtml, cta }) {
  return brandedEmailLayout({
    companyName: company,
    title,
    bodyHtml,
    primaryCta: cta,
  });
}

async function sendMissingDocumentsReminderToCandidate({
  to,
  candidateName,
  companyName,
  documentsUrl,
  pendingDocuments = [],
  rejectedDocuments = [],
}) {
  const company = companyName || process.env.COMPANY_NAME || 'Your Company';
  
  let listHtml = '';
  if (pendingDocuments.length > 0) {
    listHtml += `<p><strong>Pending Documents:</strong></p><ul style="margin:12px 0;padding-left:20px;">${pendingDocuments.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`;
  }
  if (rejectedDocuments.length > 0) {
    listHtml += `<p><strong>Documents requiring re-upload (Rejected):</strong></p><ul style="margin:12px 0;padding-left:20px;color:#ef4444;">${rejectedDocuments.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`;
  }

  const html = buildOnboardingEmailTemplate({
    company,
    title: 'Action Required: Pending Onboarding Documents',
    bodyHtml: `<p>Hi ${escapeHtml(candidateName)},</p>
<p>This is a gentle reminder that we are still waiting for some of your onboarding documents.</p>
${listHtml}
<p>Please upload these documents as soon as possible using your secure portal link.</p>`,
    cta: { href: documentsUrl, label: 'Upload Documents →' },
  });
  await sendMail({
    to,
    subject: `${company} — Action Required: Pending Documents`,
    html,
    text: `Reminder to upload documents: ${documentsUrl}`,
  });
}

async function sendDocumentApprovedToCandidate({
  to,
  candidateName,
  companyName,
  documentName,
  pendingCount,
  documentsUrl,
}) {
  const company = companyName || process.env.COMPANY_NAME || 'Your Company';
  const pendingText = pendingCount > 0 
    ? `<p>You have <strong>${pendingCount}</strong> mandatory document(s) left to upload or pending review.</p>`
    : `<p>Great news! All your mandatory documents have been approved.</p>`;

  const html = buildOnboardingEmailTemplate({
    company,
    title: 'Document Approved',
    bodyHtml: `<p>Hi ${escapeHtml(candidateName)},</p>
<p>Your document <strong>${escapeHtml(documentName)}</strong> has been reviewed and approved by our HR team.</p>
${pendingText}`,
    cta: pendingCount > 0 ? { href: documentsUrl, label: 'View Portal →' } : null,
  });
  await sendMail({
    to,
    subject: `${company} — Document Approved: ${documentName}`,
    html,
    text: `Document ${documentName} was approved.`,
  });
}

async function sendDocumentRejectedToCandidate({
  to,
  candidateName,
  companyName,
  documentName,
  rejectionReason,
  documentsUrl,
}) {
  const company = companyName || process.env.COMPANY_NAME || 'Your Company';
  const html = buildOnboardingEmailTemplate({
    company,
    title: 'Document Re-upload Required',
    bodyHtml: `<p>Hi ${escapeHtml(candidateName)},</p>
<p>Our HR team reviewed your document <strong>${escapeHtml(documentName)}</strong> but it requires your attention.</p>
<p style="padding:12px;background-color:#fee2e2;color:#991b1b;border-radius:4px;"><strong>Reason:</strong> ${escapeHtml(rejectionReason || 'Please provide a clearer or more accurate document.')}</p>
<p>Please re-upload this document using your secure portal link.</p>`,
    cta: { href: documentsUrl, label: 'Re-upload Document →' },
  });
  await sendMail({
    to,
    subject: `${company} — Action Required: Document Rejected (${documentName})`,
    html,
    text: `Document ${documentName} was rejected. Reason: ${rejectionReason}. Upload here: ${documentsUrl}`,
  });
}

module.exports = {
  sendOnboardingStepCompletedToCandidate,
  sendOnboardingStepNotifyToHr,
  sendOnboardingAcceptedToHr,
  sendOfferLetterToCandidate,
  sendDocumentChecklistToCandidate,
  sendMissingDocumentsReminderToCandidate,
  sendDocumentApprovedToCandidate,
  sendDocumentRejectedToCandidate,
  STEP_LABELS,
};
