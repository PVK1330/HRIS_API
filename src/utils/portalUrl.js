'use strict';

const { superAdminPool } = require('../config/db');
const { slugifyTenantName } = require('./tenantSlug');

/**
 * Login URL for welcome / activation emails (tenant subdomain when known).
 * @param {{ tenant_id?: number }} user - JWT user
 */
async function resolvePortalLoginUrl(user) {
  const base = (
    process.env.PORTAL_URL ||
    process.env.FRONTEND_URL ||
    'http://localhost:5173'
  ).replace(/\/$/, '');

  let slug = null;
  if (user?.tenant_id) {
    try {
      const { rows } = await superAdminPool.query(
        'SELECT name FROM public.tenants WHERE id = $1 LIMIT 1',
        [user.tenant_id],
      );
      if (rows[0]?.name) slug = slugifyTenantName(rows[0].name);
    } catch {
      /* use base URL */
    }
  }

  if (!slug) return base;

  try {
    const u = new URL(base);
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1') {
      const port = u.port ? `:${u.port}` : ':5173';
      return `${u.protocol}//${slug}.localhost${port}/login`;
    }
    const parts = host.split('.');
    if (parts.length >= 2) {
      const root = parts.length > 2 ? parts.slice(-2).join('.') : host;
      u.hostname = `${slug}.${root}`;
      return `${u.origin}/login`;
    }
  } catch {
    /* fall through */
  }
  return base;
}

module.exports = { resolvePortalLoginUrl };
