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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_SMTP_ENCRYPTION = new Set(['tls', 'ssl', 'none']);

/**
 * Validate the SMTP/email environment variables.
 *
 * Email transport is OPTIONAL via .env — an org can configure SMTP at runtime
 * under Settings → Email (stored in the DB), which the mailer prefers. So:
 *  - If NO email vars are present, we only WARN (the app may rely on DB config).
 *  - If ANY email vars ARE present, the operator clearly intends env-based SMTP,
 *    so we validate them and FAIL FAST on anything missing or malformed.
 *
 * Mirrors the resolution in helpers/mailer/mailer.js: both EMAIL_* and MAIL_*
 * names are accepted, and the host defaults to Gmail when only a user is given.
 */
function validateEmailEnv() {
  const host = (process.env.EMAIL_HOST || process.env.MAIL_HOST || '').trim();
  const user = (process.env.EMAIL_USER || process.env.MAIL_USER || '').trim();
  const pass = (process.env.EMAIL_PASS || process.env.MAIL_PASS || '').trim();
  const portRaw = (process.env.EMAIL_PORT || process.env.MAIL_PORT || '').trim();
  const encRaw = (process.env.EMAIL_ENCRYPTION || process.env.MAIL_ENCRYPTION || '').trim();
  const fromRaw = (process.env.EMAIL_FROM_ADDRESS || process.env.MAIL_FROM || '').trim();

  const configured = Boolean(host || user || pass || portRaw || encRaw || fromRaw);
  if (!configured) {
    // eslint-disable-next-line no-console
    console.warn(
      '[env] No SMTP/email variables set (EMAIL_*/MAIL_*). Outbound email will ' +
        'only work if SMTP is configured under Settings → Email; otherwise email ' +
        'sending will fail. Set EMAIL_HOST/EMAIL_USER/EMAIL_PASS to enable it via .env.',
    );
    return;
  }

  const errors = [];

  // Host: explicit host, or implicit Gmail default when a user is provided.
  const effectiveHost = host || (user ? 'smtp.gmail.com' : '');
  if (!effectiveHost) {
    errors.push('SMTP host could not be determined — set EMAIL_HOST (or EMAIL_USER to default to Gmail).');
  } else if (/\s/.test(effectiveHost)) {
    errors.push(`EMAIL_HOST is malformed (contains whitespace): "${effectiveHost}".`);
  }

  // Auth must be supplied as a pair (hosts without auth, e.g. local MailHog, are allowed).
  if (user && !pass) {
    errors.push('EMAIL_USER is set but EMAIL_PASS (password) is missing.');
  }
  if (pass && !user) {
    errors.push('EMAIL_PASS is set but EMAIL_USER (username) is missing.');
  }

  // Port: when provided, must be an integer in 1–65535.
  if (portRaw) {
    const port = Number(portRaw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push(`EMAIL_PORT must be an integer between 1 and 65535 (got "${portRaw}").`);
    }
  }

  // Encryption: when provided, must be tls | ssl | none.
  if (encRaw && !VALID_SMTP_ENCRYPTION.has(encRaw.toLowerCase())) {
    errors.push(`EMAIL_ENCRYPTION must be one of tls, ssl, none (got "${encRaw}").`);
  }

  // From address: the effective sender (explicit from, else the username) must
  // be a valid email — nodemailer/_fromHeader needs a real address to send.
  const effectiveFrom = fromRaw || user;
  if (!effectiveFrom) {
    errors.push('No sender address — set EMAIL_FROM_ADDRESS (or EMAIL_USER).');
  } else if (!EMAIL_RE.test(effectiveFrom)) {
    errors.push(`Sender address is not a valid email: "${effectiveFrom}" — set a valid EMAIL_FROM_ADDRESS.`);
  }

  if (errors.length > 0) {
    throw new Error(`[env] Invalid SMTP/email configuration:\n  - ${errors.join('\n  - ')}`);
  }
}

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

  validateEmailEnv();
}

assertEnv();

const env = Object.freeze({
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT, 10) || 5000,

  CORS_ORIGINS: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  /** Allow http(s)://*.localhost:PORT (tenant workspace subdomains in dev) */
  CORS_ALLOW_SUBDOMAIN_ORIGINS: process.env.CORS_ALLOW_SUBDOMAIN_ORIGINS !== 'false',

  /** Dev only: allow any browser origin (cannot use with credentials + literal *) */
  CORS_ALLOW_ALL: process.env.CORS_ALLOW_ALL === 'true',

  /** Comma ports for *.localhost origins, e.g. 5173,4173 */
  CORS_LOCALHOST_PORTS: (process.env.CORS_LOCALHOST_PORTS || '5173,4173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  /** e.g. hris.example.com — allows https://acme.hris.example.com */
  CORS_SUBDOMAIN_HOST_SUFFIX: (process.env.CORS_SUBDOMAIN_HOST_SUFFIX || '').trim(),

  DB: {
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    ssl: process.env.DB_SSL === 'true',
  },

  JWT: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },

  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
  BCRYPT_SALT_ROUNDS: parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) || 12,

  UPLOAD: {
    // Default points inside src/ so that files written by multer match what
    // express.static serves under /uploads. Override via UPLOAD_DIR if needed.
    dir: process.env.UPLOAD_DIR || './src/uploads',
    maxSize: (parseInt(process.env.UPLOAD_MAX_SIZE_MB, 10) || 2) * 1024 * 1024,
  },

  RATE_LIMIT: {
    // General API limiter — applies to every (non-static, non-preflight) request,
    // per client IP. A data-rich SPA fires many calls per page load plus polling,
    // so this must be generous or normal users get blanket-429'd. 1000/15min/IP is
    // coarse abuse protection, not per-action throttling (auth/OTP have their own
    // strict limiters). Raise RATE_LIMIT_MAX further for offices behind a shared
    // NAT/proxy where many users share one public IP.
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000, // 900000 (15 min)
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 1000,
    // Auth endpoints (login) — counts only failed requests.
    authMax: parseInt(process.env.AUTH_RATE_LIMIT_MAX, 10) || 10,
    // OTP verification (verify-otp + reset-password) — counts every attempt.
    otpMax: parseInt(process.env.OTP_RATE_LIMIT_MAX, 10) || 10,
    // Public tenant self-registration.
    registrationWindowMs: parseInt(process.env.REGISTRATION_RATE_LIMIT_WINDOW_MS, 10) || 60 * 60 * 1000, // 3600000 (1 hour)
    registrationMax: parseInt(process.env.REGISTRATION_RATE_LIMIT_MAX, 10) || 5,
    // Token refresh — reuses the general window above.
    refreshMax: parseInt(process.env.REFRESH_RATE_LIMIT_MAX, 10) || 60,
    // Candidate onboarding portal (offer / sign / documents).
    candidateWindowMs: parseInt(process.env.CANDIDATE_RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000, // 900000 (15 min)
    candidateMax: parseInt(process.env.CANDIDATE_RATE_LIMIT_MAX, 10) || 150,
  },
  EXIT_TASK_DUE_DAYS: Math.max(1, parseInt(process.env.EXIT_TASK_DUE_DAYS, 10) || 7),
  DISABLE_RATE_LIMIT: process.env.DISABLE_RATE_LIMIT === 'true',
  // Express "trust proxy" setting. When the API runs behind a reverse proxy /
  // load balancer (nginx, Vercel, Render, Heroku, …) this MUST be set so the
  // rate limiter keys on the real client IP from X-Forwarded-For instead of the
  // proxy's single IP — otherwise every user shares one bucket and all of them
  // get throttled at once. Set TRUST_PROXY=1 for a single proxy hop. Leave unset
  // (false) for direct/local connections. Accepts a number, true/false, or a
  // subnet string (passed straight to app.set('trust proxy', ...)).
  TRUST_PROXY: (() => {
    const v = process.env.TRUST_PROXY;
    if (v === undefined || v === '') return false;
    if (v === 'true') return true;
    if (v === 'false') return false;
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
  })(),

  /**
   * Opt-in: include error stack traces in HTTP error responses.
   * Default OFF. Ignored entirely in production — traces are only ever
   * logged server-side there, never returned to clients.
   */
  EXPOSE_STACK: process.env.EXPOSE_STACK === 'true',

  SEED: {
    email: process.env.SEED_SUPERADMIN_EMAIL,
    password: process.env.SEED_SUPERADMIN_PASSWORD,
    name: process.env.SEED_SUPERADMIN_NAME,
  },
});

module.exports = env;










// 'use strict';

// const path = require('path');
// const dotenv = require('dotenv');

// // Always load .env from the project root (one level up from /src/config)
// dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

// const REQUIRED_KEYS = [
//   'DB_USER',
//   'DB_NAME',
//   'DB_HOST',
//   'JWT_SECRET',
//   'JWT_REFRESH_SECRET',
//   'ENCRYPTION_KEY',
// ];

// const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// const VALID_SMTP_ENCRYPTION = new Set(['tls', 'ssl', 'none']);

// /**
//  * Validate the SMTP/email environment variables.
//  *
//  * Email transport is OPTIONAL via .env — an org can configure SMTP at runtime
//  * under Settings → Email (stored in the DB), which the mailer prefers. So:
//  *  - If NO email vars are present, we only WARN (the app may rely on DB config).
//  *  - If ANY email vars ARE present, the operator clearly intends env-based SMTP,
//  *    so we validate them and FAIL FAST on anything missing or malformed.
//  *
//  * Mirrors the resolution in helpers/mailer/mailer.js: both EMAIL_* and MAIL_*
//  * names are accepted, and the host defaults to Gmail when only a user is given.
//  */
// function validateEmailEnv() {
//   const host = (process.env.EMAIL_HOST || process.env.MAIL_HOST || '').trim();
//   const user = (process.env.EMAIL_USER || process.env.MAIL_USER || '').trim();
//   const pass = (process.env.EMAIL_PASS || process.env.MAIL_PASS || '').trim();
//   const portRaw = (process.env.EMAIL_PORT || process.env.MAIL_PORT || '').trim();
//   const encRaw = (process.env.EMAIL_ENCRYPTION || process.env.MAIL_ENCRYPTION || '').trim();
//   const fromRaw = (process.env.EMAIL_FROM_ADDRESS || process.env.MAIL_FROM || '').trim();

//   const configured = Boolean(host || user || pass || portRaw || encRaw || fromRaw);
//   if (!configured) {
//     // eslint-disable-next-line no-console
//     console.warn(
//       '[env] No SMTP/email variables set (EMAIL_*/MAIL_*). Outbound email will ' +
//         'only work if SMTP is configured under Settings → Email; otherwise email ' +
//         'sending will fail. Set EMAIL_HOST/EMAIL_USER/EMAIL_PASS to enable it via .env.',
//     );
//     return;
//   }

//   const errors = [];

//   // Host: explicit host, or implicit Gmail default when a user is provided.
//   const effectiveHost = host || (user ? 'smtp.gmail.com' : '');
//   if (!effectiveHost) {
//     errors.push('SMTP host could not be determined — set EMAIL_HOST (or EMAIL_USER to default to Gmail).');
//   } else if (/\s/.test(effectiveHost)) {
//     errors.push(`EMAIL_HOST is malformed (contains whitespace): "${effectiveHost}".`);
//   }

//   // Auth must be supplied as a pair (hosts without auth, e.g. local MailHog, are allowed).
//   if (user && !pass) {
//     errors.push('EMAIL_USER is set but EMAIL_PASS (password) is missing.');
//   }
//   if (pass && !user) {
//     errors.push('EMAIL_PASS is set but EMAIL_USER (username) is missing.');
//   }

//   // Port: when provided, must be an integer in 1–65535.
//   if (portRaw) {
//     const port = Number(portRaw);
//     if (!Number.isInteger(port) || port < 1 || port > 65535) {
//       errors.push(`EMAIL_PORT must be an integer between 1 and 65535 (got "${portRaw}").`);
//     }
//   }

//   // Encryption: when provided, must be tls | ssl | none.
//   if (encRaw && !VALID_SMTP_ENCRYPTION.has(encRaw.toLowerCase())) {
//     errors.push(`EMAIL_ENCRYPTION must be one of tls, ssl, none (got "${encRaw}").`);
//   }

//   // From address: the effective sender (explicit from, else the username) must
//   // be a valid email — nodemailer/_fromHeader needs a real address to send.
//   const effectiveFrom = fromRaw || user;
//   if (!effectiveFrom) {
//     errors.push('No sender address — set EMAIL_FROM_ADDRESS (or EMAIL_USER).');
//   } else if (!EMAIL_RE.test(effectiveFrom)) {
//     errors.push(`Sender address is not a valid email: "${effectiveFrom}" — set a valid EMAIL_FROM_ADDRESS.`);
//   }

//   if (errors.length > 0) {
//     throw new Error(`[env] Invalid SMTP/email configuration:\n  - ${errors.join('\n  - ')}`);
//   }
// }

// function assertEnv() {
//   const missing = REQUIRED_KEYS.filter((k) => !process.env[k] || String(process.env[k]).trim() === '');
//   if (missing.length > 0) {
//     throw new Error(`[env] Missing required environment variables: ${missing.join(', ')}`);
//   }

//   if (String(process.env.JWT_SECRET).length < 64) {
//     throw new Error('[env] JWT_SECRET must be at least 64 characters long (hex)');
//   }
//   if (String(process.env.JWT_REFRESH_SECRET).length < 64) {
//     throw new Error('[env] JWT_REFRESH_SECRET must be at least 64 characters long (hex)');
//   }
//   if (String(process.env.ENCRYPTION_KEY).length !== 64) {
//     throw new Error('[env] ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
//   }

//   validateEmailEnv();
// }

// assertEnv();

// const env = Object.freeze({
//   NODE_ENV: process.env.NODE_ENV || 'development',
//   PORT: parseInt(process.env.PORT, 10) || 5000,

//   CORS_ORIGINS: (process.env.CORS_ORIGINS || '')
//     .split(',')
//     .map((s) => s.trim())
//     .filter(Boolean),

//   /** Allow http(s)://*.localhost:PORT (tenant workspace subdomains in dev) */
//   CORS_ALLOW_SUBDOMAIN_ORIGINS: process.env.CORS_ALLOW_SUBDOMAIN_ORIGINS !== 'false',

//   /** Dev only: allow any browser origin (cannot use with credentials + literal *) */
//   CORS_ALLOW_ALL: process.env.CORS_ALLOW_ALL === 'true',

//   /** Comma ports for *.localhost origins, e.g. 5173,4173 */
//   CORS_LOCALHOST_PORTS: (process.env.CORS_LOCALHOST_PORTS || '5173,4173')
//     .split(',')
//     .map((s) => s.trim())
//     .filter(Boolean),

//   /** e.g. hris.example.com — allows https://acme.hris.example.com */
//   CORS_SUBDOMAIN_HOST_SUFFIX: (process.env.CORS_SUBDOMAIN_HOST_SUFFIX || '').trim(),

//   DB: {
//     user: process.env.DB_USER,
//     password: process.env.DB_PASS,
//     database: process.env.DB_NAME,
//     host: process.env.DB_HOST,
//     port: parseInt(process.env.DB_PORT, 10) || 5432,
//     ssl: process.env.DB_SSL === 'true',
//   },

//   JWT: {
//     secret: process.env.JWT_SECRET,
//     expiresIn: process.env.JWT_EXPIRES_IN || '15m',
//     refreshSecret: process.env.JWT_REFRESH_SECRET,
//     refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
//   },

//   ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
//   BCRYPT_SALT_ROUNDS: parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) || 12,

//   UPLOAD: {
//     // Default points inside src/ so that files written by multer match what
//     // express.static serves under /uploads. Override via UPLOAD_DIR if needed.
//     dir: process.env.UPLOAD_DIR || './src/uploads',
//     maxSize: (parseInt(process.env.UPLOAD_MAX_SIZE_MB, 10) || 2) * 1024 * 1024,
//   },

//   RATE_LIMIT: {
//     // General API limiter — applies to every (non-static, non-preflight) request,
//     // per client IP. A data-rich SPA fires many calls per page load plus polling,
//     // so this must be generous or normal users get blanket-429'd. 1000/15min/IP is
//     // coarse abuse protection, not per-action throttling (auth/OTP have their own
//     // strict limiters). Raise RATE_LIMIT_MAX further for offices behind a shared
//     // NAT/proxy where many users share one public IP.
//     windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000, // 900000 (15 min)
//     max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 1000,
//     // Auth endpoints (login) — counts only failed requests.
//     authMax: parseInt(process.env.AUTH_RATE_LIMIT_MAX, 10) || 10,
//     // OTP verification (verify-otp + reset-password) — counts every attempt.
//     otpMax: parseInt(process.env.OTP_RATE_LIMIT_MAX, 10) || 10,
//     // Public tenant self-registration.
//     registrationWindowMs: parseInt(process.env.REGISTRATION_RATE_LIMIT_WINDOW_MS, 10) || 60 * 60 * 1000, // 3600000 (1 hour)
//     registrationMax: parseInt(process.env.REGISTRATION_RATE_LIMIT_MAX, 10) || 5,
//     // Token refresh — reuses the general window above.
//     refreshMax: parseInt(process.env.REFRESH_RATE_LIMIT_MAX, 10) || 60,
//     // Candidate onboarding portal (offer / sign / documents).
//     candidateWindowMs: parseInt(process.env.CANDIDATE_RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000, // 900000 (15 min)
//     candidateMax: parseInt(process.env.CANDIDATE_RATE_LIMIT_MAX, 10) || 150,
//   },
//   EXIT_TASK_DUE_DAYS: Math.max(1, parseInt(process.env.EXIT_TASK_DUE_DAYS, 10) || 7),
//   DISABLE_RATE_LIMIT: process.env.DISABLE_RATE_LIMIT === 'true',
//   // Express "trust proxy" setting. When the API runs behind a reverse proxy /
//   // load balancer (nginx, Vercel, Render, Heroku, …) this MUST be set so the
//   // rate limiter keys on the real client IP from X-Forwarded-For instead of the
//   // proxy's single IP — otherwise every user shares one bucket and all of them
//   // get throttled at once. Set TRUST_PROXY=1 for a single proxy hop. Leave unset
//   // (false) for direct/local connections. Accepts a number, true/false, or a
//   // subnet string (passed straight to app.set('trust proxy', ...)).
//   TRUST_PROXY: (() => {
//     const v = process.env.TRUST_PROXY;
//     if (v === undefined || v === '') return false;
//     if (v === 'true') return true;
//     if (v === 'false') return false;
//     const n = Number(v);
//     return Number.isFinite(n) ? n : v;
//   })(),

//   /**
//    * Opt-in: include error stack traces in HTTP error responses.
//    * Default OFF. Ignored entirely in production — traces are only ever
//    * logged server-side there, never returned to clients.
//    */
//   EXPOSE_STACK: process.env.EXPOSE_STACK === 'true',

//   SEED: {
//     email: process.env.SEED_SUPERADMIN_EMAIL,
//     password: process.env.SEED_SUPERADMIN_PASSWORD,
//     name: process.env.SEED_SUPERADMIN_NAME,
//   },
// });

// module.exports = env;
