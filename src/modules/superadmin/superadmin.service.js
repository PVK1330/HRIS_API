'use strict';

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const env = require('../../config/env');
const ApiError = require('../../utils/ApiError');
const repo = require('./superadmin.repository');

/**
 * Authenticates a superadmin and returns a signed JWT plus public profile.
 *
 * @param {{ email: string, password: string }} input
 * @returns {Promise<{ token: string, superadmin: { id: string, name: string, email: string } }>}
 */
async function login({ email, password }) {
  const normalizedEmail = String(email).trim().toLowerCase();

  const record = await repo.findByEmail(normalizedEmail);
  if (!record) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  const passwordMatches = await bcrypt.compare(password, record.password_hash);
  if (!passwordMatches) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  // 2FA Challenge
  if (record.two_factor_enabled) {
    return {
      mfaRequired: true,
      userId: record.id,
      email: record.email,
    };
  }

  const token = jwt.sign(
    {
      id: record.id,
      email: record.email,
      role: 'superadmin',
      tenant_id: null,
    },
    env.JWT.secret,
    { expiresIn: env.JWT.expiresIn }
  );

  return {
    token,
    superadmin: {
      id: record.id,
      name: record.name,
      email: record.email,
      role: 'superadmin',
    },
  };
}

const speakeasy = require('speakeasy');

async function verify2FA({ userId, code }) {
  const record = await repo.findById(userId);
  if (!record) {
    throw ApiError.notFound('User not found');
  }

  const verified = speakeasy.totp.verify({
    secret: record.two_factor_secret,
    encoding: 'base32',
    token: code,
  });

  if (!verified) {
    throw ApiError.unauthorized('Invalid verification code');
  }

  const token = jwt.sign(
    {
      id: record.id,
      email: record.email,
      role: 'superadmin',
      tenant_id: null,
    },
    env.JWT.secret,
    { expiresIn: env.JWT.expiresIn }
  );

  return {
    token,
    superadmin: {
      id: record.id,
      name: record.name,
      email: record.email,
      role: 'superadmin',
    },
  };
}

module.exports = {
  login,
  verify2FA,
};
