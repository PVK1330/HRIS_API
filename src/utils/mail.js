'use strict';

const env = require('../config/env');
const logger = require('./logger');

function shouldMockOnFailure() {
  if (process.env.MAIL_FORCE_SEND === 'true') return false;
  return env.NODE_ENV === 'development' && process.env.MAIL_MOCK_ON_FAIL !== 'false';
}

function logMockEmail({ to, subject, text, error }) {
  logger.warn('--- EMAIL NOT SENT (SMTP failure or not configured) ---');
  if (error) logger.warn(`Reason: ${error.message || error}`);
  logger.warn(`To: ${to}`);
  logger.warn(`Subject: ${subject}`);
  logger.warn(`Body: ${text || '(HTML)'}`);
  logger.warn('Configure Settings → Email (SMTP) or MAIL_* in .env. Set MAIL_FORCE_SEND=true to surface errors in dev.');
  logger.warn('Note: addresses like user@demo.com have no real mailbox unless you use Mailtrap/Mailhog.');
  logger.warn('--------------------------------------------------------');
}

/**
 * Send email via tenant SMTP (Settings → Email) with .env fallback.
 * @param {Object} options { to, subject, html, text, attachments? }
 */
async function sendMail({ to, subject, html, text, attachments }) {
  require('dotenv').config();

  if (!to) {
    throw new Error('[mail] Recipient `to` is required');
  }

  try {
    const { Mailer } = require('../helpers/mailer/mailer');
    const mailer = await Mailer.getInstance();

    if (!mailer.config.host && !mailer.config.username) {
      const msg = '[mail] SMTP is not configured (Settings → Email or MAIL_USER/MAIL_HOST in .env)';
      if (shouldMockOnFailure()) {
        logMockEmail({ to, subject, text, error: new Error(msg) });
        return { messageId: 'mock-id', mocked: true };
      }
      throw new Error(msg);
    }

    const bodyHtml =
      html ||
      (text
        ? `<pre style="font-family:sans-serif;white-space:pre-wrap">${String(text).replace(/</g, '&lt;')}</pre>`
        : '<p>(no content)</p>');

    const result = await mailer.sendRaw({
      to,
      subject,
      html: bodyHtml,
      attachments,
    });

    logger.info(`[mail] sent to=${to} messageId=${result.messageId}`);
    return result;
  } catch (error) {
    logger.error(`[mail] failed to send to ${to}`, error);

    if (shouldMockOnFailure()) {
      logMockEmail({ to, subject, text, error });
      return { messageId: 'mock-id', mocked: true, error: error.message };
    }
    throw error;
  }
}

module.exports = {
  sendMail,
};
