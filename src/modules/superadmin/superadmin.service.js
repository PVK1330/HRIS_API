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

  const token = jwt.sign(
    {
      id: record.id,
      email: record.email,
      role: 'superadmin',
      tenant_id: null,
    },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN }
  );

  return {
    token,
    superadmin: {
      id: record.id,
      name: record.name,
      email: record.email,
    },
  };
}

module.exports = {
  login,
};
