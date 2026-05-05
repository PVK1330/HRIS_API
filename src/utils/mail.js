'use strict';

const nodemailer = require('nodemailer');
const env = require('../config/env');
const logger = require('./logger');

/**
 * Mail Utility using Nodemailer
 */
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT, 10) || 587,
  secure: (process.env.EMAIL_SECURE === 'true'), 
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

/**
 * Send an email
 * @param {Object} options { to, subject, html, text }
 */
async function sendMail({ to, subject, html, text }) {
  try {
    const info = await transporter.sendMail({
      from: `"${process.env.EMAIL_FROM_NAME || 'HRIS Support'}" <${process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_USER}>`,
      to,
      subject,
      text,
      html,
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
