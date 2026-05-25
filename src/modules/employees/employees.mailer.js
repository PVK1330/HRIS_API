'use strict';

const { sendMail } = require('../../utils/mail');

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

/**
 * @param {object} p
 * @param {string} p.firstName
 * @param {string} p.empId
 * @param {string} p.department
 * @param {string} p.jobTitle
 * @param {string} p.joinDate
 * @param {string} p.portalUrl
 * @param {string} p.username
 * @param {string} p.plainPassword
 */
function buildWelcomeHtml(p) {
  const company = process.env.COMPANY_NAME || 'Your Company';
  const portalUrl = p.portalUrl || process.env.PORTAL_URL || 'https://portal.company.com';
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1e293b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6f8;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 4px 24px rgba(15,118,110,0.12);">
        <tr><td style="background:#0F766E;padding:20px 28px;text-align:center;">
          <div style="height:40px;width:120px;margin:0 auto 8px;border:1px dashed #ccfbf1;color:#ccfbf1;font-size:11px;line-height:40px;">Company Logo</div>
          <h1 style="margin:0;font-size:20px;font-weight:700;color:#ffffff;">Welcome to ${escapeHtml(company)}</h1>
        </td></tr>
        <tr><td style="padding:28px 28px 8px;">
          <p style="margin:0 0 16px;font-size:16px;line-height:1.6;">Welcome aboard, <strong>${escapeHtml(p.firstName)}</strong>! 🎉</p>
          <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#475569;">Your employee account has been created.</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:14px;line-height:1.8;margin-bottom:20px;">
            <tr><td style="color:#64748b;width:38%;">Employee ID</td><td style="font-weight:600;">${escapeHtml(p.empId)}</td></tr>
            <tr><td style="color:#64748b;">Department</td><td style="font-weight:600;">${escapeHtml(p.department)}</td></tr>
            <tr><td style="color:#64748b;">Designation</td><td style="font-weight:600;">${escapeHtml(p.jobTitle)}</td></tr>
            <tr><td style="color:#64748b;">Join Date</td><td style="font-weight:600;">${escapeHtml(p.joinDate)}</td></tr>
          </table>
          <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#0f172a;">Portal Access</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:13px;line-height:1.8;margin-bottom:20px;background:#f8fafc;border-radius:6px;padding:12px 16px;">
            <tr><td style="color:#64748b;width:28%;">URL</td><td><a href="${escapeAttr(portalUrl)}" style="color:#0F766E;font-weight:600;">${escapeHtml(portalUrl)}</a></td></tr>
            <tr><td style="color:#64748b;">Username</td><td style="font-family:ui-monospace,Menlo,Consolas,monospace;">${escapeHtml(p.username)}</td></tr>
            <tr><td style="color:#64748b;">Password</td><td style="font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:700;color:#b45309;">${escapeHtml(p.plainPassword)}</td></tr>
          </table>
          <p style="margin:0 0 24px;font-size:12px;color:#64748b;">Please change your password after login.</p>
          <a href="${escapeAttr(portalUrl)}" style="display:inline-block;background:#0F766E;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-size:14px;font-weight:600;">Login to Portal →</a>
          <p style="margin:28px 0 0;font-size:12px;color:#94a3b8;">HR Team, ${escapeHtml(company)}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendEmployeeWelcomeEmail({
  to,
  firstName,
  empId,
  department,
  jobTitle,
  joinDate,
  username,
  plainPassword,
  portalUrl: portalUrlIn,
  subject: subjectIn,
}) {
  const company = process.env.COMPANY_NAME || 'Your Company';
  const portalUrl =
    portalUrlIn || process.env.PORTAL_URL || 'https://portal.company.com';
  const subject =
    subjectIn || `Welcome to ${company} — Your Account Details`;
  const html = buildWelcomeHtml({
    firstName: firstName || 'there',
    empId: empId || '',
    department: department || '',
    jobTitle: jobTitle || '',
    joinDate: joinDate || '',
    portalUrl,
    username: username || '',
    plainPassword: plainPassword || '',
  });
  const text = `Welcome ${firstName}. Employee ID: ${empId}. Department: ${department}. Designation: ${jobTitle}. Join: ${joinDate}. Portal: ${portalUrl}. Username: ${username}. Password (change after login): ${plainPassword}`;
  await sendMail({
    to,
    subject,
    html,
    text,
  });
}

/** Portal login credentials after onboarding activation. */
async function sendEmployeeActivationEmail(opts) {
  const company = process.env.COMPANY_NAME || 'Your Company';
  return sendEmployeeWelcomeEmail({
    ...opts,
    subject: `${company} — Your employee portal login`,
  });
}

module.exports = {
  sendEmployeeWelcomeEmail,
  sendEmployeeActivationEmail,
  buildWelcomeHtml,
};
