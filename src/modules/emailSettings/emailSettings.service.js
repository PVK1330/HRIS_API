'use strict';

const nodemailer = require('nodemailer');
const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const logger = require('../../utils/logger');

// Columns that are safe to return to the client (password excluded)
const SAFE_COLUMNS = [
  'smtp_host',
  'smtp_port',
  'smtp_username',
  'sender_email',
  'sender_name',
  'email_notifications_enabled',
  'smtp_secure',
];

function mapRow(row) {
  if (!row) return null;
  return {
    smtpHost:                  row.smtp_host,
    smtpPort:                  row.smtp_port,
    smtpUsername:              row.smtp_username,
    senderEmail:               row.sender_email,
    senderName:                row.sender_name,
    emailNotificationsEnabled: row.email_notifications_enabled,
    smtpSecure:                row.smtp_secure,
  };
}

/**
 * getEmailSettings(dbName)
 * Returns SMTP settings WITHOUT the encrypted password.
 */
async function getEmailSettings(dbName) {
  const pool = getTenantPool(dbName);
  const { rows } = await pool.query(
    `SELECT ${SAFE_COLUMNS.join(', ')} FROM tenant_admin_settings LIMIT 1`,
  );
  return mapRow(rows[0] || null);
}

/**
 * updateEmailSettings(dbName, data)
 * Updates SMTP fields. If data.smtp_password is provided and non-empty,
 * it is stored in smtp_password_enc (plain for now; encrypt in production).
 * Returns updated settings without the password.
 */
async function updateEmailSettings(dbName, data) {
  const pool = getTenantPool(dbName);

  const setClauses = [];
  const params = [];

  function addParam(col, value) {
    params.push(value);
    setClauses.push(`${col} = $${params.length}`);
  }

  if (data.smtp_host                  !== undefined) addParam('smtp_host',                   data.smtp_host);
  if (data.smtp_port                  !== undefined) addParam('smtp_port',                   data.smtp_port);
  if (data.smtp_username              !== undefined) addParam('smtp_username',                data.smtp_username);
  if (data.sender_email               !== undefined) addParam('sender_email',                 data.sender_email);
  if (data.sender_name                !== undefined) addParam('sender_name',                  data.sender_name);
  if (data.email_notifications_enabled !== undefined) addParam('email_notifications_enabled', data.email_notifications_enabled);
  if (data.smtp_secure                !== undefined) addParam('smtp_secure',                  data.smtp_secure);

  // Store password only when explicitly provided and non-empty
  if (data.smtp_password && String(data.smtp_password).trim() !== '') {
    // TODO: encrypt before storing in production
    addParam('smtp_password_enc', data.smtp_password);
  }

  if (setClauses.length === 0) {
    throw new ApiError(400, 'No fields provided to update');
  }

  const sql = `
    UPDATE tenant_admin_settings
    SET ${setClauses.join(', ')}
    RETURNING ${SAFE_COLUMNS.join(', ')}
  `;

  const { rows } = await pool.query(sql, params);
  if (!rows[0]) {
    throw new ApiError(404, 'Email settings record not found');
  }
  return mapRow(rows[0]);
}

/**
 * testEmailSettings(dbName)
 * Reads current SMTP settings and verifies the transporter connection.
 * Returns { success: boolean, message: string }.
 */
async function testEmailSettings(dbName) {
  const pool = getTenantPool(dbName);

  // Fetch settings including the encrypted password (internal use only)
  const { rows } = await pool.query(
    `SELECT smtp_host, smtp_port, smtp_username, smtp_password_enc, smtp_secure
     FROM tenant_admin_settings LIMIT 1`,
  );
  const row = rows[0];

  if (!row || !row.smtp_host) {
    return { success: false, message: 'SMTP settings are not configured' };
  }

  const port   = Number(row.smtp_port) || 587;
  const secure = row.smtp_secure === true || row.smtp_secure === 'true' || port === 465;

  const transporter = nodemailer.createTransport({
    host:   row.smtp_host,
    port,
    secure,
    auth:
      row.smtp_username || row.smtp_password_enc
        ? { user: row.smtp_username, pass: row.smtp_password_enc }
        : undefined,
    connectionTimeout: 8000,
    greetingTimeout:   5000,
    socketTimeout:     10000,
  });

  try {
    await transporter.verify();
    return { success: true, message: 'SMTP connection verified successfully' };
  } catch (err) {
    logger.warn('[emailSettings] SMTP test failed:', err.message);
    return { success: false, message: `SMTP connection failed: ${err.message}` };
  }
}

module.exports = {
  getEmailSettings,
  updateEmailSettings,
  testEmailSettings,
};
