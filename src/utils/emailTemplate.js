'use strict';

const fs = require('fs').promises;
const path = require('path');
const env = require('../config/env');

/**
 * Renders an email template with the given data.
 * 
 * @param {string} templateName - Name of the template file (without .html)
 * @param {Object} data - Key-value pairs to replace in the template
 * @returns {Promise<string>} - The rendered HTML
 */
async function renderEmail(templateName, data = {}) {
  const templatesDir = path.join(__dirname, '..', 'templates', 'emails');
  
  // 1. Read base template
  let baseHtml = await fs.readFile(path.join(templatesDir, 'base.html'), 'utf8');
  
  // 2. Read specific template
  const templateHtml = await fs.readFile(path.join(templatesDir, `${templateName}.html`), 'utf8');
  
  // 3. Inject logo URL (In production, use absolute URL from env)
  const logoUrl = env.APP_URL 
    ? `${env.APP_URL}/uploads/logos/HRIS_Logo.png` 
    : 'https://raw.githubusercontent.com/username/repo/main/public/HRIS_Logo.png'; // Fallback
  
  data.logoUrl = logoUrl;

  // 4. Render specific template with data
  let renderedContent = templateHtml;
  for (const [key, value] of Object.entries(data)) {
    const placeholder = new RegExp(`{{${key}}}`, 'g');
    renderedContent = renderedContent.replace(placeholder, value);
  }

  // 5. Wrap in base template
  let finalHtml = baseHtml.replace('{{content}}', renderedContent);
  finalHtml = finalHtml.replace('{{logoUrl}}', logoUrl);

  return finalHtml;
}

module.exports = {
  renderEmail
};
