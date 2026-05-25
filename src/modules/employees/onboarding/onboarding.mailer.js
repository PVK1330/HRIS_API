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
  attachments = [],
}) {
  const company = companyName || process.env.COMPANY_NAME || 'Your Company';
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

module.exports = {
  sendOnboardingStepCompletedToCandidate,
  sendOnboardingStepNotifyToHr,
  sendOnboardingAcceptedToHr,
  sendOfferLetterToCandidate,
  sendDocumentChecklistToCandidate,
  STEP_LABELS,
};
