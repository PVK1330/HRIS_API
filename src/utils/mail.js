'use strict';

const nodemailer = require('nodemailer');
const env = require('../config/env');
const logger = require('./logger');

/**
 * Mail Utility using Nodemailer
 * Supports MAIL_* and EMAIL_* env vars. Reloads dotenv on each send so .env edits apply without restart.
 * @param {Object} options { to, subject, html, text, attachments? }
 */
async function sendMail({ to, subject, html, text, attachments }) {
  try {
    require('dotenv').config();

    const mailHost = process.env.MAIL_HOST || process.env.EMAIL_HOST || 'smtp.gmail.com';
    const mailPort = parseInt(process.env.MAIL_PORT || process.env.EMAIL_PORT, 10) || 587;
    const mailUser = process.env.MAIL_USER || process.env.EMAIL_USER;
    const mailPass = process.env.MAIL_PASS || process.env.EMAIL_PASS;
    const mailFromAddr =
      process.env.MAIL_FROM ||
      process.env.EMAIL_FROM_ADDRESS ||
      process.env.EMAIL_USER;

    const transporter = nodemailer.createTransport({
      host: mailHost,
      port: mailPort,
      secure: process.env.MAIL_SECURE === 'true' || process.env.EMAIL_SECURE === 'true',
      auth: {
        user: mailUser,
        pass: mailPass,
      },
    });

    const info = await transporter.sendMail({
      from: `"${process.env.EMAIL_FROM_NAME || process.env.MAIL_FROM_NAME || 'HRIS Support'}" <${mailFromAddr}>`,
      to,
      subject,
      text,
      html,
      attachments,
    });

    logger.info(`Email sent to ${to}: ${info.messageId}`);
    return info;
  } catch (error) {
    logger.error(`Failed to send email to ${to}`, error);
    // In development, we don't want to crash if email fails
    if (env.NODE_ENV === 'development') {
      logger.warn('--- MOCK EMAIL CONTENT ---');
      logger.warn(`To: ${to}`);
      logger.warn(`Subject: ${subject}`);
      logger.warn(`Body: ${text || 'HTML Content'}`);
      logger.warn('--------------------------');
      return { messageId: 'mock-id' };
    }
    throw error;
  }
}

module.exports = {
  sendMail,
};
