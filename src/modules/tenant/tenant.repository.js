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
  { name, dbName, adminEmail, adminName, createdBy, planId, trialEndsAt },
  client = db,
) {
  const sql = `
    INSERT INTO public.tenants (
      name, db_name, admin_email, admin_name, company_name, 
      status, created_by, plan_id, subscription_status, trial_ends_at
    )
    VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, 'trial', $8)
    RETURNING id, name, db_name, admin_email, status, created_by, created_at, plan_id, subscription_status, trial_ends_at
  `;
  const { rows } = await client.query(sql, [
    name,
    dbName,
    adminEmail,
    adminName || null,
    name, // using name as company_name too
    createdBy,
    planId || null,
    trialEndsAt || null,
  ]);
  return rows[0];
}

async function deleteTenantByDbName(dbName, client = db) {
  await client.query("DELETE FROM public.tenants WHERE db_name = $1", [dbName]);
}

async function updateTenant(id, { name, status, adminEmail }, client = db) {
  const sql = `
    UPDATE public.tenants
    SET name = COALESCE($1, name),
        status = COALESCE($2, status),
        admin_email = COALESCE($3, admin_email),
        updated_at = NOW()
    WHERE id = $4
    RETURNING *
  `;
  const { rows } = await client.query(sql, [name, status, adminEmail, id]);
  return rows[0];
}

async function deleteTenantById(id, client = db) {
  await client.query("DELETE FROM public.tenants WHERE id = $1", [id]);
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

async function updateAdminPassword(tenantPool, email, passwordHash) {
  const sql = `
    UPDATE admin_users
    SET password_hash = $1
    WHERE email = $2
    RETURNING id, email
  `;
  const { rows } = await tenantPool.query(sql, [passwordHash, email]);
  return rows[0];
}

async function findAll({ limit = 10, offset = 0, search = '', plan = '', status = '' } = {}, client = db) {
  let query = `
    SELECT t.id, t.name, t.db_name, t.admin_email, t.status, t.created_by, t.created_at,
           sp.plan_name as plan
    FROM public.tenants t
    LEFT JOIN public.tenant_subscriptions ts ON t.id = ts.tenant_id AND ts.status IN ('active', 'trial')
    LEFT JOIN public.subscription_plans sp ON ts.plan_id = sp.id
    WHERE 1=1
  `;
  const params = [];
  let paramIndex = 1;

  if (search) {
    query += ` AND (t.name ILIKE $${paramIndex} OR t.admin_email ILIKE $${paramIndex} OR t.db_name ILIKE $${paramIndex})`;
    params.push(`%${search}%`);
    paramIndex++;
  }

  if (plan && plan !== 'all') {
    query += ` AND sp.plan_name = $${paramIndex}`;
    params.push(plan);
    paramIndex++;
  }

  if (status && status !== 'all') {
    query += ` AND t.status = $${paramIndex}`;
    params.push(status.toLowerCase());
    paramIndex++;
  }

  query += ` ORDER BY t.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
  params.push(limit, offset);

  const { rows } = await client.query(query, params);
  return rows;
}

async function countAll({ search = '', plan = '', status = '' } = {}, client = db) {
  let query = `
    SELECT COUNT(*) as total 
    FROM public.tenants t
    LEFT JOIN public.tenant_subscriptions ts ON t.id = ts.tenant_id AND ts.status IN ('active', 'trial')
    LEFT JOIN public.subscription_plans sp ON ts.plan_id = sp.id
    WHERE 1=1
  `;
  const params = [];
  let paramIndex = 1;

  if (search) {
    query += ` AND (t.name ILIKE $${paramIndex} OR t.admin_email ILIKE $${paramIndex} OR t.db_name ILIKE $${paramIndex})`;
    params.push(`%${search}%`);
    paramIndex++;
  }

  if (plan && plan !== 'all') {
    query += ` AND sp.plan_name = $${paramIndex}`;
    params.push(plan);
    paramIndex++;
  }

  if (status && status !== 'all') {
    query += ` AND t.status = $${paramIndex}`;
    params.push(status.toLowerCase());
    paramIndex++;
  }

  const { rows } = await client.query(query, params);
  return parseInt(rows[0].total, 10);
}

module.exports = {
  // public.tenants
  findTenantByAdminEmail,
  findTenantByDbName,
  findTenantById,
  insertTenant,
  deleteTenantByDbName,
  updateTenant,
  deleteTenantById,
  findAll,
  countAll,
  // per-tenant
  insertAdminUser,
  updateAdminPassword,
  // helpers
  assertSafeDbName,
  _assertSafeDbName: assertSafeDbName,
};
