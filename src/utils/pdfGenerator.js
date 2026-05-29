const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const PDF_NAV_TIMEOUT_MS = Number(process.env.PDF_NAV_TIMEOUT_MS) || 60_000;

function resolveLogoPath() {
  const candidates = [
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
  const logoPath = resolveLogoPath();

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
          align-items: center;
          padding-bottom: 20px;
          border-bottom: 2px solid #0F766E;
          margin-bottom: 40px;
        }
        .header img {
          max-width: 150px;
          max-height: 60px;
        }
        .header .company-details {
          text-align: right;
          font-size: 12px;
          color: #64748b;
        }
        .header .company-details strong {
          color: #0F766E;
          font-size: 16px;
        }
        .content {
          margin-top: 20px;
        }
        .footer {
          margin-top: 60px;
          padding-top: 20px;
          border-top: 1px solid #e2e8f0;
          text-align: center;
          font-size: 10px;
          color: #94a3b8;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          ${logoDataUri ? `<img src="${logoDataUri}" alt="Logo">` : `<h2>${companyName}</h2>`}
        </div>
        <div class="company-details">
          <strong>${companyName}</strong><br>
          ${companyAddress}<br>
          ${companyEmail}
        </div>
      </div>
      
      <div class="content">
        ${htmlBody}
      </div>

      <div class="footer">
        This document is electronically generated and requires no physical signature.
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
    console.error('Error generating PDF with Puppeteer:', error);
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
