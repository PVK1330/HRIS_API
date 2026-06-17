"use strict";

const db = require("../../config/db");
const { isValidTenantDbName } = require("../../utils/tenantDbName");

function assertSafeDbName(dbName) {
  if (!isValidTenantDbName(dbName)) {
    throw new Error(`Unsafe or invalid tenant database name: ${dbName}`);
  }
}

async function reserveTenantId(client = db) {
  const { rows } = await client.query(
    `SELECT nextval(pg_get_serial_sequence('public.tenants', 'id'))::integer AS id`,
  );
  const id = rows[0]?.id;
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Failed to reserve tenant id");
  }
  return id;
}

let accessControlsSchemaPromise = null;
function ensureAccessControlsSchema() {
  if (!accessControlsSchemaPromise) {
    accessControlsSchemaPromise = db.query(`
      CREATE TABLE IF NOT EXISTS public.tenant_access_controls (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
        plan_id INTEGER NOT NULL REFERENCES public.subscription_plans(id),
        feature_id INTEGER NOT NULL REFERENCES public.platform_features(id),
        is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(tenant_id, feature_id)
      );
      CREATE INDEX IF NOT EXISTS idx_tenant_access_tenant_id ON public.tenant_access_controls(tenant_id);
    `).catch((err) => {
      accessControlsSchemaPromise = null;
      throw err;
    });
  }
  return accessControlsSchemaPromise;
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
  {
    id,
    name,
    dbName,
    adminEmail,
    adminName,
    createdBy,
    planId,
    trialEndsAt,
    subscriptionStatus = 'trial',
  },
  client = db,
) {
  const columns = [
    "name",
    "db_name",
    "admin_email",
    "admin_name",
    "company_name",
    "status",
    "created_by",
    "plan_id",
    "subscription_status",
    "trial_ends_at",
  ];
  const values = [
    name,
    dbName,
    adminEmail,
    adminName || null,
    null,
    "active",
    createdBy,
    planId || null,
    subscriptionStatus || "trial",
    trialEndsAt || null,
  ];

  if (id != null) {
    columns.unshift("id");
    values.unshift(id);
  }

  const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
  const sql = `
    INSERT INTO public.tenants (${columns.join(", ")})
    VALUES (${placeholders})
    RETURNING id, name, db_name, admin_email, status, created_by, created_at, plan_id, subscription_status, trial_ends_at
  `;
  const { rows } = await client.query(sql, values);
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

async function insertAccessControl(tenantId, planId, featureId, client = db) {
  await ensureAccessControlsSchema();
  const sql = `
    INSERT INTO public.tenant_access_controls (tenant_id, plan_id, feature_id)
    VALUES ($1, $2, $3)
    ON CONFLICT (tenant_id, feature_id) DO NOTHING
    RETURNING id
  `;
  const { rows } = await client.query(sql, [tenantId, planId, featureId]);
  return rows[0];
}

async function findAll({ limit = 10, offset = 0, search = '', plan = '', status = '' } = {}, client = db) {
  let query = `
    SELECT t.id, t.name, t.db_name, t.admin_email, t.status, t.created_by, t.created_at, t.slug,
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

async function findFeatureById(featureId, client = db) {
  const sql = `
    SELECT id, feature_name, feature_code, feature_description, feature_sort_order, feature_is_active
    FROM public.platform_features
    WHERE id = $1
    LIMIT 1
  `;
  const { rows } = await client.query(sql, [featureId]);
  return rows[0] || null;
}

async function listTenantFeatureAccess(tenantId, client = db) {
  await ensureAccessControlsSchema();
  const sql = `
    SELECT
      pf.id,
      pf.feature_name,
      pf.feature_code,
      pf.feature_description,
      pf.feature_sort_order,
      pf.feature_is_active,
      tac.id AS access_control_id,
      COALESCE(tac.is_enabled, false) AS is_enabled
    FROM public.platform_features pf
    LEFT JOIN public.tenant_access_controls tac
      ON tac.feature_id = pf.id
      AND tac.tenant_id = $1
    ORDER BY pf.feature_sort_order ASC, pf.feature_name ASC
  `;
  const { rows } = await client.query(sql, [tenantId]);
  return rows;
}

async function upsertTenantFeatureAccess(tenantId, featureId, isEnabled, client = db) {
  await ensureAccessControlsSchema();

  const tenantSql = `
    SELECT plan_id
    FROM public.tenants
    WHERE id = $1
    LIMIT 1
  `;
  const tenantResult = await client.query(tenantSql, [tenantId]);
  const planId = tenantResult.rows[0]?.plan_id || null;

  const sql = `
    INSERT INTO public.tenant_access_controls (tenant_id, plan_id, feature_id, is_enabled)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (tenant_id, feature_id)
    DO UPDATE
      SET is_enabled = EXCLUDED.is_enabled,
          plan_id = EXCLUDED.plan_id
    RETURNING id, tenant_id, plan_id, feature_id, is_enabled, created_at
  `;

  const { rows } = await client.query(sql, [tenantId, planId, featureId, isEnabled]);
  return rows[0] || null;
}

module.exports = {
  // public.tenants
  reserveTenantId,
  findTenantByAdminEmail,
  findTenantByDbName,
  findTenantById,
  insertTenant,
  deleteTenantByDbName,
  updateTenant,
  deleteTenantById,
  findAll,
  countAll,
  findFeatureById,
  listTenantFeatureAccess,
  upsertTenantFeatureAccess,
  // per-tenant
  insertAdminUser,
  updateAdminPassword,
  insertAccessControl,
  // helpers
  assertSafeDbName,
  _assertSafeDbName: assertSafeDbName,
};
