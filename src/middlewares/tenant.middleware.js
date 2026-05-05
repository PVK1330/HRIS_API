// src/middlewares/tenant.middleware.js
const { superadminPool } = require('../config/db');

/**
 * Resolve tenant from request and attach to context
 * Strategies: Subdomain, Header, or JWT claim
 */
async function tenantResolver(req, res, next) {
  try {
    let tenantIdentifier;

    // Strategy 1: Subdomain (e.g., acme.hriscloud.io)
    const host = req.headers.host;
    if (host && host.includes('.')) {
      const subdomain = host.split('.')[0];
      if (subdomain !== 'www' && subdomain !== 'api') {
        tenantIdentifier = subdomain;
      }
    }

    // Strategy 2: Header (X-Tenant-ID or X-Tenant-Domain)
    if (!tenantIdentifier) {
      tenantIdentifier = req.headers['x-tenant-id'] || req.headers['x-tenant-domain'];
    }

    // Strategy 3: JWT claim (if using JWT auth)
    if (!tenantIdentifier && req.user?.tenantId) {
      tenantIdentifier = req.user.tenantId;
    }

    if (!tenantIdentifier) {
      return res.status(400).json({ error: 'Tenant identifier not found' });
    }

    // Query tenant from superadmin database with timezone settings
    const result = await superadminPool.query(
      'SELECT id, schema_name, status, timezone, date_format, time_format FROM public.tenants WHERE schema_name = $1 OR admin_email = $1',
      [tenantIdentifier]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const tenant = result.rows[0];

    if (tenant.status !== 'active') {
      return res.status(403).json({ error: 'Tenant is not active' });
    }

    // Attach tenant to request with timezone configuration
    req.tenant = {
      id: tenant.id,
      schemaName: tenant.schema_name,
      identifier: tenantIdentifier,
      timezone: tenant.timezone || 'UTC',
      dateFormat: tenant.date_format || 'DD/MM/YYYY',
      timeFormat: tenant.time_format || '24h',
    };

    next();
  } catch (error) {
    console.error('Tenant resolution error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { tenantResolver };
