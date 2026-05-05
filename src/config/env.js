'use strict';

const path = require('path');
const dotenv = require('dotenv');

// Always load .env from the project root (one level up from /src/config)
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

const REQUIRED_KEYS = [
  'DB_USER',
  'DB_NAME',
  'DB_HOST',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'ENCRYPTION_KEY',
];

function assertEnv() {
  const missing = REQUIRED_KEYS.filter((k) => !process.env[k] || String(process.env[k]).trim() === '');
  if (missing.length > 0) {
    throw new Error(`[env] Missing required environment variables: ${missing.join(', ')}`);
  }

  if (String(process.env.JWT_SECRET).length < 64) {
    throw new Error('[env] JWT_SECRET must be at least 64 characters long (hex)');
  }
  if (String(process.env.JWT_REFRESH_SECRET).length < 64) {
    throw new Error('[env] JWT_REFRESH_SECRET must be at least 64 characters long (hex)');
  }
  if (String(process.env.ENCRYPTION_KEY).length !== 64) {
    throw new Error('[env] ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
}

assertEnv();

const env = Object.freeze({
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT, 10) || 5000,

  CORS_ORIGINS: (process.env.CORS_ORIGINS || '')
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

  JWT: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },

  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
  BCRYPT_SALT_ROUNDS: parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) || 12,

  UPLOAD: {
    dir: process.env.UPLOAD_DIR || './uploads',
    maxSize: (parseInt(process.env.UPLOAD_MAX_SIZE_MB, 10) || 2) * 1024 * 1024,
  },

  RATE_LIMIT: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 900000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
    authMax: parseInt(process.env.AUTH_RATE_LIMIT_MAX, 10) || 10,
  },

  SEED: {
    email: process.env.SEED_SUPERADMIN_EMAIL,
    password: process.env.SEED_SUPERADMIN_PASSWORD,
    name: process.env.SEED_SUPERADMIN_NAME,
  },
});

module.exports = env;
