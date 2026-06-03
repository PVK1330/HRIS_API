'use strict';

/**
 * Attendance settings enforcement tests.
 * Run: node src/tests/attendance.settings.test.js
 */

const assert = require('assert');
const grace = require('../modules/employees/attendance/attendanceGrace.service');
const overtime = require('../modules/employees/attendance/attendanceOvertime.service');
const workflow = require('../modules/employees/attendance/attendanceWorkflow.service');
const calc = require('../modules/employees/attendance/attendanceCalculation.service');
const { buildApprovalChain } = require('../modules/employees/attendance/attendanceApproval.service');

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
  console.log('Attendance settings enforcement tests\n');

  await test('grace: first 3 late arrivals stay Present when grace_days=3', () => {
    for (let prior = 0; prior < 3; prior += 1) {
      const r = grace.applyGraceToLateStatus({
        settings: { grace_days_per_month: 3, late_mark_auto_calculation: true },
        rawStatus: 'Late',
        lateMinutes: 15,
        monthlyLateCountBefore: prior,
        workedHours: 8,
        minPresent: 6,
      });
      assert.strictEqual(r.status, 'Present');
      assert.strictEqual(r.is_late, false);
      assert.strictEqual(r.grace_applied, true);
    }
  });

  await test('grace: 4th late arrival marked Late when grace_days=3', () => {
    const r = grace.applyGraceToLateStatus({
      settings: { grace_days_per_month: 3, late_mark_auto_calculation: true },
      rawStatus: 'Late',
      lateMinutes: 20,
      monthlyLateCountBefore: 3,
      workedHours: 8,
      minPresent: 6,
    });
    assert.strictEqual(r.status, 'Late');
    assert.strictEqual(r.is_late, true);
    assert.strictEqual(r.grace_applied, false);
  });

  await test('grace: zero grace_days marks Late immediately', () => {
    const r = grace.applyGraceToLateStatus({
      settings: { grace_days_per_month: 0 },
      rawStatus: 'Late',
      lateMinutes: 5,
      monthlyLateCountBefore: 0,
      workedHours: 8,
      minPresent: 6,
    });
    assert.strictEqual(r.status, 'Late');
    assert.strictEqual(r.is_late, true);
  });

  await test('workflow: Two Level chain from approver=HR', () => {
    const chain = workflow.buildApprovalChain({
      approval_workflow_type: 'Two Level',
      approver: 'HR',
    });
    assert.deepStrictEqual(chain, ['Direct Manager', 'HR']);
  });

  await test('workflow: Single Level uses approver only', () => {
    const chain = workflow.buildApprovalChain({
      approval_workflow_type: 'Single Level',
      approver: 'Manager',
    });
    assert.deepStrictEqual(chain, ['Manager']);
  });

  await test('workflow: Three Level ends with configured approver', () => {
    const chain = buildApprovalChain({
      approval_workflow_type: 'Three Level',
      approver: 'HR Manager',
    });
    assert.strictEqual(chain[chain.length - 1], 'HR Manager');
    assert.ok(chain.includes('Direct Manager'));
  });

  await test('overtime: 1.5x hourly multiplier', () => {
    const r = overtime.calculateOvertimeHours(
      { overtime_calculation_rule: '1.5x hourly' },
      2,
    );
    assert.strictEqual(r.multiplier, 1.5);
    assert.strictEqual(r.overtime_hours, 3);
  });

  await test('overtime: 2x hourly multiplier', () => {
    const r = overtime.calculateOvertimeHours(
      { overtime_calculation_rule: '2x hourly' },
      1,
    );
    assert.strictEqual(r.multiplier, 2);
    assert.strictEqual(r.overtime_hours, 2);
  });

  await test('overtime: Custom uses overtime_custom_multiplier from settings', () => {
    const r = overtime.calculateOvertimeHours(
      {
        overtime_calculation_rule: 'Custom',
        overtime_custom_multiplier: 1.25,
      },
      4,
    );
    assert.strictEqual(r.multiplier, 1.25);
    assert.strictEqual(r.overtime_hours, 5);
  });

  await test('overtime: integrated in computeFromPunch', () => {
    const r = calc.computeFromPunch({
      settings: {
        overtime_eligibility: true,
        total_required_hours: 8,
        overtime_calculation_rule: '1.5x hourly',
        late_mark_auto_calculation: false,
        grace_days_per_month: 0,
      },
      shift: { start_time: '09:00', end_time: '18:00', break_minutes: 60, grace_minutes: 0 },
      checkInTime: '09:00',
      checkOutTime: '20:00',
      workMode: 'In Office',
      dateStr: '2026-06-02',
      leaveRecord: null,
      holidayRecord: null,
      monthlyLateCountBefore: 0,
    });
    assert.ok(r.overtime_hours > 0);
    assert.strictEqual(r.overtime_multiplier, 1.5);
  });

  await test('grace: integrated in computeFromPunch (3rd late in month)', () => {
    const r = calc.computeFromPunch({
      settings: {
        grace_days_per_month: 3,
        late_mark_auto_calculation: true,
        work_start_time: '09:00',
        ten_minute_buffer: false,
        min_hours_for_present: 6,
        overtime_eligibility: false,
      },
      shift: { start_time: '09:00', end_time: '18:00', break_minutes: 30, grace_minutes: 0 },
      checkInTime: '09:45',
      checkOutTime: '18:00',
      workMode: 'In Office',
      dateStr: '2026-06-10',
      leaveRecord: null,
      holidayRecord: null,
      monthlyLateCountBefore: 2,
    });
    assert.strictEqual(r.status, 'Present');
    assert.strictEqual(r.grace_applied, true);
  });

  console.log(`\n${passed} tests passed`);
})();
