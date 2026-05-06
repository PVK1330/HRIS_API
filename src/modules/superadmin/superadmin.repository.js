'use strict';

const db = require('../../config/db');

/**
 * Repository: pure data-access functions for the public.superadmins table.
 * No business logic here — only parameterized SQL.
 */

let schemaEnsurePromise = null;
let platformSchemaEnsurePromise = null;

function ensureSchema() {
  if (!schemaEnsurePromise) {
    schemaEnsurePromise = db.query(`
      ALTER TABLE public.superadmins
      ADD COLUMN IF NOT EXISTS role VARCHAR(64) NOT NULL DEFAULT 'superadmin',
      ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'active',
      ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
    `).catch((err) => {
      schemaEnsurePromise = null;
      throw err;
    });
  }
  return schemaEnsurePromise;
}

function ensurePlatformSchema() {
  if (!platformSchemaEnsurePromise) {
    platformSchemaEnsurePromise = db.query(`
      CREATE TABLE IF NOT EXISTS public.superadmin_modules (
        id SERIAL PRIMARY KEY,
        module_key VARCHAR(64) UNIQUE NOT NULL,
        module_name VARCHAR(128) NOT NULL,
        description TEXT,
        tier VARCHAR(32),
        is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        scope VARCHAR(32) NOT NULL DEFAULT 'global',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_superadmin_modules_scope ON public.superadmin_modules (scope);
      CREATE INDEX IF NOT EXISTS idx_superadmin_modules_key ON public.superadmin_modules (module_key);

      INSERT INTO public.superadmin_modules (module_key, module_name, description, tier, is_enabled, scope)
      VALUES
      ('employee_directory', 'Employee Directory', 'Core human resource directory and profile management.', 'Essential', TRUE, 'global'),
      ('attendance', 'Attendance & Timesheet', 'Real-time clock-in/out and automated timesheet generation.', 'Essential', TRUE, 'global'),
      ('leave', 'Leave Management', 'Policy-based leave requests and approval workflows.', 'Essential', TRUE, 'global'),
      ('payroll', 'Payroll & Salary', 'Automated salary calculation and pay slip generation.', 'Advanced', TRUE, 'global'),
      ('performance', 'Performance Management', 'KPI tracking, appraisal cycles, and feedback loops.', 'Strategic', TRUE, 'global'),
      ('onboarding_exit', 'Onboarding & Exit', 'Structured workflows for employee lifecycle transitions.', 'Strategic', TRUE, 'global'),
      ('api', 'Advanced API access', 'Secure GraphQL/REST endpoints for third-party integration.', 'Enterprise', TRUE, 'global'),
      ('visa', 'Visa & Nationality', NULL, NULL, TRUE, 'organization'),
      ('expenses', 'Expense Management', NULL, NULL, TRUE, 'organization'),
      ('asset_management', 'Asset Inventory', NULL, NULL, FALSE, 'organization'),
      ('api_override', 'Infrastructure API Override', NULL, NULL, FALSE, 'organization')
      ON CONFLICT (module_key) DO UPDATE
      SET
        module_name = EXCLUDED.module_name,
        description = EXCLUDED.description,
        tier = EXCLUDED.tier,
        is_enabled = EXCLUDED.is_enabled,
        scope = EXCLUDED.scope,
        updated_at = NOW();

      CREATE TABLE IF NOT EXISTS public.superadmin_announcements (
        id BIGSERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        audience VARCHAR(128) NOT NULL DEFAULT 'All Organizations',
        type VARCHAR(32) NOT NULL DEFAULT 'Info',
        sent_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        recipients INTEGER NOT NULL DEFAULT 48,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_superadmin_announcements_sent_date ON public.superadmin_announcements (sent_date DESC);
    `).catch((err) => {
      platformSchemaEnsurePromise = null;
      throw err;
    });
  }
  return platformSchemaEnsurePromise;
}

async function findByEmail(email) {
  await ensureSchema();
  const sql = `
    SELECT id, email, password_hash, name, role, status, last_login_at, two_factor_enabled, two_factor_secret, created_at
    FROM public.superadmins
    WHERE email = $1
    LIMIT 1
  `;
  const { rows } = await db.query(sql, [email]);
  return rows[0] || null;
}

async function findById(id) {
  await ensureSchema();
  const sql = `
    SELECT id, email, name, role, status, last_login_at, two_factor_secret, created_at
    FROM public.superadmins
    WHERE id = $1
    LIMIT 1
  `;
  const { rows } = await db.query(sql, [id]);
  return rows[0] || null;
}

async function create({ email, passwordHash, name }) {
  await ensureSchema();
  const sql = `
    INSERT INTO public.superadmins (email, password_hash, name)
    VALUES ($1, $2, $3)
    RETURNING id, email, name, role, status, created_at
  `;
  const { rows } = await db.query(sql, [email, passwordHash, name]);
  return rows[0];
}

async function touchLastLogin(id) {
  await ensureSchema();
  const sql = `
    UPDATE public.superadmins
    SET last_login_at = NOW()
    WHERE id = $1
  `;
  await db.query(sql, [id]);
}

async function listAdminUsers() {
  await ensureSchema();
  const sql = `
    SELECT id, name, email, role, status, last_login_at, created_at
    FROM public.superadmins
    ORDER BY created_at DESC
  `;
  const { rows } = await db.query(sql);
  return rows;
}

async function createAdminUser({ name, email, passwordHash, role, status }) {
  await ensureSchema();
  const sql = `
    INSERT INTO public.superadmins (name, email, password_hash, role, status)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, name, email, role, status, last_login_at, created_at
  `;
  const { rows } = await db.query(sql, [name, email, passwordHash, role, status]);
  return rows[0];
}

async function updateAdminUser(id, { name, role, status }) {
  await ensureSchema();
  const sql = `
    UPDATE public.superadmins
    SET
      name = COALESCE($1, name),
      role = COALESCE($2, role),
      status = COALESCE($3, status)
    WHERE id = $4
    RETURNING id, name, email, role, status, last_login_at, created_at
  `;
  const { rows } = await db.query(sql, [name, role, status, id]);
  return rows[0] || null;
}

async function listRoles() {
  const sql = `
    SELECT id, role_key, role_name, description, permissions, is_system, created_at, updated_at
    FROM public.superadmin_roles
    ORDER BY is_system DESC, role_name ASC
  `;
  const { rows } = await db.query(sql);
  return rows;
}

async function createRole({ roleKey, roleName, description, permissions }) {
  const sql = `
    INSERT INTO public.superadmin_roles (role_key, role_name, description, permissions, is_system)
    VALUES ($1, $2, $3, $4::jsonb, false)
    RETURNING id, role_key, role_name, description, permissions, is_system, created_at, updated_at
  `;
  const { rows } = await db.query(sql, [roleKey, roleName, description || null, JSON.stringify(permissions || {})]);
  return rows[0];
}

async function updateRole(roleKey, { roleName, description, permissions }) {
  const sql = `
    UPDATE public.superadmin_roles
    SET
      role_name = COALESCE($1, role_name),
      description = COALESCE($2, description),
      permissions = COALESCE($3::jsonb, permissions),
      updated_at = NOW()
    WHERE role_key = $4
    RETURNING id, role_key, role_name, description, permissions, is_system, created_at, updated_at
  `;
  const jsonPermissions = permissions == null ? null : JSON.stringify(permissions);
  const { rows } = await db.query(sql, [roleName, description, jsonPermissions, roleKey]);
  return rows[0] || null;
}

async function listModules() {
  await ensurePlatformSchema();
  const sql = `
    SELECT id, module_key, module_name, description, tier, is_enabled, scope, created_at, updated_at
    FROM public.superadmin_modules
    ORDER BY scope ASC, module_name ASC
  `;
  const { rows } = await db.query(sql);
  return rows;
}

async function updateModule(moduleKey, { isEnabled }) {
  await ensurePlatformSchema();
  const sql = `
    UPDATE public.superadmin_modules
    SET
      is_enabled = $1,
      updated_at = NOW()
    WHERE module_key = $2
    RETURNING id, module_key, module_name, description, tier, is_enabled, scope, created_at, updated_at
  `;
  const { rows } = await db.query(sql, [isEnabled, moduleKey]);
  return rows[0] || null;
}

async function listAnnouncements() {
  await ensurePlatformSchema();
  const sql = `
    SELECT id, title, message, audience, type, sent_date, recipients, created_at, updated_at
    FROM public.superadmin_announcements
    ORDER BY created_at DESC
  `;
  const { rows } = await db.query(sql);
  return rows;
}

async function createAnnouncement({ title, message, audience, type, recipients }) {
  await ensurePlatformSchema();
  const sql = `
    INSERT INTO public.superadmin_announcements (title, message, audience, type, sent_date, recipients)
    VALUES ($1, $2, $3, $4, NOW(), $5)
    RETURNING id, title, message, audience, type, sent_date, recipients, created_at, updated_at
  `;
  const { rows } = await db.query(sql, [title, message, audience, type, recipients]);
  return rows[0];
}

async function updateAnnouncement(id, { title, message, audience, type }) {
  await ensurePlatformSchema();
  const sql = `
    UPDATE public.superadmin_announcements
    SET
      title = COALESCE($1, title),
      message = COALESCE($2, message),
      audience = COALESCE($3, audience),
      type = COALESCE($4, type),
      updated_at = NOW()
    WHERE id = $5
    RETURNING id, title, message, audience, type, sent_date, recipients, created_at, updated_at
  `;
  const { rows } = await db.query(sql, [title, message, audience, type, id]);
  return rows[0] || null;
}

async function deleteAnnouncement(id) {
  await ensurePlatformSchema();
  const sql = `
    DELETE FROM public.superadmin_announcements
    WHERE id = $1
  `;
  const result = await db.query(sql, [id]);
  return result.rowCount > 0;
}

module.exports = {
  findByEmail,
  findById,
  create,
  touchLastLogin,
  listAdminUsers,
  createAdminUser,
  updateAdminUser,
  listRoles,
  createRole,
  updateRole,
  listModules,
  updateModule,
  listAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
};
