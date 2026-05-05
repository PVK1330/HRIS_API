'use strict';

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { superadminPool } = require('../../config/db');
const { sendMail } = require('../../utils/mail');
const env = require('../../config/env');
const ApiError = require('../../utils/ApiError');

/**
 * Auth Service: Handles OTP, 2FA and Password Reset logic
 */

/**
 * Request Password Reset OTP
 */
async function requestPasswordReset(email) {
  // 1. Check if user exists in SuperAdmin or Tenants
  // For simplicity, we search in public.tenants (admin_email) first
  const result = await superadminPool.query(
    'SELECT id, name FROM public.tenants WHERE admin_email = $1',
    [email]
  );

  if (result.rows.length === 0) {
    // We don't reveal if email exists or not for security
    return { success: true, message: 'If the email exists, an OTP has been sent.' };
  }

  const tenant = result.rows[0];
  const otp = crypto.randomInt(100000, 999999).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

  // 2. Store OTP in DB
  await superadminPool.query(
    `UPDATE public.tenants 
     SET otp_code = $1, otp_expires_at = $2 
     WHERE id = $3`,
    [otp, expiresAt, tenant.id]
  );

  // 3. Send Email
  await sendMail({
    to: email,
    subject: 'HRIS - Password Reset Code',
    text: `Your password reset code is: ${otp}. It will expire in 10 minutes.`,
    html: `
      <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
        <h2 style="color: #0F766E;">Password Reset</h2>
        <p>You requested a password reset for your HRIS account.</p>
        <div style="background: #f0fdfa; padding: 20px; text-align: center; border-radius: 10px; margin: 20px 0;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #0F766E;">${otp}</span>
        </div>
        <p style="color: #666; font-size: 14px;">This code will expire in 10 minutes.</p>
      </div>
    `
  });

  return { success: true };
}

/**
 * Verify OTP
 */
async function verifyOTP(email, otp) {
  const result = await superadminPool.query(
    `SELECT id, otp_code, otp_expires_at 
     FROM public.tenants 
     WHERE admin_email = $1`,
    [email]
  );

  if (result.rows.length === 0) {
    throw ApiError.notFound('User not found');
  }

  const user = result.rows[0];

  if (!user.otp_code || user.otp_code !== otp) {
    throw ApiError.badRequest('Invalid OTP code');
  }

  if (new Date() > new Date(user.otp_expires_at)) {
    throw ApiError.badRequest('OTP code has expired');
  }

  return { success: true };
}

/**
 * Reset Password
 */
async function resetPassword(email, otp, newPassword) {
  await verifyOTP(email, otp);

  const passwordHash = await bcrypt.hash(newPassword, env.BCRYPT_SALT_ROUNDS);

  await superadminPool.query(
    `UPDATE public.tenants 
     SET password_hash = $1, otp_code = NULL, otp_expires_at = NULL 
     WHERE admin_email = $2`,
    [passwordHash, email]
  );

  return { success: true };
}

/**
 * Verify 2FA Code during Login
 */
async function verify2FA(userId, code) {
  const result = await superadminPool.query(
    'SELECT two_factor_secret FROM public.tenants WHERE id = $1',
    [userId]
  );

  if (result.rows.length === 0) {
    throw ApiError.notFound('User not found');
  }

  const { two_factor_secret } = result.rows[0];

  const verified = speakeasy.totp.verify({
    secret: two_factor_secret,
    encoding: 'base32',
    token: code
  });

  if (!verified) {
    throw ApiError.badRequest('Invalid 2FA code');
  }

  return { success: true };
}

module.exports = {
  requestPasswordReset,
  verifyOTP,
  resetPassword,
  verify2FA
};
