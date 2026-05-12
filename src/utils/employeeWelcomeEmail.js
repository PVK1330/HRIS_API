"use strict";

/**
 * HTML welcome email for new employees (portal credentials).
 * @param {Object} p
 */
function buildEmployeeWelcomeHtml(p) {
  const {
    fullName = "",
    empId = "",
    department = "",
    jobTitle = "",
    joinDate = "",
    portalUrl = "#",
    username = "",
    temporaryPassword = "",
  } = p;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1e293b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6f8;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 4px 24px rgba(15,118,110,0.12);">
        <tr><td style="background:#0F766E;padding:20px 28px;">
          <h1 style="margin:0;font-size:20px;font-weight:700;color:#ffffff;">Welcome to the team</h1>
          <p style="margin:8px 0 0;font-size:13px;color:#ccfbf1;">Your HR portal is ready</p>
        </td></tr>
        <tr><td style="padding:28px 28px 8px;">
          <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Hi <strong>${escapeHtml(fullName)}</strong>,</p>
          <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#475569;">Your employee profile has been created. Below are your details and a one-time portal password. Please sign in and change your password as soon as possible.</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e2e8f0;border-radius:6px;">
            <tr><td style="padding:14px 16px;background:#f8fafc;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#64748b;">Employee ID</td></tr>
            <tr><td style="padding:12px 16px 18px;font-size:15px;font-weight:600;">${escapeHtml(empId)}</td></tr>
            <tr><td style="height:1px;background:#e2e8f0;"></td></tr>
            <tr><td style="padding:14px 16px;background:#f8fafc;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#64748b;">Department &amp; designation</td></tr>
            <tr><td style="padding:12px 16px 18px;font-size:15px;">${escapeHtml(department)} · ${escapeHtml(jobTitle)}</td></tr>
            <tr><td style="height:1px;background:#e2e8f0;"></td></tr>
            <tr><td style="padding:14px 16px;background:#f8fafc;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#64748b;">Join date</td></tr>
            <tr><td style="padding:12px 16px 18px;font-size:15px;">${escapeHtml(joinDate)}</td></tr>
            <tr><td style="height:1px;background:#e2e8f0;"></td></tr>
            <tr><td style="padding:14px 16px;background:#f8fafc;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#64748b;">Portal URL</td></tr>
            <tr><td style="padding:12px 16px 18px;"><a href="${escapeAttr(portalUrl)}" style="color:#0F766E;font-weight:600;word-break:break-all;">${escapeHtml(portalUrl)}</a></td></tr>
            <tr><td style="height:1px;background:#e2e8f0;"></td></tr>
            <tr><td style="padding:14px 16px;background:#f8fafc;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#64748b;">Username</td></tr>
            <tr><td style="padding:12px 16px 18px;font-size:15px;font-family:ui-monospace,Menlo,Consolas,monospace;">${escapeHtml(username)}</td></tr>
            <tr><td style="height:1px;background:#e2e8f0;"></td></tr>
            <tr><td style="padding:14px 16px;background:#fef3c7;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#92400e;">Temporary password (use once)</td></tr>
            <tr><td style="padding:12px 16px 20px;font-size:15px;font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:700;color:#b45309;">${escapeHtml(temporaryPassword)}</td></tr>
          </table>
          <p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#94a3b8;">If you did not expect this message, contact your HR administrator.</p>
        </td></tr>
        <tr><td style="padding:16px 28px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;">Sent automatically by HRIS.</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

module.exports = { buildEmployeeWelcomeHtml };
