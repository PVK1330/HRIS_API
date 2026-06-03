'use strict';

const assert = require('node:assert/strict');
const integrity = require('../modules/employees/attendance/attendanceIntegrity.service');
const calc = require('../modules/employees/attendance/attendanceCalculation.service');
const service = require('../modules/employees/attendance/attendance.service');

console.log('Attendance integrity & flow tests\n');

function ok(name) {
  console.log(`  OK ${name}`);
}

try {
  const s1 = integrity.deriveStatus({ status: 'Present', checkInTime: null, checkOutTime: null });
  assert.equal(s1, 'Missing Check In');
  ok('Present without punches → Missing Check In');

  const s2 = integrity.deriveStatus({ status: 'Present', checkInTime: '09:00', checkOutTime: null });
  assert.equal(s2, 'Missing Check Out');
  ok('Check-in only → Missing Check Out');

  const s3 = integrity.deriveStatus({
    status: 'Present', checkInTime: '09:00', checkOutTime: '18:00', regularizationStatus: 'Pending',
  });
  assert.equal(s3, 'Regularization Pending');
  ok('Pending regularization status');

  const r = integrity.sanitizeMetrics(
    { status: 'Present', worked_hours: 0, overtime_hours: 2, is_late: false },
    '09:00', '18:00', 'N/A',
  );
  assert.equal(r.overtime_hours, 0);
  ok('Overtime cleared when no worked hours');

  const punch = calc.computeFromPunch({
    settings: { ten_minute_buffer: false, late_mark_auto_calculation: true, overtime_eligibility: false },
    shift: { start_time: '09:00', end_time: '18:00', break_minutes: 30, grace_minutes: 0, minimum_hours: 6 },
    checkInTime: null,
    checkOutTime: null,
    dateStr: '2025-06-02',
  });
  assert.notEqual(punch.status, 'Present');
  ok('computeFromPunch blocks Present without punches');

  assert.equal(service.normalizeNotes(null), null);
  assert.equal(service.normalizeNotes(''), null);
  assert.equal(service.normalizeNotes(' note '), 'note');
  ok('notes null and empty normalize');

  console.log('\nOverall: PASS');
} catch (e) {
  console.error(`\nFAIL: ${e.message}`);
  process.exit(1);
}
