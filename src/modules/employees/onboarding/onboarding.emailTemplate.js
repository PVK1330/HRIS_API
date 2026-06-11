'use strict';

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
 * Branded HTML email wrapper with company header.
 */
function brandedEmailLayout({ companyName, title, bodyHtml, primaryCta, logoImgHtml }) {
  const company = escapeHtml(companyName || 'Your Company');
  const ctaBlock = primaryCta
    ? `<p style="margin:24px 0 0;text-align:center;">
        <a href="${escapeAttr(primaryCta.href)}" style="display:inline-block;background:#0F766E;color:#fff;text-decoration:none;padding:14px 28px;border-radius:6px;font-size:14px;font-weight:700;">${escapeHtml(primaryCta.label)}</a>
       </p>`
    : '';
  // Show the org logo on a white chip (so any logo stays visible on the teal header);
  // fall back to the company name as an uppercase label when no logo is configured.
  const brandBlock = logoImgHtml
    ? `<div style="display:inline-block;background:#fff;padding:6px 12px;border-radius:6px;margin:0 auto 8px;">${logoImgHtml}</div>`
    : `<div style="height:36px;margin:0 auto 8px;color:#ccfbf1;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;">${company}</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1e293b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6f8;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 4px 24px rgba(15,118,110,0.12);">
        <tr><td style="background:#0F766E;padding:20px 28px;text-align:center;">
          ${brandBlock}
          <h1 style="margin:0;font-size:18px;font-weight:700;color:#fff;">${escapeHtml(title)}</h1>
        </td></tr>
        <tr><td style="padding:28px;font-size:14px;line-height:1.65;color:#334155;">
          ${bodyHtml}
          ${ctaBlock}
          <p style="margin:28px 0 0;font-size:12px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:16px;">— ${company} Human Resources</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function offerActionButtons({ acceptUrl, rejectUrl }) {
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px auto 0;">
    <tr>
      <td style="padding-right:8px;">
        <a href="${escapeAttr(acceptUrl)}" style="display:inline-block;background:#0F766E;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:14px;font-weight:700;">Accept Offer</a>
      </td>
      <td style="padding-left:8px;">
        <a href="${escapeAttr(rejectUrl)}" style="display:inline-block;background:#fff;color:#b91c1c;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:14px;font-weight:700;border:2px solid #fecaca;">Reject Offer</a>
      </td>
    </tr>
  </table>`;
}

module.exports = {
  escapeHtml,
  escapeAttr,
  brandedEmailLayout,
  offerActionButtons,
};
