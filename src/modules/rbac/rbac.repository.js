'use strict';

const { ACTION_TO_LEGACY_KEYS } = require('../../constants/permissions');

async function findAllPermissions(pool) {
  const { rows } = await pool.query(
    `SELECT id, key, label AS name, sort_order FROM rbac_permissions ORDER BY sort_order ASC, id ASC`,
  );
  return rows;
}

/** Expects raw feature_code from platform_features (any casing / symbols) */
function normalizeFeatureCode(code) {
  return String(code || '')
    .toLowerCase()
    .trim()
    .replace(/&/g, '_and_')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function buildFeatureCodeKeySet(enabledRows) {

  const codeToKeys = {
    employee_management: ['employee-directory', 'employee-profiles'],
    employee_directory: ['employee-directory', 'employee-profiles'],
    attendance_tracking: [
      'attendance',
      'time-tracking',
      'shift-management',
      'overtime-management',
    ],
    attendance: ['attendance'],
    leave_management: ['leave-absence'],
    leave: ['leave-absence'],
    document_management: ['documents-approval'],
    documents: ['documents-approval'],
    performance_management: ['performance'],
    performance_reviews: ['performance'],
    performance: ['performance'],
    onboarding: ['onboarding'],
    exit_management: ['exit-management'],
    onboarding_exit: ['onboarding', 'exit-management'],
    payroll: ['payroll-management'],
    payroll_management: ['payroll-management'],
    expense_management: ['expenses'],
    expenses: ['expenses'],
    billing_invoicing: ['billing-invoicing'],
    template_generation: ['letter-templates'],
    policies: ['policies'],
    reports_analytics: ['reports-analytics'],
    announcements: ['announcements'],
    asset_management: ['assets'],
    time_tracking: ['time-tracking'],
    shift_management: ['shift-management'],
    overtime_management: ['overtime-management'],
    training_development: ['training-development'],
    department: ['departments', 'designations'],
    departments: ['departments', 'designations'],
    designation: ['departments', 'designations'],
    designations: ['departments', 'designations'],
    visa_management: ['visa-nationality'],
    visa_nationality: ['visa-nationality'],
    visa_and_nationality: ['visa-nationality'],
    message_center: ['messages'],
    messages: ['messages'],
    projects: [],
    task_management: ['tasks'],
  };

  const codeSet = new Set(
    enabledRows.map((r) => normalizeFeatureCode(r.feature_code)).filter(Boolean),
  );

  const allowedKeys = new Set(['dashboard', 'system-settings']);
  codeSet.forEach((c) => {
    const keys = codeToKeys[c];
    if (keys && keys.length) keys.forEach((k) => allowedKeys.add(k));
  });
  return allowedKeys;
}

async function filterPermissionsByTenantPlan(superAdminPool, tenantId, allPermissions) {
  const { rows } = await superAdminPool.query(
    `
      SELECT pf.feature_code
      FROM public.tenant_access_controls tac
      JOIN public.platform_features pf ON pf.id = tac.feature_id
      WHERE tac.tenant_id = $1
        AND tac.is_enabled = TRUE
        AND pf.feature_is_active = TRUE
    `,
    [tenantId],
  );

  if (rows.length === 0 || !tenantId) {
    return allPermissions;
  }

  const keySet = buildFeatureCodeKeySet(rows);

  return allPermissions.filter((p) => {
    if (keySet.has(p.key)) return true;
    const legacyTargets = ACTION_TO_LEGACY_KEYS[p.key];
    if (legacyTargets && legacyTargets.some((l) => keySet.has(l))) return true;
    return false;
  });
}

async function findAllRoles(pool) {
  let rows;
  try {
    const result = await pool.query(`
      SELECT
        r.id, r.name, r.description, r.is_system,
        COALESCE(rds.scope, 'SELF') AS data_scope,
        COALESCE(
          json_agg(
            json_build_object('id', p.id, 'key', p.key, 'name', p.label)
            ORDER BY p.sort_order ASC, p.id ASC
          ) FILTER (WHERE p.id IS NOT NULL),
          '[]'::json
        ) AS permissions
      FROM rbac_roles r
      LEFT JOIN role_data_scopes rds ON rds.role_id = r.id
      LEFT JOIN rbac_role_permissions rp ON rp.role_id = r.id
      LEFT JOIN rbac_permissions p ON p.id = rp.permission_id
      GROUP BY r.id, rds.scope
      ORDER BY r.is_system DESC, LOWER(r.name) ASC
    `);
    rows = result.rows;
  } catch (_e) {
    const result = await pool.query(`
      SELECT
        r.id, r.name, r.description, r.is_system,
        'SELF' AS data_scope,
        COALESCE(
          json_agg(
            json_build_object('id', p.id, 'key', p.key, 'name', p.label)
            ORDER BY p.sort_order ASC, p.id ASC
          ) FILTER (WHERE p.id IS NOT NULL),
          '[]'::json
        ) AS permissions
      FROM rbac_roles r
      LEFT JOIN rbac_role_permissions rp ON rp.role_id = r.id
      LEFT JOIN rbac_permissions p ON p.id = rp.permission_id
      GROUP BY r.id
      ORDER BY r.is_system DESC, LOWER(r.name) ASC
    `);
    rows = result.rows;
  }
  return rows;
}

async function setRoleDataScope(pool, roleId, scope) {
  const normalized = String(scope || 'SELF').toUpperCase();
  const allowed = ['SELF', 'TEAM', 'DEPARTMENT', 'ALL'];
  if (!allowed.includes(normalized)) {
    throw new Error(`Invalid data scope: ${scope}`);
  }
  await pool.query(
    `INSERT INTO role_data_scopes (role_id, scope)
     VALUES ($1, $2)
     ON CONFLICT (role_id) DO UPDATE SET scope = EXCLUDED.scope`,
    [roleId, normalized],
  );
  return normalized;
}

async function getRoleDataScope(pool, roleId) {
  try {
    const { rows } = await pool.query(
      `SELECT scope FROM role_data_scopes WHERE role_id = $1 LIMIT 1`,
      [roleId],
    );
    return rows[0]?.scope || 'SELF';
  } catch (_e) {
    return 'SELF';
  }
}

async function insertRole(pool, { name, description, scope = 'SELF' }) {
  const { rows } = await pool.query(
    `INSERT INTO rbac_roles (name, description, is_system) VALUES ($1, $2, FALSE) RETURNING id, name, description, is_system`,
    [name.trim(), description || null],
  );
  const role = rows[0];
  if (role?.id) {
    try {
      await setRoleDataScope(pool, role.id, scope);
      role.data_scope = String(scope || 'SELF').toUpperCase();
    } catch (_e) {
      role.data_scope = 'SELF';
    }
  }
  return role;
}

async function updateRole(pool, id, { name, description }) {
  const { rows } = await pool.query(
    `UPDATE rbac_roles SET name = COALESCE($2, name), description = COALESCE($3, description), updated_at = NOW()
     WHERE id = $1 AND is_system = FALSE
     RETURNING id, name, description, is_system`,
    [id, name != null ? String(name).trim() : null, description ?? null],
  );
  return rows[0] || null;
}

async function deleteRole(pool, id) {
  const { rowCount } = await pool.query(
    `DELETE FROM rbac_roles WHERE id = $1 AND is_system = FALSE`,
    [id],
  );
  return rowCount > 0;
}

async function setRolePermissions(pool, roleId, permissionIds = []) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM rbac_role_permissions WHERE role_id = $1`, [roleId]);
    for (const pid of permissionIds) {
      if (pid != null && Number.isFinite(Number(pid))) {
        await client.query(
          `INSERT INTO rbac_role_permissions (role_id, permission_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [roleId, pid],
        );
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function permissionKeysForRole(pool, rbacRoleId) {
  if (rbacRoleId == null) return [];
  const { rows } = await pool.query(
    `SELECT p.key
     FROM rbac_role_permissions rp
     JOIN rbac_permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = $1
     ORDER BY p.sort_order ASC`,
    [rbacRoleId],
  );
  return rows.map((r) => r.key);
}

module.exports = {
  findAllPermissions,
  filterPermissionsByTenantPlan,
  findAllRoles,
  insertRole,
  updateRole,
  deleteRole,
  setRolePermissions,
  setRoleDataScope,
  getRoleDataScope,
  permissionKeysForRole,
};
