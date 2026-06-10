'use strict';

/**
 * Integration tests for the Departments + Designations modules, exercised through
 * the real services against a tenant database. First module of the messaging/HR
 * suite buildout — mirrors the structure of policies.lifecycle.test.js.
 *
 * Locks in the Phase 1 fixes:
 *   - DEPT-2: duplicate department NAME → 409 (exact + case-insensitive, create + rename)
 *   - DEPT-3: duplicate department CODE → 409
 * plus the follow-up departments/designations hardening:
 *   - designations.department_name is POPULATED from the related department (not null)
 *   - employee count joins on department_id, so it SURVIVES a department rename
 *   - manager_id must reference a real, non-deleted employee (→ 400)
 *   - soft-delete is GUARDED while employees are assigned (→ 409 unless force) and
 *     CASCADES a deactivation to the department's designations
 *
 * DB-backed: targets DEPT_TEST_TENANT_DB (default hris_demo_corp_7). Creates only
 * throwaway '__ITEST__' rows (departments, one designation, one employee) and
 * removes them in after(). SKIPS (not fails) if no DB/tenant is reachable.
 *
 * Run: npm run test:departments
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../config/db');
const deptService = require('../modules/departments/departments.service');
const desigService = require('../modules/designations/designations.service');

const TENANT_DB = process.env.DEPT_TEST_TENANT_DB || 'hris_demo_corp_7';
const tenant = { dbName: TENANT_DB };
const MARK = '__ITEST__';

let ready = false;
let pool = null;

// Remove every throwaway row this suite could create. Order matters: designations
// and employees reference departments. Best-effort (ignore per-statement errors).
async function cleanup() {
  if (!pool) return;
  const like = `${MARK}%`;
  await pool
    .query(
      `DELETE FROM designations
        WHERE name LIKE $1
           OR department_id IN (SELECT id FROM departments WHERE name LIKE $1)`,
      [like],
    )
    .catch(() => {});
  await pool.query(`DELETE FROM employees WHERE full_name LIKE $1`, [like]).catch(() => {});
  await pool
    .query(
      `DELETE FROM notifications WHERE entity_type IN ('department','designation') AND title LIKE $1`,
      [`%${MARK}%`],
    )
    .catch(() => {});
  await pool.query(`DELETE FROM departments WHERE name LIKE $1`, [like]).catch(() => {});
}

test.before(async () => {
  try {
    await db.assertDbConnection();
    pool = await db.getTenantPool(TENANT_DB);
    await cleanup(); // clear leftovers from a previous aborted run
    ready = true;
  } catch (_) {
    ready = false;
  }
});

test.after(async () => {
  try { await cleanup(); } catch (_) { /* best-effort */ }
  try { await db.closeAllTenantPools(); } catch (_) { /* */ }
  try { await db.pool.end(); } catch (_) { /* */ }
});

test('DEPT-2/3: duplicate name and code return 409 (create + rename)', async (t) => {
  if (!ready) { t.skip(`No tenant DB (tenant=${TENANT_DB})`); return; }

  const a = await deptService.createDepartment(tenant, {
    name: `${MARK} Alpha`, code: `${MARK}C1`, status: 'active',
  });
  assert.ok(a.id, 'created first department');
  assert.equal(a.status, 'Active', 'create → Active');

  // DEPT-2: exact duplicate name → 409
  await assert.rejects(
    () => deptService.createDepartment(tenant, { name: `${MARK} Alpha`, status: 'active' }),
    (e) => e.statusCode === 409 && /name already exists/i.test(e.message),
    'exact duplicate name → 409',
  );

  // DEPT-2: case-insensitive duplicate name → still 409 (LOWER(name) match)
  await assert.rejects(
    () => deptService.createDepartment(tenant, { name: `${MARK} ALPHA`, status: 'active' }),
    (e) => e.statusCode === 409,
    'case-insensitive duplicate name → 409',
  );

  // DEPT-3: duplicate code → 409
  await assert.rejects(
    () => deptService.createDepartment(tenant, { name: `${MARK} Beta`, code: a.code, status: 'active' }),
    (e) => e.statusCode === 409 && /code .*already exists/i.test(e.message),
    'duplicate code → 409',
  );

  // DEPT-2 on the UPDATE path: renaming onto an existing name → 409
  const b = await deptService.createDepartment(tenant, { name: `${MARK} Gamma`, status: 'active' });
  await assert.rejects(
    () => deptService.updateDepartment(tenant, b.id, { name: `${MARK} Alpha` }),
    (e) => e.statusCode === 409,
    'rename onto an existing name → 409',
  );
});

test('manager_id must reference a real, non-deleted employee (→ 400)', async (t) => {
  if (!ready) { t.skip(`No tenant DB (tenant=${TENANT_DB})`); return; }

  await assert.rejects(
    () => deptService.createDepartment(tenant, {
      name: `${MARK} Mgr`, status: 'active', manager_id: 999999999,
    }),
    (e) => e.statusCode === 400 && /manager_id/i.test(e.message),
    'non-existent manager_id → 400',
  );
});

test('rename-safe count + populated department_name + soft-delete guard/cascade', async (t) => {
  if (!ready) { t.skip(`No tenant DB (tenant=${TENANT_DB})`); return; }

  const dept = await deptService.createDepartment(tenant, { name: `${MARK} Eng`, status: 'active' });

  // Designation under it — the stored denormalized column must be populated (not null).
  const desig = await desigService.createDesignation(tenant, {
    name: `${MARK} Engineer`, department_id: dept.id, status: 'active',
  });
  const stored = await pool.query('SELECT department_name FROM designations WHERE id = $1', [desig.id]);
  assert.equal(stored.rows[0].department_name, `${MARK} Eng`, 'stored designations.department_name populated from department');

  // One throwaway employee linked by department_id (its `department` text is the
  // ORIGINAL name — so a later rename would break a name-based count).
  await pool.query(
    `INSERT INTO employees (emp_id, full_name, job_title, department, employment_type, join_date, department_id, employment_status)
     VALUES ($1, $2, 'Tester', $3, 'Full-time', CURRENT_DATE, $4, 'Active')`,
    [`${MARK}E1`, `${MARK} Worker`, `${MARK} Eng`, dept.id],
  );

  assert.equal((await deptService.getDepartment(tenant, dept.id)).employeeCount, 1, 'employee counted by department_id');

  // Rename → count MUST stay 1 (joins on department_id, not the name string).
  await deptService.updateDepartment(tenant, dept.id, { name: `${MARK} Engineering` });
  assert.equal((await deptService.getDepartment(tenant, dept.id)).employeeCount, 1, 'count survives rename');

  // Soft-delete blocked while an employee is assigned (no force) → 409.
  await assert.rejects(
    () => deptService.deleteDepartment(tenant, dept.id),
    (e) => e.statusCode === 409 && /still assigned/i.test(e.message),
    'soft-delete blocked with employees assigned → 409',
  );

  // Force soft-delete → department inactive + designation deactivated (cascade).
  const res = await deptService.deleteDepartment(tenant, dept.id, { force: true });
  assert.equal(res.deactivatedDesignations, 1, 'one designation deactivated on soft delete');
  assert.equal((await deptService.getDepartment(tenant, dept.id)).status, 'Inactive', 'department soft-deleted (inactive)');

  const d = await pool.query('SELECT is_active, status FROM designations WHERE id = $1', [desig.id]);
  assert.equal(d.rows[0].is_active, false, 'designation is_active=false after cascade');
  assert.equal(d.rows[0].status, 'inactive', 'designation status=inactive after cascade');
});
