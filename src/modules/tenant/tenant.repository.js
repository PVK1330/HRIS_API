"use strict";

const db = require("../../config/db");

const DB_NAME_RE = /^tenant_[a-z0-9_]+$/i;

function assertSafeDbName(dbName) {
  if (
    typeof dbName !== "string" ||
    !DB_NAME_RE.test(dbName) ||
    dbName.length > 63
  ) {
    throw new Error(`Unsafe or invalid tenant database name: ${dbName}`);
  }
}

/* -------------------- public.tenants (in hrs_backend) -------------------- */

async function findTenantByAdminEmail(adminEmail, client = db) {
  const sql = `
    SELECT id, name, db_name, admin_email, status, created_by, created_at
    FROM public.tenants
    WHERE admin_email = $1
    LIMIT 1
  `;
  const { rows } = await client.query(sql, [adminEmail]);
  return rows[0] || null;
}

async function findTenantByDbName(dbName, client = db) {
  const sql = `
    SELECT id, name, db_name, admin_email, status, created_by, created_at
    FROM public.tenants
    WHERE db_name = $1
    LIMIT 1
  `;
  const { rows } = await client.query(sql, [dbName]);
  return rows[0] || null;
}

async function findTenantById(id, client = db) {
  const sql = `
    SELECT id, name, db_name, admin_email, status, created_by, created_at
    FROM public.tenants
    WHERE id = $1
    LIMIT 1
  `;
  const { rows } = await client.query(sql, [id]);
  return rows[0] || null;
}

async function insertTenant(
  { name, dbName, adminEmail, createdBy },
  client = db,
) {
  const sql = `
    INSERT INTO public.tenants (name, db_name, admin_email, status, created_by)
    VALUES ($1, $2, $3, 'active', $4)
    RETURNING id, name, db_name, admin_email, status, created_by, created_at
  `;
  const { rows } = await client.query(sql, [
    name,
    dbName,
    adminEmail,
    createdBy,
  ]);
  return rows[0];
}

async function deleteTenantByDbName(dbName, client = db) {
  await client.query("DELETE FROM public.tenants WHERE db_name = $1", [dbName]);
}

/* -------------------- per-tenant DB: admin_users -------------------- */

/**
 * Inserts an admin_users row inside the tenant's own database.
 * `tenantPool` must be obtained via db.getTenantPool(dbName).
 */
async function insertAdminUser(
  tenantPool,
  { tenantId, email, passwordHash, name },
) {
  const sql = `
    INSERT INTO admin_users (tenant_id, email, password_hash, name)
    VALUES ($1, $2, $3, $4)
    RETURNING id, tenant_id, email, name, status, created_at
  `;
  const { rows } = await tenantPool.query(sql, [
    tenantId,
    email,
    passwordHash,
    name,
  ]);
  return rows[0];
}

module.exports = {
  // public.tenants
  findTenantByAdminEmail,
  findTenantByDbName,
  findTenantById,
  insertTenant,
  deleteTenantByDbName,
  // per-tenant
  insertAdminUser,
  // helpers
  assertSafeDbName,
  _assertSafeDbName: assertSafeDbName,
};
