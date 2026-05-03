'use strict';

const path = require('path');
const dotenv = require('dotenv');

// Always load .env from the project root (one level up from /src/config)
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

const REQUIRED_KEYS = [
  'DB_USER',
  'DB_PASS',
  'DB_NAME',
  'DB_HOST',
  'DB_PORT',
  'JWT_SECRET',
];

function assertEnv() {
  const missing = REQUIRED_KEYS.filter((k) => !process.env[k] || String(process.env[k]).trim() === '');
  if (missing.length > 0) {
    // Throw before the app boots so misconfiguration is loud and obvious.
    throw new Error(`[env] Missing required environment variables: ${missing.join(', ')}`);
  }

  if (String(process.env.JWT_SECRET).length < 32) {
    throw new Error('[env] JWT_SECRET must be at least 32 characters long');
  }
}

assertEnv();

const env = Object.freeze({
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT, 10) || 5000,

  CORS_ORIGINS: (process.env.CORS_ORIGINS || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  DB: {
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10) || 5432,
  },

  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',

  SEED: {
    email: process.env.SEED_SUPERADMIN_EMAIL,
    password: process.env.SEED_SUPERADMIN_PASSWORD,
    name: process.env.SEED_SUPERADMIN_NAME,
  },
});

module.exports = env;
