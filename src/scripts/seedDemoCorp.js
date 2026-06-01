'use strict';

/**
 * Seed the "Demo Corp" test organization for Exit Management verification.
 *
 * Provisions (idempotent / re-runnable):
 *   1. Tenant "Demo Corp" via the standard tenant.service.createTenant flow
 *      (creates the DB, runs tenant migrations, creates the admin_users admin).
 *   2. 4 departments: Engineering, HR, Finance, IT.
 *   3. 5 RBAC roles: Employee, Department Head, HR Admin, Finance Head, IT Head
 *      (each granted the permission keys needed to log in and use Exit Management).
 *   4. 5 portal employees mapped to department + role:
 *        employee@demo.com   Employee         Engineering
 *        depthead@demo.com   Department Head  Engineering
 *        hr@demo.com         HR Admin         HR
 *        finance@demo.com    Finance Head     Finance
 *        it@demo.com         IT Head          IT
 *      All passwords: Demo@123
 *   Plus an org admin login: admin@demo.com / Demo@123 (admin_users).
 *
 * Run:  npm run seed:demo
 */

const bcrypt = require('bcrypt');
const db = require('../config/db');
const logger = require('../utils/logger');
const tenantService = require('../modules/tenant/tenant.service');
const tenantRepo = require('../modules/tenant/tenant.repository');

const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) || 12;

const ORG_NAME = 'Demo Corp';
const ADMIN_EMAIL = 'admin@demo.com';
const ADMIN_NAME = 'Demo Corp Admin';
const PASSWORD = 'Demo@123';

const DEPARTMENTS = [
  { name: 'Engineering', code: 'ENG' },
  { name: 'HR', code: 'HR' },
  { name: 'Finance', code: 'FIN' },
  { name: 'IT', code: 'IT' },
];

// Permission keys every portal role needs to log in + reach Exit Management.
const BASE_PERMS = [
  'dashboard',
  'employee-directory',
  'employee.view',
  'exit-management',
  'messages',
  'leave-absence',
  'leave.apply',
];
// HR Admin gets a broader management set.
const HR_ADMIN_PERMS = [
  ...BASE_PERMS,
  'employee.create',
  'employee.edit',
  'departments',
  'departments.manage',
  'onboarding',
  'payroll-management',
  'performance',
  'reports-analytics',
  'system-settings',
];

const ROLES = [
  { name: 'Employee', description: 'Standard employee portal access', perms: BASE_PERMS },
  { name: 'Department Head', description: 'Department head — approves exit stages owned by their department', perms: BASE_PERMS },
  { name: 'HR Admin', description: 'HR administrator', perms: HR_ADMIN_PERMS },
  { name: 'Finance Head', description: 'Finance department head', perms: BASE_PERMS },
  { name: 'IT Head', description: 'IT department head', perms: BASE_PERMS },
];

const EMPLOYEES = [
  { email: 'employee@demo.com', first: 'Evan', last: 'Employee', title: 'Software Engineer', dept: 'Engineering', role: 'Employee' },
  { email: 'depthead@demo.com', first: 'Dana', last: 'Head', title: 'Engineering Manager', dept: 'Engineering', role: 'Department Head' },
  { email: 'hr@demo.com', first: 'Hana', last: 'Reyes', title: 'HR Administrator', dept: 'HR', role: 'HR Admin' },
  { email: 'finance@demo.com', first: 'Finn', last: 'Carter', title: 'Finance Head', dept: 'Finance', role: 'Finance Head' },
  { email: 'it@demo.com', first: 'Ira', last: 'Tan', title: 'IT Head', dept: 'IT', role: 'IT Head' },
];

async function getOrCreateTenant() {
  const existing = await tenantRepo.findTenantByAdminEmail(ADMIN_EMAIL);
  if (existing) {
    logger.info(`[seed:demo] Tenant already exists: ${existing.name} (db=${existing.db_name}) — reusing.`);
    return { id: existing.id, name: existing.name, dbName: existing.db_name };
  }
  logger.info(`[seed:demo] Creating tenant "${ORG_NAME}"...`);
  const tenant = await tenantService.createTenant({
    name: ORG_NAME,
    adminEmail: ADMIN_EMAIL,
    adminName: ADMIN_NAME,
    adminPassword: PASSWORD,
    createdBy: null,
  });
  logger.info(`[seed:demo] Tenant created: ${tenant.name} (db=${tenant.dbName})`);
  return { id: tenant.id, name: tenant.name, dbName: tenant.dbName };
}

async function getOrCreateDepartment(pool, { name, code }) {
  const found = await pool.query('SELECT id FROM departments WHERE name = $1 LIMIT 1', [name]);
  if (found.rows.length) return found.rows[0].id;
  const { rows } = await pool.query(
    `INSERT INTO departments (name, code, description, is_active, status, employee_count, created_at, updated_at)
     VALUES ($1, $2, $3, true, 'active', 0, NOW(), NOW())
     RETURNING id`,
    [name, code, `${name} department`],
  );
  logger.info(`[seed:demo]   department "${name}" -> id ${rows[0].id}`);
  return rows[0].id;
}

async function getPermissionIds(pool, keys) {
  const { rows } = await pool.query('SELECT id, key FROM rbac_permissions WHERE key = ANY($1)', [keys]);
  const map = new Map(rows.map((r) => [r.key, r.id]));
  const missing = keys.filter((k) => !map.has(k));
  if (missing.length) logger.warn(`[seed:demo]   (permission keys not found, skipped): ${missing.join(', ')}`);
  return keys.filter((k) => map.has(k)).map((k) => map.get(k));
}

async function getOrCreateRole(pool, { name, description, perms }) {
  let roleId;
  const found = await pool.query('SELECT id FROM rbac_roles WHERE name = $1 LIMIT 1', [name]);
  if (found.rows.length) {
    roleId = found.rows[0].id;
  } else {
    const { rows } = await pool.query(
      `INSERT INTO rbac_roles (name, description, is_system, created_at, updated_at)
       VALUES ($1, $2, false, NOW(), NOW()) RETURNING id`,
      [name, description],
    );
    roleId = rows[0].id;
    logger.info(`[seed:demo]   role "${name}" -> id ${roleId}`);
  }
  // (Re)grant permissions idempotently.
  const permIds = await getPermissionIds(pool, perms);
  for (const pid of permIds) {
    await pool.query(
      `INSERT INTO rbac_role_permissions (role_id, permission_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [roleId, pid],
    );
  }
  return roleId;
}

async function getOrCreateEmployee(pool, emp, deptId, roleId, empSeq) {
  const found = await pool.query('SELECT id FROM employees WHERE work_email = $1 LIMIT 1', [emp.email]);
  const passwordHash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);
  if (found.rows.length) {
    // Ensure login + linkage are correct on re-run.
    await pool.query(
      `UPDATE employees
         SET password_hash = $1, portal_enabled = true, department_id = $2,
             department = $3, rbac_role_id = $4, employment_status = 'Active',
             is_currently_working = true, updated_at = NOW()
       WHERE id = $5`,
      [passwordHash, deptId, emp.dept, roleId, found.rows[0].id],
    );
    logger.info(`[seed:demo]   employee ${emp.email} updated (id ${found.rows[0].id})`);
    return found.rows[0].id;
  }
  const empId = `DEMO-${String(empSeq).padStart(4, '0')}`;
  const { rows } = await pool.query(
    `INSERT INTO employees (
       emp_id, full_name, first_name, last_name, job_title,
       department, department_id, employment_type, work_email, work_location,
       join_date, employment_status, password_hash, portal_enabled, rbac_role_id,
       is_currently_working, onboarding_step,
       family_members, secondary_contact, education, work_experience,
       created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, 'Full-time', $8, 'HQ',
       CURRENT_DATE, 'Active', $9, true, $10,
       true, 0,
       '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb,
       NOW(), NOW()
     ) RETURNING id`,
    [empId, `${emp.first} ${emp.last}`, emp.first, emp.last, emp.title,
     emp.dept, deptId, emp.email, passwordHash, roleId],
  );
  logger.info(`[seed:demo]   employee ${emp.email} created (id ${rows[0].id}, ${empId})`);
  return rows[0].id;
}

async function seed() {
  await db.assertDbConnection();

  const tenant = await getOrCreateTenant();
  // Ensure migrations are applied (no-op if already done) and get a pool.
  await tenantService.runTenantMigrations(tenant.dbName);
  const pool = db.getTenantPool(tenant.dbName);

  logger.info('[seed:demo] Seeding departments...');
  const deptIds = {};
  for (const d of DEPARTMENTS) deptIds[d.name] = await getOrCreateDepartment(pool, d);

  logger.info('[seed:demo] Seeding roles...');
  const roleIds = {};
  for (const r of ROLES) roleIds[r.name] = await getOrCreateRole(pool, r);

  logger.info('[seed:demo] Seeding employees...');
  const empIds = {};
  let seq = 1;
  for (const e of EMPLOYEES) {
    empIds[e.email] = await getOrCreateEmployee(pool, e, deptIds[e.dept], roleIds[e.role], seq++);
  }

  // Set department heads as the department managers (display only — NOT used for exit access).
  await pool.query('UPDATE departments SET manager_id = $1 WHERE id = $2', [empIds['depthead@demo.com'], deptIds.Engineering]);
  await pool.query('UPDATE departments SET manager_id = $1 WHERE id = $2', [empIds['hr@demo.com'], deptIds.HR]);
  await pool.query('UPDATE departments SET manager_id = $1 WHERE id = $2', [empIds['finance@demo.com'], deptIds.Finance]);
  await pool.query('UPDATE departments SET manager_id = $1 WHERE id = $2', [empIds['it@demo.com'], deptIds.IT]);

  logger.info('========================================================');
  logger.info(`[seed:demo] DONE. Tenant "${tenant.name}" (db=${tenant.dbName})`);
  logger.info('[seed:demo] Logins (password: Demo@123):');
  logger.info('[seed:demo]   admin@demo.com      (Org Admin)');
  for (const e of EMPLOYEES) logger.info(`[seed:demo]   ${e.email.padEnd(20)} ${e.role} / ${e.dept}`);
  logger.info('========================================================');
}

if (require.main === module) {
  (async () => {
    try {
      await seed();
      try { await db.pool.end(); } catch (_) {}
      process.exit(0);
    } catch (err) {
      logger.error('[seed:demo] FAILED:', err);
      try { await db.pool.end(); } catch (_) {}
      process.exit(1);
    }
  })();
}

module.exports = { seed };
