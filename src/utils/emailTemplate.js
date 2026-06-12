'use strict';

const fs = require('fs').promises;
const path = require('path');
const emailLogo = require('../helpers/mailer/emailLogo');

/**
 * Renders an email template with the given data.
 *
 * The logo is resolved by context: an organisation/tenant email gets that org's
 * logo, otherwise the HRIS platform logo. It is embedded inline via CID, so the
 * resulting attachments MUST be forwarded to the mail transport.
 *
 * @param {string} templateName - Name of the template file (without .html)
 * @param {Object} data - Key-value pairs to replace in the template
 * @param {{tenant?: object}} [options] - tenant context for org branding
 * @returns {Promise<{html:string, attachments:Array}>}
 */
async function renderEmail(templateName, data = {}, options = {}) {
  const templatesDir = path.join(__dirname, '..', 'templates', 'emails');

  // 1. Read base + specific templates
  let baseHtml = await fs.readFile(path.join(templatesDir, 'base.html'), 'utf8');
  const templateHtml = await fs.readFile(path.join(templatesDir, `${templateName}.html`), 'utf8');

  // 2. Resolve the correct logo (org vs HRIS). Inline via CID for email; use an
  //    absolute URL when the result is shown in a browser (options.preferUrl).
  const { imgHtml, attachments, name } = await emailLogo.resolveLogoBlock(options.tenant || null, {
    preferUrl: !!options.preferUrl,
  });
  const safeName = String(name || 'HRIS').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const logoBlock = imgHtml
    ? `<span style="display:inline-block;background:#ffffff;padding:6px 12px;border-radius:6px;">${imgHtml}</span>`
    : `<span style="font-size:22px;font-weight:800;color:#ffffff;">${safeName}</span>`;

  // 3. Render specific template with data
  let renderedContent = templateHtml;
  for (const [key, value] of Object.entries(data)) {
    const placeholder = new RegExp(`{{${key}}}`, 'g');
    renderedContent = renderedContent.replace(placeholder, value);
  }

  // 4. Wrap in base template
  let finalHtml = baseHtml.replace('{{content}}', renderedContent);
  // Support both the new {{logoBlock}} token and the legacy {{logoUrl}} <img> markup.
  finalHtml = finalHtml.replace(/{{logoBlock}}/g, logoBlock);
  finalHtml = finalHtml.replace(/{{logoUrl}}/g, '');

  return { html: finalHtml, attachments };
}

module.exports = {
  renderEmail
};
