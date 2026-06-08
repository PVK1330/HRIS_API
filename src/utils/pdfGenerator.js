const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const PDF_NAV_TIMEOUT_MS = Number(process.env.PDF_NAV_TIMEOUT_MS) || 60_000;

function resolveLogoPath(tenantLogoPath = '') {
  let dbLogoPath = null;
  if (tenantLogoPath && typeof tenantLogoPath === 'string') {
    const env = require('../config/env');
    // e.g. /uploads/superadmin-logos/xyz.png -> ./src/uploads/superadmin-logos/xyz.png
    const relative = tenantLogoPath.replace(/^\/uploads\//, '');
    dbLogoPath = path.resolve(env.UPLOAD.dir, relative);
  }

  const candidates = [
    dbLogoPath,
    process.env.HRIS_LOGO_PATH,
    path.resolve(__dirname, '../../../HRIS/public/HRIS_Logo.png'),
    path.resolve(__dirname, '../../public/HRIS_Logo.png'),
    path.resolve(process.cwd(), '../HRIS/public/HRIS_Logo.png'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function getPuppeteerLaunchOptions() {
  const options = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  };

  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    options.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  return options;
}

/**
 * Replace placeholders like {{employee_name}} in the HTML template
 */
function replacePlaceholders(html, data) {
  let result = html;
  for (const [key, value] of Object.entries(data)) {
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    result = result.replace(regex, value || '');
  }
  return result;
}

/**
 * Generate PDF from HTML template using Puppeteer
 * @param {string} htmlBody - The HTML content to render
 * @param {object} tenant - Tenant data for header branding
 * @returns {Buffer} - The generated PDF buffer
 */
async function generatePdfFromHtml(htmlBody, tenant = {}) {
  let logoDataUri = '';
  const logoPath = resolveLogoPath(tenant.company_logo_path);

  if (logoPath) {
    const logoBuffer = fs.readFileSync(logoPath);
    const logoBase64 = logoBuffer.toString('base64');
    logoDataUri = `data:image/png;base64,${logoBase64}`;
  }

  const companyName = tenant.company_name || 'Organization Name';
  const companyEmail = tenant.contact_email || 'hr@organization.com';
  const companyAddress = tenant.company_address || '123 Corporate Blvd, Business City';

  // Build the complete HTML document wrapper
  const fullHtml = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Document</title>
      <style>
        body {
          font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
          color: #1e293b;
          margin: 0;
          padding: 0;
          font-size: 14px;
          line-height: 1.6;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding-top: 15px;
          padding-bottom: 20px;
          border-top: 4px solid #10B981;
          border-bottom: 1px solid #e2e8f0;
          margin-bottom: 40px;
        }
        .header-left {
          display: flex;
          align-items: center;
          gap: 15px;
        }
        .header-left img {
          max-width: 150px;
          max-height: 60px;
        }
        .header-company {
          display: flex;
          flex-direction: column;
        }
        .header-company-name {
          font-size: 18px;
          font-weight: 700;
          color: #1e293b;
          text-transform: uppercase;
        }
        .header-dept {
          font-size: 11px;
          font-weight: 600;
          color: #10B981;
          letter-spacing: 1px;
        }
        .content {
          margin-top: 20px;
        }
        .footer {
          margin-top: 60px;
          padding-top: 15px;
          border-top: 1px solid #10B981;
          text-align: center;
          font-size: 11px;
          color: #64748b;
        }
        .footer-details {
          display: flex;
          justify-content: center;
          gap: 15px;
          margin-bottom: 8px;
          color: #475569;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="header-left">
          ${logoDataUri ? `<img src="${logoDataUri}" alt="Logo">` : ``}
          <div class="header-company">
            <span class="header-company-name">${companyName}</span>
            <span class="header-dept">HUMAN RESOURCES DIVISION</span>
          </div>
        </div>
        <div style="text-align: right; font-size: 12px; color: #475569;">
          <!-- Specific document details like Ref No can be injected in content -->
        </div>
      </div>
      
      <div class="content">
        ${htmlBody}
      </div>

      <div class="footer">
        <div class="footer-details">
          <span>${companyAddress}</span>
          <span>|</span>
          <span>${companyEmail}</span>
        </div>
        <div>This document is electronically generated and requires no physical signature.</div>
      </div>
    </body>
    </html>
  `;

  let browser = null;
  try {
    browser = await puppeteer.launch(getPuppeteerLaunchOptions());

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(PDF_NAV_TIMEOUT_MS);
    page.setDefaultTimeout(PDF_NAV_TIMEOUT_MS);

    // Abort slow external requests (CDN fonts/images in letter templates) that block networkidle0
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      if (url.startsWith('data:') || url === 'about:blank') {
        req.continue();
        return;
      }
      if (/^https?:\/\//i.test(url)) {
        req.abort('blockedbyclient');
        return;
      }
      req.continue();
    });

    // domcontentloaded is reliable for inline/static HTML; networkidle0 often times out
    await page.setContent(fullHtml, {
      waitUntil: 'domcontentloaded',
      timeout: PDF_NAV_TIMEOUT_MS,
    });

    try {
      await Promise.race([
        page.evaluate(() => document.fonts && document.fonts.ready),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
    } catch {
      /* optional font wait */
    }

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '50px',
        bottom: '50px',
        left: '50px',
        right: '50px',
      },
    });

    return pdfBuffer;
  } catch (error) {
    logger.error('[pdf] puppeteer PDF generation failed', { err: error.message });
    if (error.message && /Could not find Chrome|executablePath/i.test(error.message)) {
      const hint = new Error(
        'PDF engine: Chrome/Chromium not found. Install Chrome or set PUPPETEER_EXECUTABLE_PATH in .env to your chrome.exe path.',
      );
      hint.cause = error;
      throw hint;
    }
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = {
  generatePdfFromHtml,
  replacePlaceholders
};
