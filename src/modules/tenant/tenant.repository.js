'use strict';

const db = require('../../config/db');

/**
 * Repository for tenant-related data access.
 * Splits queries that run on the public schema (registry) from those that
 * run inside a per-tenant schema (admin_users).
 *
 * IMPORTANT: schema names are validated by the service layer before being
 * interpolated into DDL statements (PG does not allow parameterized identifiers).
 */

const SCHEMA_NAME_RE = /^tenant_[a-z0-9_]+$/i;

function assertSafeSchemaName(schemaName) {
  if (typeof schemaName !== 'string' || !SCHEMA_NAME_RE.test(schemaName) || schemaName.length > 63) {
    throw new Error(`Unsafe or invalid schema name: ${schemaName}`);
  }
}

/* -------------------- public.tenants -------------------- */

async function findTenantByAdminEmail(adminEmail, client = db) {
  const sql = `
    SELECT id, name, schema_name, admin_email, status, created_by, created_at
    FROM public.tenants
    WHERE admin_email = $1
    LIMIT 1
  `;
  const { rows } = await client.query(sql, [adminEmail]);
  return rows[0] || null;
}

async function findTenantBySchemaName(schemaName, client = db) {
  const sql = `
    SELECT id, name, schema_name, admin_email, status, created_by, created_at
    FROM public.tenants
    WHERE schema_name = $1
    LIMIT 1
  `;
  const { rows } = await client.query(sql, [schemaName]);
  return rows[0] || null;
}

async function insertTenant({ name, schemaName, adminEmail, createdBy }, client = db) {
  const sql = `
    INSERT INTO public.tenants (name, schema_name, admin_email, status, created_by)
    VALUES ($1, $2, $3, 'active', $4)
    RETURNING id, name, schema_name, admin_email, status, created_by, created_at
  `;
  const { rows } = await client.query(sql, [name, schemaName, adminEmail, createdBy]);
  return rows[0];
}

/* -------------------- DDL: schema lifecycle -------------------- */

async function createSchema(schemaName, client) {
  assertSafeSchemaName(schemaName);
  // Identifier is validated above; pg does not support parameterized identifiers.
  await client.query(`CREATE SCHEMA "${schemaName}"`);
}

async function dropSchemaIfExists(schemaName, client = db) {
  assertSafeSchemaName(schemaName);
  await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
}

async function setSearchPath(schemaName, client) {
  assertSafeSchemaName(schemaName);
  await client.query(`SET search_path TO "${schemaName}", public`);
}

/* -------------------- per-tenant: admin_users -------------------- */

async function insertAdminUser(
  schemaName,
  { tenantId, email, passwordHash, name },
  client
) {
  assertSafeSchemaName(schemaName);
  const sql = `
    INSERT INTO "${schemaName}".admin_users (tenant_id, email, password_hash, name)
    VALUES ($1, $2, $3, $4)
    RETURNING id, tenant_id, email, name, status, created_at
  `;
  const { rows } = await client.query(sql, [tenantId, email, passwordHash, name]);
  return rows[0];
}

module.exports = {
  // public
  findTenantByAdminEmail,
  findTenantBySchemaName,
  insertTenant,
  // ddl
  createSchema,
  dropSchemaIfExists,
  setSearchPath,
  // per-tenant
  insertAdminUser,
  // internal helper exposed for tests / scripts
  _assertSafeSchemaName: assertSafeSchemaName,
};
