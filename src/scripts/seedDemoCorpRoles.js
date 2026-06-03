'use strict';

/**
 * Configure role-appropriate RBAC for the Demo Corp test org (idempotent).
 *
 * Fixes:
 *  - Employee no longer sees the full employee directory (SELF data scope, profile-only).
 *  - Each role gets a sensible module set so its dashboard has relevant content.
 *  - 'exit-management' is granted to all roles for MODULE VISIBILITY only; it no longer
 *    confers org-wide exit-admin (that is now role-based: only the tenant Org Admin).
 *
 * Run:  npm run seed:demo:roles
 */

require('dotenv').config();
const db = require('../config/db');

const DB_NAME = process.argv[2] || 'hris_demo_corp_7';

// scope: SELF | TEAM | DEPARTMENT | ALL
const ROLE_CONFIG = {
  Employee: {
    scope: 'SELF',
    perms: [
      'dashboard', 'employee-profiles',
      'leave-absence', 'leave.apply', 'leave.view',
      'attendance.view', 'time-tracking',
      'attendance.view.own', 'attendance.create', 'attendance.regularization.request',
      'payroll.view',
      'policies', 'policies.view', 'policies.acknowledge',
      'document.view', 'messages', 'messages.view', 'exit-management',
    ],
  },
  'Department Head': {
    scope: 'DEPARTMENT',
    perms: [
      'dashboard', 'employee-directory', 'employee.view', 'employee-profiles',
      'leave-absence', 'leave.apply', 'leave.view', 'leave.approve',
      'attendance', 'attendance.view', 'time-tracking', 'overtime-management', 'shift-management',
      'attendance.view.own', 'attendance.view.team', 'attendance.create', 'attendance.update',
      'attendance.regularization.request', 'attendance.approve', 'attendance.reject',
      'performance', 'performance.view',
      'policies', 'policies.view', 'policies.acknowledge',
      'document.view', 'announcements', 'reports-analytics',
      'messages', 'messages.view', 'exit-management',
    ],
  },
  'HR Admin': {
    scope: 'ALL',
    perms: [
      'dashboard', 'employee-directory', 'employee-profiles',
      'employee.view', 'employee.create', 'employee.edit', 'employee.delete',
      'departments', 'departments.manage', 'onboarding',
      'leave-absence', 'leave.apply', 'leave.view', 'leave.approve',
      'attendance', 'attendance.view', 'time-tracking', 'overtime-management', 'shift-management',
      'attendance.view.own', 'attendance.view.team', 'attendance.view.all',
      'attendance.create', 'attendance.update', 'attendance.regularization.request',
      'attendance.approve', 'attendance.reject', 'attendance.manage',
      'attendance.settings.view', 'attendance.settings.manage',
      'performance', 'performance.view', 'payroll-management', 'payroll.view', 'expenses',
      'policies', 'policies.view', 'policies.manage', 'policies.acknowledge',
      'document.view', 'document.upload', 'documents-approval', 'letter-templates',
      'announcements', 'training-development', 'visa-nationality', 'visa.view', 'visa.manage',
      'reports-analytics', 'messages', 'messages.view', 'system-settings', 'exit-management',
    ],
  },
  'Finance Head': {
    scope: 'ALL',
    perms: [
      'dashboard', 'employee-directory', 'employee.view', 'employee-profiles',
      'payroll-management', 'payroll.view', 'expenses', 'billing-invoicing', 'reports-analytics',
      'leave.view', 'policies', 'policies.view', 'document.view',
      'messages', 'messages.view', 'exit-management',
    ],
  },
  'IT Head': {
    scope: 'ALL',
    perms: [
      'dashboard', 'employee-directory', 'employee.view', 'employee-profiles',
      'assets', 'assets.view', 'document.view', 'document.upload',
      'policies', 'policies.view', 'announcements',
      'messages', 'messages.view', 'exit-management',
    ],
  },
};

async function run() {
  await db.assertDbConnection();
  const pool = db.getTenantPool(DB_NAME);

  // permission key -> id
  const { rows: permRows } = await pool.query('SELECT id, key FROM rbac_permissions');
  const permId = new Map(permRows.map((r) => [r.key, r.id]));

  for (const [roleName, cfg] of Object.entries(ROLE_CONFIG)) {
    const { rows: rRows } = await pool.query('SELECT id FROM rbac_roles WHERE name = $1', [roleName]);
    if (!rRows.length) { console.log(`  ! role "${roleName}" not found, skipping`); continue; }
    const roleId = rRows[0].id;

    // reset + re-grant permissions
    await pool.query('DELETE FROM rbac_role_permissions WHERE role_id = $1', [roleId]);
    const ids = cfg.perms.map((k) => permId.get(k)).filter(Boolean);
    const missing = cfg.perms.filter((k) => !permId.has(k));
    for (const pid of ids) {
      await pool.query(
        'INSERT INTO rbac_role_permissions (role_id, permission_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [roleId, pid],
      );
    }

    // set data scope (delete + insert; no assumption about a unique constraint)
    await pool.query('DELETE FROM role_data_scopes WHERE role_id = $1', [roleId]);
    await pool.query('INSERT INTO role_data_scopes (role_id, scope) VALUES ($1,$2)', [roleId, cfg.scope]);

    console.log(`  ${roleName.padEnd(16)} scope=${cfg.scope.padEnd(10)} ${ids.length} perms${missing.length ? `  (missing keys: ${missing.join(',')})` : ''}`);
  }

  console.log('\nDemo Corp role access configured.');
}

if (require.main === module) {
  run()
    .then(() => { try { db.pool.end(); } catch (_) {} process.exit(0); })
    .catch((err) => { console.error('seed:demo:roles failed:', err.message); try { db.pool.end(); } catch (_) {} process.exit(1); });
}

module.exports = { run };
