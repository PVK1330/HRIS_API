'use strict';

const { superAdminPool } = require('../config/db');
const { slugifyTenantName } = require('./tenantSlug');

/**
 * Tenant portal origin (optionally with /login).
 * @param {number|{ tenant_id?: number }} tenantIdOrUser
 * @param {{ withLoginPath?: boolean }} opts
 */
async function resolvePortalOrigin(tenantIdOrUser, { withLoginPath = false } = {}) {
  const tenantId =
    typeof tenantIdOrUser === 'object'
      ? tenantIdOrUser?.tenant_id
      : tenantIdOrUser;

  const base = (
    process.env.PORTAL_URL ||
    process.env.FRONTEND_URL ||
    'http://localhost:5173'
  ).replace(/\/$/, '');

  let slug = null;
  if (tenantId) {
    try {
      const { rows } = await superAdminPool.query(
        'SELECT name FROM public.tenants WHERE id = $1 LIMIT 1',
        [tenantId],
      );
      if (rows[0]?.name) slug = slugifyTenantName(rows[0].name);
    } catch {
      /* use base URL */
    }
  }

  let origin = base;
  if (slug) {
    try {
      const u = new URL(base);
      const host = u.hostname.toLowerCase();
      if (host === 'localhost' || host === '127.0.0.1') {
        const port = u.port ? `:${u.port}` : ':5173';
        origin = `${u.protocol}//${slug}.localhost${port}`;
      } else {
        const parts = host.split('.');
        if (parts.length >= 2) {
          const root = parts.length > 2 ? parts.slice(-2).join('.') : host;
          u.hostname = `${slug}.${root}`;
          origin = u.origin;
        }
      }
    } catch {
      /* fall through */
    }
  }

  return withLoginPath ? `${origin.replace(/\/$/, '')}/login` : origin;
}

/** Login URL for welcome / activation emails (tenant subdomain when known). */
async function resolvePortalLoginUrl(user) {
  return resolvePortalOrigin(user, { withLoginPath: true });
}

module.exports = { resolvePortalLoginUrl, resolvePortalOrigin };
