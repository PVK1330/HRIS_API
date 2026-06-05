'use strict';

const { superAdminPool } = require('../config/db');
const ApiError = require('../utils/ApiError');

const TENANT_ID_RE = /^[a-z0-9_.-]{1,100}$/i;

async function tenantResolver(req, _res, next) {
  try {
    let tenantIdentifier;

    // SECURITY: For an authenticated, non-superadmin caller the tenant is derived
    // STRICTLY from the verified JWT. Client-supplied host/header inputs are NOT
    // trusted here — otherwise a tenant admin could target another tenant by sending
    // an x-tenant-id / x-tenant-domain header (cross-tenant read/write). Superadmins
    // are cross-tenant by design and fall through to the host/header strategies.
    const isAuthedTenantUser = req.user && req.user.role !== 'superadmin';
    if (isAuthedTenantUser && req.user.tenant_id) {
      tenantIdentifier = req.user.tenant_id;
    }

    // Strategy 1: Subdomain (incl. org.localhost for Vite dev)
    if (!tenantIdentifier) {
      const host = (req.headers.host || '').split(':')[0];
      if (host.includes('.')) {
        const parts = host.split('.').filter(Boolean);
        const last = parts[parts.length - 1];
        const isLocalDev = last === 'localhost' || last === '127.0.0.1';
        if (isLocalDev && parts.length >= 2) {
          const subdomain = parts[0];
          if (subdomain && subdomain !== 'www' && subdomain !== 'api') {
            tenantIdentifier = subdomain;
          }
        } else if (parts.length > 2) {
          const subdomain = parts[0];
          if (subdomain && subdomain !== 'www' && subdomain !== 'api') {
            tenantIdentifier = subdomain;
          }
        }
      }
    }

    // Strategy 2: Header (only reached for unauthenticated / superadmin requests)
    if (!tenantIdentifier) {
      tenantIdentifier = req.headers['x-tenant-id'] || req.headers['x-tenant-domain'];
    }

    // Strategy 3: JWT claim fallback (e.g. superadmin acting on their own tenant_id)
    if (!tenantIdentifier && req.user?.tenant_id) {
      tenantIdentifier = req.user.tenant_id;
    }

    // Allow superadmin to pass without tenant context (they query all tenants)
    if (!tenantIdentifier) {
      if (req.user?.role === 'superadmin') {
        console.log('[TENANT RESOLVER] Superadmin request without specific tenant context - allowed to proceed');
        return next();
      }
      return next(new ApiError(401, 'Tenant context missing'));
    }

    // Validate format before querying
    if (!TENANT_ID_RE.test(tenantIdentifier)) {
      return next(new ApiError(400, 'Invalid tenant identifier format'));
    }

    let rows;
    const slugNorm = String(tenantIdentifier)
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w-]+/g, '')
      .replace(/--+/g, '-')
      .replace(/^-|-$/g, '');

    const byKey = await superAdminPool.query(
      `SELECT id, db_name, schema_name, status, timezone, date_format, time_format, admin_email, name
       FROM public.tenants
       WHERE schema_name = $1
          OR admin_email = $1
          OR id::text = $1
       LIMIT 1`,
      [tenantIdentifier],
    );
    rows = byKey.rows;
    if (!rows.length && slugNorm) {
      const all = await superAdminPool.query(
        `SELECT id, db_name, schema_name, status, timezone, date_format, time_format, admin_email, name
         FROM public.tenants`,
      );
      const match = all.rows.find((t) => {
        const n = String(t.name || '')
          .toLowerCase()
          .trim()
          .replace(/\s+/g, '-')
          .replace(/[^\w-]+/g, '')
          .replace(/--+/g, '-')
          .replace(/^-|-$/g, '');
        return n === slugNorm;
      });
      if (match) rows = [match];
    }

    if (!rows.length) return next(new ApiError(404, 'Tenant not found'));
    const tenant = rows[0];
    if (tenant.status !== 'active') return next(new ApiError(403, 'Tenant account is not active'));

    req.tenant = {
      id: tenant.id,
      name: tenant.name,
      adminEmail: tenant.admin_email,
      dbName: tenant.db_name,       // used by getTenantPool()
      schemaName: tenant.schema_name,
      timezone: tenant.timezone || 'UTC',
      dateFormat: tenant.date_format || 'DD/MM/YYYY',
      timeFormat: tenant.time_format || '24h',
    };

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { tenantResolver };
