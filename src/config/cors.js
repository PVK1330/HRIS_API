'use strict';

const env = require('./env');

/**
 * @param {string|undefined} origin
 * @returns {boolean}
 */
function isOriginAllowed(origin) {
  if (!origin) return true;

  if (env.CORS_ALLOW_ALL) return true;

  if (env.CORS_ORIGINS.includes(origin)) return true;

  if (!env.CORS_ALLOW_SUBDOMAIN_ORIGINS) return false;

  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');

  /* Vite dev: http://tenant-slug.localhost:5173 and http://localhost:5173 */
  if (host === 'localhost' || host.endsWith('.localhost')) {
    const allowedPorts = env.CORS_LOCALHOST_PORTS;
    if (!allowedPorts.length) return true;
    return allowedPorts.includes(port);
  }

  /* Production: *.yourcompany.com from CORS_SUBDOMAIN_HOST_SUFFIX */
  const suffix = env.CORS_SUBDOMAIN_HOST_SUFFIX;
  if (suffix) {
    const s = suffix.toLowerCase();
    if (host === s || host.endsWith(`.${s}`)) return true;
  }

  return false;
}

function createCorsOptions() {
  return {
    origin(origin, callback) {
      if (isOriginAllowed(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS not allowed for origin: ${origin}`));
      }
    },
    credentials: true,
    optionsSuccessStatus: 200,
  };
}

function socketCorsOrigin(origin, callback) {
  if (isOriginAllowed(origin)) {
    callback(null, true);
  } else {
    callback(new Error(`CORS not allowed for origin: ${origin}`));
  }
}

module.exports = {
  isOriginAllowed,
  createCorsOptions,
  socketCorsOrigin,
};
