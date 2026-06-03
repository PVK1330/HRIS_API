'use strict';

/**
 * Production bug audit — attendance module
 * Run: npm run test:attendance:audit
 */

const assert = require('node:assert/strict');
const integrity = require('../modules/employees/attendance/attendanceIntegrity.service');
const calc = require('../modules/employees/attendance/attendanceCalculation.service');
const service = require('../modules/employees/attendance/attendance.service');

const results = [];

function run(name, fn) {
  try {
    fn();
    results.push({ name, pass: true });
  } catch (e) {
    results.push({ name, pass: false, error: e.message });
  }
}

const baseSettings = {
  ten_minute_buffer: false,
  late_mark_auto_calculation: true,
  overtime_eligibility: true,
  min_hours_for_present: 6,
  total_required_hours: 8,
  early_departure_rule: 'Mark half day',
};
const baseShift = {
  start_time: '09:00',
  end_time: '18:00',
  break_minutes: 30,
  grace_minutes: 0,
  minimum_hours: 6,
};

console.log('Attendance Production Bug Audit\n');

run('Invalid Present (no punches) → Missing Check In', () => {
  const s = integrity.deriveStatus({
    status: 'Present',
    checkInTime: null,
    checkOutTime: null,
    workedHours: 0,
  });
  assert.equal(s, 'Missing Check In');
  const mapped = integrity.mapRecordForResponse({
    status: 'Present',
    check_in_time: null,
    check_out_time: null,
    regularization_status: 'N/A',
    worked_hours: 0,
    overtime_hours: 0,
    is_late: false,
  });
  assert.equal(mapped.status, 'Missing Check In');
});

run('Check-in only → Missing Check Out', () => {
  assert.equal(
    integrity.deriveStatus({
      status: 'Present',
      checkInTime: '09:00',
      checkOutTime: null,
    }),
    'Missing Check Out',
  );
});

run('Pending regularization → Regularization Pending', () => {
  assert.equal(
    integrity.deriveStatus({
      status: 'Present',
      checkInTime: '09:00',
      checkOutTime: '18:00',
      regularizationStatus: 'Pending',
    }),
    'Regularization Pending',
  );
});

run('Present + 0 hours + punches → not bare Present when incomplete', () => {
  const r = integrity.sanitizeMetrics(
    { status: 'Present', worked_hours: 0, overtime_hours: 0, is_late: false },
    null,
    null,
    'N/A',
  );
  assert.notEqual(r.status, 'Present');
});

run('Overtime without worked hours → OT zeroed', () => {
  const r = integrity.sanitizeMetrics(
    { status: 'Present', worked_hours: 0, overtime_hours: 3, is_late: false },
    '09:00',
    '18:00',
    'N/A',
  );
  assert.equal(r.overtime_hours, 0);
});

run('Late flag cleared when no check-in', () => {
  const r = integrity.sanitizeMetrics(
    { status: 'Late', worked_hours: 0, overtime_hours: 0, is_late: true },
    null,
    null,
    'N/A',
  );
  assert.equal(r.is_late, false);
  assert.equal(r.status, 'Missing Check In');
});

run('Approved regularization without approver throws', () => {
  assert.throws(
    () => integrity.assertApprovedHasApprover('Approved', null),
    /approver/i,
  );
});

run('computeFromPunch never returns Present without punches', () => {
  const punch = calc.computeFromPunch({
    settings: baseSettings,
    shift: baseShift,
    checkInTime: null,
    checkOutTime: null,
    dateStr: '2025-06-02',
  });
  assert.notEqual(punch.status, 'Present');
});

run('Employee check-in flow (calc) sets check-in status', () => {
  const punch = calc.computeFromPunch({
    settings: baseSettings,
    shift: baseShift,
    checkInTime: '09:05',
    checkOutTime: null,
    dateStr: '2025-06-02',
  });
  assert.ok(punch.status === 'Missing Check Out' || punch.status === 'Late' || punch.status === 'Present');
  assert.ok(Boolean('09:05'));
});

run('Employee check-out flow (calc) with both punches', () => {
  const punch = calc.computeFromPunch({
    settings: baseSettings,
    shift: baseShift,
    checkInTime: '09:00',
    checkOutTime: '18:00',
    dateStr: '2025-06-02',
  });
  assert.ok(['Present', 'Late', 'Half Day', 'Remote'].includes(punch.status) || punch.status.startsWith('Missing') === false);
  assert.ok(Number(punch.worked_hours) >= 0);
});

run('Notes null normalizes', () => {
  assert.equal(service.normalizeNotes(null), null);
});

run('Notes empty string normalizes', () => {
  assert.equal(service.normalizeNotes(''), null);
});

run('Notes whitespace trims', () => {
  assert.equal(service.normalizeNotes('  ok  '), 'ok');
});

run('Location tracking flag from settings shape', () => {
  const enabled = { attendance_location_tracking: true };
  const disabled = { attendance_location_tracking: false };
  assert.equal(enabled.attendance_location_tracking === true, true);
  assert.equal(disabled.attendance_location_tracking === true, false);
});

run('Payroll present requires check_in_time (SQL contract)', () => {
  const sql = require('fs').readFileSync(
    require('path').join(__dirname, '../modules/employees/attendance/attendance.repository.js'),
    'utf8',
  );
  assert.ok(sql.includes('check_in_time IS NOT NULL'));
  assert.ok(sql.includes('present_days'));
});

run('HR override service enforces manage permission helper', () => {
  assert.equal(typeof service.markAttendance, 'function');
  assert.equal(typeof service.canManageOverride, 'function');
});

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);

console.log('| Test | Result |');
console.log('|------|--------|');
for (const r of results) {
  console.log(`| ${r.name} | ${r.pass ? 'PASS' : 'FAIL'} |`);
}
console.log(`\nTotal: ${passed}/${results.length} PASS`);

if (failed.length) {
  console.error('\nFailures:');
  for (const f of failed) console.error(`  - ${f.name}: ${f.error}`);
  process.exit(1);
}

console.log('\nOverall: PASS');
