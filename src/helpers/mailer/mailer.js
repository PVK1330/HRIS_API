'use strict';

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const ApiError = require('../../utils/ApiError');
const logger = require('../../utils/logger');
const templateEngine = require('./templateEngine');

const TEMPLATES_DIR = path.join(__dirname, 'templates');

/**
 * Reads `base.html` once and caches it. Throws clearly if missing.
 */
let _baseLayoutCache = null;
function getBaseLayout() {
  if (_baseLayoutCache !== null) return _baseLayoutCache;
  const p = path.join(TEMPLATES_DIR, 'base.html');
  if (!fs.existsSync(p)) {
    throw new ApiError(500, `Email base layout not found at ${p}`);
  }
  _baseLayoutCache = fs.readFileSync(p, 'utf8');
  return _baseLayoutCache;
}

/**
 * Build a nodemailer transporter from a normalized SMTP config.
 *
 * @param {{host:string, port:number, username:string, password:string, encryption:'tls'|'ssl'|'none'}} cfg
 */
function buildTransporter(cfg) {
  const port = Number(cfg.port) || 587;
  const encryption = (cfg.encryption || 'tls').toLowerCase();

  return nodemailer.createTransport({
    host: cfg.host,
    port,
    // SSL on port 465 / explicit ssl. Otherwise STARTTLS for tls, plain for none.
    secure: encryption === 'ssl' || port === 465,
    auth:
      cfg.username || cfg.password
        ? { user: cfg.username, pass: cfg.password }
        : undefined,
    requireTLS: encryption === 'tls',
    tls: encryption === 'none' ? { rejectUnauthorized: false } : undefined,
  });
}

/**
 * Reusable Mailer.
 *
 * Always obtain via Mailer.getInstance() (singleton). The singleton is
 * automatically rebuilt if SMTP settings in the DB change.
 *
 * Direct `new Mailer(cfg)` is supported for tests / one-off SMTP configs.
 */
class Mailer {
  constructor(smtpConfig) {
    this.config = {
      host: (smtpConfig && smtpConfig.host) || '',
      port: (smtpConfig && smtpConfig.port) || 587,
      username: (smtpConfig && smtpConfig.username) || '',
      password: (smtpConfig && smtpConfig.password) || '',
      encryption: (smtpConfig && smtpConfig.encryption) || 'tls',
      fromEmail: (smtpConfig && smtpConfig.fromEmail) || '',
      fromName: (smtpConfig && smtpConfig.fromName) || '',
      appName: (smtpConfig && smtpConfig.appName) || 'HRIS System',
    };
    this._transporter = null;
  }

  _getTransporter() {
    if (!this._transporter) {
      if (!this.config.host) {
        throw new ApiError(
          400,
          'SMTP host is not configured. Please set it under Settings → Email.'
        );
      }
      this._transporter = buildTransporter(this.config);
    }
    return this._transporter;
  }

  /**
   * Singleton factory — pulls latest SMTP config from settings table,
   * with .env as a fallback. Recreates the cached instance whenever the
   * underlying SMTP config changes.
   */
  static async getInstance() {
    // Lazy require to avoid a circular dependency on app boot:
    //   app.js -> settings.routes -> settings.controller -> ... -> mailer
    const settingsService = require('../../modules/settings/settings.service');
    const env = require('../../config/env');

    const email = await settingsService.getSettingsByGroup('email');
    const company = await settingsService.getSettingsByGroup('company');

    // Prefer org-admin SMTP (Settings → Email); otherwise fall back to the .env defaults.
    // Mirrors utils/mail.js: supports EMAIL_* and MAIL_* var names, and defaults the host to
    // Gmail when only a username/password is provided in .env (common for dev/Gmail app passwords).
    const envUser = process.env.EMAIL_USER || process.env.MAIL_USER || '';
    const envPass = process.env.EMAIL_PASS || process.env.MAIL_PASS || '';
    const envHost = process.env.EMAIL_HOST || process.env.MAIL_HOST
      || (envUser ? 'smtp.gmail.com' : '');
    const cfg = {
      host: email.smtpHost || envHost,
      port: Number(email.smtpPort || process.env.EMAIL_PORT || process.env.MAIL_PORT || 587),
      username: email.smtpUsername || envUser,
      password: email.smtpPassword || envPass,
      encryption: email.smtpEncryption || process.env.EMAIL_ENCRYPTION || process.env.MAIL_ENCRYPTION || 'tls',
      fromEmail: email.systemEmail || process.env.EMAIL_FROM_ADDRESS || process.env.MAIL_FROM || envUser,
      fromName: email.systemFromName || process.env.EMAIL_FROM_NAME || process.env.MAIL_FROM_NAME || process.env.APP_NAME || 'HRIS System',
      appName: company.companyName || process.env.APP_NAME || 'HRIS System',
      companyLogo: (await settingsService.getSettingsByGroup('logo'))?.largeLogo || '',
    };

    // Cache key based on every connection-relevant value, so a settings
    // change automatically invalidates the previous transporter.
    const cacheKey = [
      cfg.host, cfg.port, cfg.username, cfg.password,
      cfg.encryption, cfg.fromEmail, cfg.fromName, cfg.appName, cfg.companyLogo,
    ].join('|');

    if (Mailer._instance && Mailer._cacheKey === cacheKey) {
      return Mailer._instance;
    }

    // Replace stale instance.
    if (Mailer._instance && Mailer._instance._transporter) {
      try { Mailer._instance._transporter.close(); } catch (_) {
        logger.debug('[mailer] transporter.close() failed on rebuild', { err: _.message });
      }
    }

    Mailer._instance = new Mailer(cfg);
    Mailer._cacheKey = cacheKey;
    return Mailer._instance;
  }

  /** Force the next getInstance() to rebuild from DB. Call after Settings update. */
  static invalidate() {
    if (Mailer._instance && Mailer._instance._transporter) {
      try { Mailer._instance._transporter.close(); } catch (_) {
        logger.debug('[mailer] transporter.close() failed on invalidate', { err: _.message });
      }
    }
    Mailer._instance = null;
    Mailer._cacheKey = null;
  }

  /**
   * Wraps the rendered body inside the base layout and substitutes layout vars.
   */
  _wrapInLayout(renderedBody, variables, attachmentsToMutate = null) {
    const layout = getBaseLayout();
    const app_name = variables.app_name || this.config.appName;
    const company_logo = variables.company_logo || this.config.companyLogo;

    let company_header_html = `<h1 style="margin:0;font-size:20px;font-weight:700;color:#111827;letter-spacing:-0.01em;">${app_name}</h1>`;
    if (company_logo) {
      if (company_logo.startsWith('http')) {
        company_header_html = `<img src="${company_logo}" alt="${app_name}" style="max-height: 48px; max-width: 150px; display: block; margin: 0 auto;" />`;
      } else {
        let attached = false;
        if (attachmentsToMutate) {
          const fs = require('fs');
          const path = require('path');
          const env = require('../../config/env');
          const rel = company_logo.replace(/^\/uploads\//, '');
          const diskPath = path.resolve(env.UPLOAD.dir, rel);
          if (fs.existsSync(diskPath)) {
            const cid = 'companylogo-' + Date.now();
            attachmentsToMutate.push({
              filename: path.basename(diskPath),
              path: diskPath,
              cid: cid
            });
            company_header_html = `<img src="cid:${cid}" alt="${app_name}" style="max-height: 48px; max-width: 150px; display: block; margin: 0 auto;" />`;
            attached = true;
          }
        }
        if (!attached) {
          const logoUrl = `http://localhost:${process.env.PORT || 5000}${company_logo}`;
          company_header_html = `<img src="${logoUrl}" alt="${app_name}" style="max-height: 48px; max-width: 150px; display: block; margin: 0 auto;" />`;
        }
      }
    }

    return templateEngine.render(layout, {
      ...variables,
      body: renderedBody,
      app_name,
      company_header_html,
      year: String(new Date().getFullYear()),
    });
  }

  _fromHeader() {
    const name = this.config.fromName || this.config.appName || 'HRIS System';
    const email = this.config.fromEmail || this.config.username;
    if (!email) {
      throw new ApiError(
        400,
        'System email is not configured. Please set "System Email" under Settings → Email.'
      );
    }
    return `"${name}" <${email}>`;
  }

  /**
   * Send an email using a DB-stored template (by slug).
   *
   * @param {{ to:string, subject?:string, templateSlug:string, variables?:object, attachments?:Array }} args
   */
  async send({ to, subject, templateSlug, variables = {}, attachments = [] }) {
    if (!to) throw new ApiError(400, 'Recipient `to` is required');
    if (!templateSlug) throw new ApiError(400, '`templateSlug` is required');

    const repo = require('../../modules/settings/settings.repository');
    const tpl = await repo.findEmailTemplateBySlug(templateSlug);
    if (!tpl) {
      throw new ApiError(404, `Email template not found: ${templateSlug}`);
    }
    if (!tpl.is_active) {
      throw new ApiError(400, `Email template "${templateSlug}" is disabled`);
    }

    const mergedVars = {
      app_name: this.config.appName,
      ...variables,
    };

    let finalAttachments = Array.isArray(attachments) ? [...attachments] : [];
    const renderedSubject = templateEngine.render(subject || tpl.subject, mergedVars);
    const renderedBody = templateEngine.render(tpl.body, mergedVars);
    const html = this._wrapInLayout(renderedBody, mergedVars, finalAttachments);

    return this.sendRaw({ to, subject: renderedSubject, html, attachments: finalAttachments, variables: mergedVars });
  }

  /**
   * Send an email with arbitrary HTML (no template lookup, but still wrapped in
   * the base layout for a consistent look). Used for the "send test email" flow.
   */
  async sendRaw({ to, subject, html, attachments, variables = {} }) {
    if (!to) throw new ApiError(400, 'Recipient `to` is required');
    if (!subject) throw new ApiError(400, '`subject` is required');
    if (!html) throw new ApiError(400, '`html` is required');

    const transporter = this._getTransporter();
    let finalAttachments = Array.isArray(attachments) ? [...attachments] : [];
    const wrapped = html.includes('<html') ? html : this._wrapInLayout(html, variables, finalAttachments);

    try {
      const info = await transporter.sendMail({
        from: this._fromHeader(),
        to,
        subject,
        html: wrapped,
        // Optional nodemailer attachments: [{ filename, content: <Buffer> }, ...]
        ...(finalAttachments.length ? { attachments: finalAttachments } : {}),
      });
      logger.info(`[mailer] sent to=${to} subject="${subject}" messageId=${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (err) {
      logger.error('[mailer] send failed', err.message);
      throw new ApiError(400, `Failed to send email: ${err.message}`);
    }
  }

  /**
   * Test the SMTP connection. Returns { success: true } or throws ApiError(400).
   */
  async verify() {
    const transporter = this._getTransporter();
    try {
      await transporter.verify();
      return { success: true };
    } catch (err) {
      logger.error('[mailer] verify failed', err.message);
      throw new ApiError(400, `SMTP verification failed: ${err.message}`);
    }
  }
}

Mailer._instance = null;
Mailer._cacheKey = null;

module.exports = { Mailer };
