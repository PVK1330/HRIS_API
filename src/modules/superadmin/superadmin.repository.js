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
      ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS two_factor_secret TEXT,
      ADD COLUMN IF NOT EXISTS two_factor_pending_secret TEXT;
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
        audience VARCHAR(128) NOT NULL DEFAULT 'All Organisations',
        type VARCHAR(32) NOT NULL DEFAULT 'Info',
        sent_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        recipients INTEGER NOT NULL DEFAULT 48,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_superadmin_announcements_sent_date ON public.superadmin_announcements (sent_date DESC);

      CREATE TABLE IF NOT EXISTS public.superadmin_support_tickets (
        id BIGSERIAL PRIMARY KEY,
        ticket_code VARCHAR(32) UNIQUE NOT NULL,
        org_name VARCHAR(255) NOT NULL,
        subject VARCHAR(255) NOT NULL,
        priority VARCHAR(32) NOT NULL DEFAULT 'Medium',
        assigned_to VARCHAR(255),
        status VARCHAR(32) NOT NULL DEFAULT 'Open',
        description TEXT,
        messages JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_superadmin_support_tickets_status ON public.superadmin_support_tickets (status);
      CREATE INDEX IF NOT EXISTS idx_superadmin_support_tickets_created_at ON public.superadmin_support_tickets (created_at DESC);

      CREATE TABLE IF NOT EXISTS public.superadmin_audit_logs (
        id BIGSERIAL PRIMARY KEY,
        actor_name VARCHAR(255) NOT NULL,
        action VARCHAR(255) NOT NULL,
        target VARCHAR(255),
        ip_address VARCHAR(64),
        result VARCHAR(32) NOT NULL DEFAULT 'Success',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_superadmin_audit_logs_created_at ON public.superadmin_audit_logs (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_superadmin_audit_logs_action ON public.superadmin_audit_logs (action);
    `).catch((err) => {
      platformSchemaEnsurePromise = null;
      throw err;
    });
  }
  return platformSchemaEnsurePromise;
}

let rolesSchemaEnsurePromise = null;
function ensureRolesSchema() {
  if (!rolesSchemaEnsurePromise) {
    rolesSchemaEnsurePromise = db.query(`
      ALTER TABLE public.superadmin_roles
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
    `).catch((err) => {
      rolesSchemaEnsurePromise = null;
      throw err;
    });
  }
  return rolesSchemaEnsurePromise;
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
    SELECT id, email, name, role, status, last_login_at, two_factor_enabled, two_factor_secret, created_at
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

/* --- Two-factor (TOTP) enrollment state --- */

async function getMfaState(id) {
  await ensureSchema();
  const { rows } = await db.query(
    `SELECT id, email, name, two_factor_enabled, two_factor_secret, two_factor_pending_secret
     FROM public.superadmins WHERE id = $1 LIMIT 1`,
    [id],
  );
  return rows[0] || null;
}

async function setMfaPending(id, secret) {
  await ensureSchema();
  await db.query(
    `UPDATE public.superadmins SET two_factor_pending_secret = $1 WHERE id = $2`,
    [secret, id],
  );
}

async function enableMfa(id) {
  await ensureSchema();
  await db.query(
    `UPDATE public.superadmins
       SET two_factor_secret = two_factor_pending_secret,
           two_factor_pending_secret = NULL,
           two_factor_enabled = true
     WHERE id = $1`,
    [id],
  );
}

async function disableMfa(id) {
  await ensureSchema();
  await db.query(
    `UPDATE public.superadmins
       SET two_factor_secret = NULL,
           two_factor_pending_secret = NULL,
           two_factor_enabled = false
     WHERE id = $1`,
    [id],
  );
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

// Self-service profile for the logged-in superadmin / sub-admin.
async function getProfileById(id) {
  await ensureSchema();
  const sql = `
    SELECT id, email, name, role, status, last_login_at, created_at,
           COALESCE(two_factor_enabled, false) AS two_factor_enabled
    FROM public.superadmins
    WHERE id = $1
    LIMIT 1
  `;
  const { rows } = await db.query(sql, [id]);
  return rows[0] || null;
}

async function updateProfile(id, { name }) {
  await ensureSchema();
  const sql = `
    UPDATE public.superadmins
    SET name = COALESCE($1, name)
    WHERE id = $2
    RETURNING id, email, name, role, status, last_login_at, created_at,
              COALESCE(two_factor_enabled, false) AS two_factor_enabled
  `;
  const { rows } = await db.query(sql, [name, id]);
  return rows[0] || null;
}

async function listRoles() {
  await ensureRolesSchema();
  const sql = `
    SELECT id, role_key, role_name, description, permissions, is_system, is_active, created_at, updated_at
    FROM public.superadmin_roles
    ORDER BY is_system DESC, role_name ASC
  `;
  const { rows } = await db.query(sql);
  return rows;
}

async function createRole({ roleKey, roleName, description, permissions, isActive = true }) {
  await ensureRolesSchema();
  const sql = `
    INSERT INTO public.superadmin_roles (role_key, role_name, description, permissions, is_system, is_active)
    VALUES ($1, $2, $3, $4::jsonb, false, $5)
    RETURNING id, role_key, role_name, description, permissions, is_system, is_active, created_at, updated_at
  `;
  const { rows } = await db.query(sql, [roleKey, roleName, description || null, JSON.stringify(permissions || {}), isActive]);
  return rows[0];
}

async function updateRole(roleKey, { roleName, description, permissions, isActive }) {
  await ensureRolesSchema();
  const sql = `
    UPDATE public.superadmin_roles
    SET
      role_name = COALESCE($1, role_name),
      description = COALESCE($2, description),
      permissions = COALESCE($3::jsonb, permissions),
      is_active = COALESCE($4, is_active),
      updated_at = NOW()
    WHERE role_key = $5
    RETURNING id, role_key, role_name, description, permissions, is_system, is_active, created_at, updated_at
  `;
  const jsonPermissions = permissions == null ? null : JSON.stringify(permissions);
  const { rows } = await db.query(sql, [roleName, description, jsonPermissions, isActive, roleKey]);
  return rows[0] || null;
}

async function deleteRole(roleKey) {
  const sql = `
    DELETE FROM public.superadmin_roles
    WHERE role_key = $1 AND is_system = false
  `;
  const result = await db.query(sql, [roleKey]);
  return result.rowCount > 0;
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

async function listAnnouncementRecipients(audience) {
  await ensurePlatformSchema();

  let filterClause = '';
  const params = [];

  if (audience === 'Trial Only') {
    filterClause = ` AND ts.status = 'trial'`;
  } else if (audience === 'Enterprise Only') {
    filterClause = ` AND sp.plan_name ILIKE 'enterprise'`;
  }

  const sql = `
    SELECT DISTINCT t.id, t.name, t.admin_email, t.db_name
    FROM public.tenants t
    LEFT JOIN public.tenant_subscriptions ts
      ON ts.tenant_id = t.id
      AND ts.status IN ('active', 'trial')
    LEFT JOIN public.subscription_plans sp
      ON sp.id = ts.plan_id
    WHERE t.admin_email IS NOT NULL
      AND TRIM(t.admin_email) <> ''
      AND t.status <> 'suspended'
      ${filterClause}
    ORDER BY t.id DESC
  `;

  const { rows } = await db.query(sql, params);
  return rows;
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

async function listSupportTickets() {
  await ensurePlatformSchema();
  const seedSql = `
    INSERT INTO public.superadmin_support_tickets (ticket_code, org_name, subject, priority, assigned_to, status, description, messages)
    SELECT
      'TKT-' || LPAD((ROW_NUMBER() OVER (ORDER BY t.id) + 1000)::text, 4, '0'),
      t.name,
      'General support request',
      'Medium',
      NULL,
      'Open',
      'Auto-generated starter ticket for support workflow setup.',
      '[]'::jsonb
    FROM public.tenants t
    WHERE NOT EXISTS (SELECT 1 FROM public.superadmin_support_tickets)
    ORDER BY t.id DESC
    LIMIT 5
  `;
  await db.query(seedSql);

  const sql = `
    SELECT id, ticket_code, org_name, subject, priority, assigned_to, status, description, messages, created_at, updated_at
    FROM public.superadmin_support_tickets
    ORDER BY created_at DESC
  `;
  const { rows } = await db.query(sql);
  return rows;
}

async function updateSupportTicket(id, { assignedTo, status }) {
  await ensurePlatformSchema();
  const sql = `
    UPDATE public.superadmin_support_tickets
    SET
      assigned_to = COALESCE($1, assigned_to),
      status = COALESCE($2, status),
      updated_at = NOW()
    WHERE id = $3
    RETURNING id, ticket_code, org_name, subject, priority, assigned_to, status, description, messages, created_at, updated_at
  `;
  const { rows } = await db.query(sql, [assignedTo, status, id]);
  return rows[0] || null;
}

async function appendSupportTicketMessage(id, message) {
  await ensurePlatformSchema();
  const sql = `
    UPDATE public.superadmin_support_tickets
    SET
      messages = COALESCE(messages, '[]'::jsonb) || $1::jsonb,
      status = 'In Progress',
      updated_at = NOW()
    WHERE id = $2
    RETURNING id, ticket_code, org_name, subject, priority, assigned_to, status, description, messages, created_at, updated_at
  `;
  const payload = JSON.stringify([message]);
  const { rows } = await db.query(sql, [payload, id]);
  return rows[0] || null;
}

async function createAuditLog({ actorName, action, target, ipAddress, result = 'Success', metadata = {} }) {
  await ensurePlatformSchema();
  const sql = `
    INSERT INTO public.superadmin_audit_logs (actor_name, action, target, ip_address, result, metadata)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    RETURNING id, actor_name, action, target, ip_address, result, metadata, created_at
  `;
  const { rows } = await db.query(sql, [actorName, action, target || null, ipAddress || null, result, JSON.stringify(metadata)]);
  return rows[0];
}

async function listAuditLogs() {
  await ensurePlatformSchema();
  const sql = `
    SELECT id, actor_name, action, target, ip_address, result, metadata, created_at
    FROM public.superadmin_audit_logs
    ORDER BY created_at DESC
    LIMIT 500
  `;
  const { rows } = await db.query(sql);
  return rows;
}

module.exports = {
  findByEmail,
  findById,
  create,
  touchLastLogin,
  getMfaState,
  setMfaPending,
  enableMfa,
  disableMfa,
  listAdminUsers,
  createAdminUser,
  updateAdminUser,
  getProfileById,
  updateProfile,
  listRoles,
  createRole,
  updateRole,
  listModules,
  updateModule,
  listAnnouncements,
  listAnnouncementRecipients,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  listSupportTickets,
  updateSupportTicket,
  appendSupportTicketMessage,
  createAuditLog,
  listAuditLogs,
};
