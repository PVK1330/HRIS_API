'use strict';

/**
 * Attendance enterprise module — static security & calculation tests.
 * Run: node src/tests/attendance.enterprise.test.js
 */

const assert = require('assert');
const calc = require('../modules/employees/attendance/attendanceCalculation.service');
const { hasPermission } = require('../services/authz.service');
const { P, expandPermissionKeys } = require('../constants/permissions');
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

(async () => {
  console.log('Attendance enterprise tests\n');

  await test('late arrival uses settings buffer and grace', () => {
    const r = calc.computeFromPunch({
      settings: {
        work_start_time: '09:00',
        work_end_time: '18:00',
        ten_minute_buffer: true,
        late_mark_auto_calculation: true,
        min_hours_for_present: 6,
        total_required_hours: 8,
        overtime_eligibility: false,
      },
      shift: { start_time: '09:00', end_time: '18:00', break_minutes: 30, grace_minutes: 15 },
      checkInTime: '09:30',
      checkOutTime: '18:00',
      workMode: 'In Office',
      dateStr: '2026-06-02',
      leaveRecord: null,
      holidayRecord: null,
    });
    assert.strictEqual(r.is_late, true);
    assert.ok(r.late_minutes > 0);
  });

  await test('approved leave marks On Leave not Absent', () => {
    const r = calc.computeFromPunch({
      settings: {},
      shift: null,
      checkInTime: null,
      checkOutTime: null,
      dateStr: '2026-06-02',
      leaveRecord: { leave_type: 'Sick' },
      holidayRecord: null,
    });
    assert.strictEqual(r.status, 'On Leave');
    assert.strictEqual(r.leave_type, 'Sick');
  });

  await test('holiday status', () => {
    const r = calc.computeFromPunch({
      settings: {},
      shift: null,
      dateStr: '2026-06-02',
      leaveRecord: null,
      holidayRecord: { region: 'England', name: 'Bank Holiday' },
    });
    assert.strictEqual(r.status, 'Holiday');
  });

  await test('weekend Saturday/Sunday', () => {
    const r = calc.computeFromPunch({
      settings: { weekend_mode: 'Saturday/Sunday' },
      shift: null,
      dateStr: '2026-06-07',
      leaveRecord: null,
      holidayRecord: null,
    });
    assert.strictEqual(r.status, 'Weekend');
  });

  await test('overnight shift hours', () => {
    const r = calc.computeFromPunch({
      settings: {
        work_start_time: '22:00',
        work_end_time: '06:00',
        min_hours_for_present: 4,
        total_required_hours: 8,
      },
      shift: {
        start_time: '22:00',
        end_time: '06:00',
        break_minutes: 30,
        is_night_shift: true,
        grace_minutes: 0,
      },
      checkInTime: '22:05',
      checkOutTime: '06:00',
      workMode: 'In Office',
      dateStr: '2026-06-02',
      leaveRecord: null,
      holidayRecord: null,
    });
    assert.ok(r.worked_hours > 0);
  });

  await test('legacy attendance permission expands', () => {
    const expanded = expandPermissionKeys(['attendance']);
    assert.ok(expanded.has(P.ATTENDANCE_VIEW) || expanded.has('attendance'));
  });

  await test('employee cannot approve own request', async () => {
    const auth = {
      employeeId: 5,
      isTenantAdmin: false,
      permissions: new Set([P.ATTENDANCE_APPROVE]),
    };
    const record = { employee_id: 5 };
    const step = { approver_role: 'Team Lead', level: 1, status: 'Pending' };
    const pool = {
      query: async () => ({
        rows: [{ id: 5, reporting_manager_id: 99, department: 'Eng', department_id: 1 }],
      }),
    };
    await assert.rejects(
      () => authz.assertCanActOnPendingStep(auth, pool, record, step, 'approve'),
      /own|forbidden/i,
    );
  });

  await test('two-level workflow chain from settings', () => {
    const levels = approval.buildApprovalChain({
      approval_workflow_type: 'Two Level',
      approver: 'Manager',
    });
    assert.ok(levels.length >= 1);
  });

  await test('HR manage permission grants view all', () => {
    const auth = { isTenantAdmin: false, permissions: new Set([P.ATTENDANCE_MANAGE]) };
    assert.strictEqual(authz.canViewAll(auth), true);
  });

  await test('unauthorized approve without permission', () => {
    const auth = { isTenantAdmin: false, permissions: new Set([P.ATTENDANCE_VIEW_OWN]) };
    assert.strictEqual(hasPermission(auth, P.ATTENDANCE_APPROVE), false);
  });

  console.log(`\n${passed} tests passed`);
})();
