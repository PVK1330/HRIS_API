'use strict';

/**
 * P0 approval security integration tests (service-layer, no DB).
 * Run: node src/tests/attendance.approval.security.test.js
 */

const assert = require('assert');
const ApiError = require('../utils/ApiError');
const { P } = require('../constants/permissions');
const authz = require('../modules/employees/attendance/attendanceAuth.service');
const approval = require('../modules/employees/attendance/attendanceApproval.service');
let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  OK ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}:`, e.message);
    process.exitCode = 1;
  }
}

function mockPool(employee) {
  return {
    query: async () => ({ rows: [employee] }),
  };
}

function perms(...keys) {
  return new Set(keys);
}

const subject = {
  id: 10,
  department: 'Engineering',
  department_id: 5,
  reporting_manager_id: 2,
};

const record = { employee_id: 10, id: 100 };

const stepTeamLead = { approver_role: 'Direct Manager', level: 1, status: 'Pending' };
const stepManager = { approver_role: 'Manager', level: 2, status: 'Pending' };
const stepHr = { approver_role: 'HR', level: 3, status: 'Pending' };

(async () => {
  console.log('Attendance P0 approval security tests\n');

  await test('legacy attendance.view does NOT grant canViewAll', () => {
    const auth = { isTenantAdmin: false, permissions: perms(P.ATTENDANCE_VIEW) };
    assert.strictEqual(authz.canViewAll(auth), false);
  });

  await test('attendance.view.all grants canViewAll', () => {
    const auth = { isTenantAdmin: false, permissions: perms(P.ATTENDANCE_VIEW_ALL) };
    assert.strictEqual(authz.canViewAll(auth), true);
  });

  await test('Employee cannot approve own regularization', async () => {
    const auth = {
      employeeId: 10,
      isTenantAdmin: false,
      permissions: perms(P.ATTENDANCE_APPROVE),
    };
    await assert.rejects(
      () => authz.assertCanActOnPendingStep(auth, mockPool(subject), record, stepTeamLead, 'approve'),
      (e) => e.statusCode === 403,
    );
  });

  await test('Team Lead approves direct report on Team Lead step', async () => {
    const auth = {
      employeeId: 2,
      isTenantAdmin: false,
      scope: 'TEAM',
      permissions: perms(P.ATTENDANCE_APPROVE, P.ATTENDANCE_VIEW_TEAM),
    };
    await authz.assertCanActOnPendingStep(auth, mockPool(subject), record, stepTeamLead, 'approve');
  });

  await test('Team Lead cannot approve non-direct-report on Team Lead step', async () => {
    const auth = {
      employeeId: 99,
      isTenantAdmin: false,
      scope: 'TEAM',
      managedDepartmentId: 5,
      department: 'Engineering',
      permissions: perms(P.ATTENDANCE_APPROVE, P.ATTENDANCE_VIEW_TEAM),
    };
    await assert.rejects(
      () => authz.assertCanActOnPendingStep(auth, mockPool(subject), record, stepTeamLead, 'approve'),
      (e) => e.statusCode === 403,
    );
  });

  await test('Team Lead cannot approve Manager step even for direct report', async () => {
    const auth = {
      employeeId: 2,
      isTenantAdmin: false,
      scope: 'TEAM',
      permissions: perms(P.ATTENDANCE_APPROVE, P.ATTENDANCE_VIEW_TEAM),
    };
    await assert.rejects(
      () => authz.assertCanActOnPendingStep(auth, mockPool(subject), record, stepManager, 'approve'),
      (e) => e.statusCode === 403,
    );
  });

  await test('Team Lead cannot approve HR step', async () => {
    const auth = {
      employeeId: 2,
      isTenantAdmin: false,
      permissions: perms(P.ATTENDANCE_APPROVE, P.ATTENDANCE_VIEW_TEAM),
    };
    await assert.rejects(
      () => authz.assertCanActOnPendingStep(auth, mockPool(subject), record, stepHr, 'approve'),
      (e) => e.statusCode === 403,
    );
  });

  await test('Manager approves department employee on Manager step', async () => {
    const auth = {
      employeeId: 3,
      isTenantAdmin: false,
      scope: 'DEPARTMENT',
      department: 'Engineering',
      permissions: perms(P.ATTENDANCE_APPROVE, P.ATTENDANCE_VIEW_TEAM),
    };
    await authz.assertCanActOnPendingStep(auth, mockPool(subject), record, stepManager, 'approve');
  });

  await test('Manager with managedDepartmentId approves via department_id', async () => {
    const auth = {
      employeeId: 3,
      isTenantAdmin: false,
      scope: 'DEPT_MANAGER',
      managedDepartmentId: 5,
      permissions: perms(P.ATTENDANCE_APPROVE),
    };
    await authz.assertCanActOnPendingStep(auth, mockPool(subject), record, stepManager, 'approve');
  });

  await test('Manager cannot approve other department on Manager step', async () => {
    const auth = {
      employeeId: 3,
      isTenantAdmin: false,
      scope: 'DEPARTMENT',
      department: 'Sales',
      permissions: perms(P.ATTENDANCE_APPROVE),
    };
    await assert.rejects(
      () => authz.assertCanActOnPendingStep(auth, mockPool(subject), record, stepManager, 'approve'),
      (e) => e.statusCode === 403,
    );
  });

  await test('Manager cannot approve HR step without HR scope', async () => {
    const auth = {
      employeeId: 3,
      isTenantAdmin: false,
      scope: 'DEPARTMENT',
      department: 'Engineering',
      permissions: perms(P.ATTENDANCE_APPROVE),
    };
    await assert.rejects(
      () => authz.assertCanActOnPendingStep(auth, mockPool(subject), record, stepHr, 'approve'),
      (e) => e.statusCode === 403,
    );
  });

  await test('HR with approve + view.all can approve HR step tenant-wide', async () => {
    const auth = {
      employeeId: 50,
      isTenantAdmin: false,
      scope: 'ALL',
      permissions: perms(P.ATTENDANCE_APPROVE, P.ATTENDANCE_VIEW_ALL),
    };
    await authz.assertCanActOnPendingStep(auth, mockPool(subject), record, stepHr, 'approve');
  });

  await test('HR with approve only (no view.all) cannot approve HR step', async () => {
    const auth = {
      employeeId: 50,
      isTenantAdmin: false,
      permissions: perms(P.ATTENDANCE_APPROVE, P.ATTENDANCE_VIEW_TEAM),
    };
    await assert.rejects(
      () => authz.assertCanActOnPendingStep(auth, mockPool(subject), record, stepHr, 'approve'),
      (e) => e.statusCode === 403,
    );
  });

  await test('Admin manage permission overrides step role', async () => {
    const auth = {
      employeeId: 1,
      isTenantAdmin: false,
      permissions: perms(P.ATTENDANCE_MANAGE),
    };
    await authz.assertCanActOnPendingStep(auth, mockPool(subject), record, stepHr, 'approve');
  });

  await test('Tenant admin override can act on any step (not self)', async () => {
    const auth = {
      employeeId: 1,
      isTenantAdmin: true,
      permissions: new Set(),
    };
    const otherRecord = { employee_id: 10, id: 100 };
    await authz.assertCanActOnPendingStep(auth, mockPool(subject), otherRecord, stepManager, 'approve');
  });

  await test('Missing pending step throws validation error', async () => {
    const auth = {
      employeeId: 2,
      isTenantAdmin: false,
      permissions: perms(P.ATTENDANCE_APPROVE),
    };
    await assert.rejects(
      () => authz.assertCanActOnPendingStep(auth, mockPool(subject), record, null, 'approve'),
      (e) => e.statusCode === 400,
    );
  });

  await test('advanceOrComplete throws when no pending steps', async () => {
    const client = {
      query: async (sql) => {
        if (sql.includes('FOR UPDATE')) return { rows: [] };
        return { rows: [{ cnt: 0 }] };
      },
    };
    await assert.rejects(
      () => approval.advanceOrComplete(client, 1, 2, 'ok', 'approve'),
      (e) => e instanceof ApiError && e.statusCode === 400,
    );
  });

  await test('Partial approve keeps finalStatus Pending', async () => {
    const client = {
      query: async (sql) => {
        if (sql.includes('FOR UPDATE')) {
          return { rows: [{ id: 1, level: 1, approver_role: 'Team Lead' }] };
        }
        if (sql.includes('UPDATE attendance_regularization_steps')) return { rows: [] };
        if (sql.includes('COUNT')) return { rows: [{ cnt: 1 }] };
        return { rows: [] };
      },
    };
    const result = await approval.advanceOrComplete(client, 1, 2, 'ok', 'approve');
    assert.strictEqual(result.finalStatus, 'Pending');
    assert.strictEqual(result.done, false);
  });

  console.log(`\n${passed} tests passed`);
})();
