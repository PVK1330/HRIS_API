'use strict';

/**
 * Attendance settings RBAC tests.
 * Run: node src/tests/attendance.settings.rbac.test.js
 */

const assert = require('assert');
const ApiError = require('../utils/ApiError');
const { P } = require('../constants/permissions');
const settingsAuth = require('../modules/attendanceSettings/attendanceSettingsAuth.service');

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

function authWith(...perms) {
  return { isTenantAdmin: false, permissions: new Set(perms) };
}

(async () => {
  console.log('Attendance settings RBAC tests\n');

  await test('no permissions cannot view settings', () => {
    assert.strictEqual(settingsAuth.canViewSettings(authWith()), false);
    assert.throws(
      () => settingsAuth.assertCanViewSettings(authWith()),
      (e) => e instanceof ApiError && e.statusCode === 403,
    );
  });

  await test('attendance.settings.view can view', () => {
    const auth = authWith(P.ATTENDANCE_SETTINGS_VIEW);
    assert.strictEqual(settingsAuth.canViewSettings(auth), true);
    settingsAuth.assertCanViewSettings(auth);
  });

  await test('attendance.settings.manage can view and manage', () => {
    const auth = authWith(P.ATTENDANCE_SETTINGS_MANAGE);
    assert.strictEqual(settingsAuth.canViewSettings(auth), true);
    assert.strictEqual(settingsAuth.canManageSettings(auth), true);
    settingsAuth.assertCanViewSettings(auth);
    settingsAuth.assertCanManageSettings(auth);
  });

  await test('view-only cannot manage settings', () => {
    const auth = authWith(P.ATTENDANCE_SETTINGS_VIEW);
    assert.strictEqual(settingsAuth.canManageSettings(auth), false);
    assert.throws(
      () => settingsAuth.assertCanManageSettings(auth),
      (e) => e instanceof ApiError && e.statusCode === 403,
    );
  });

  await test('attendance.manage can view and manage', () => {
    const auth = authWith(P.ATTENDANCE_MANAGE);
    assert.strictEqual(settingsAuth.canViewSettings(auth), true);
    assert.strictEqual(settingsAuth.canManageSettings(auth), true);
  });

  await test('unrelated permission cannot view', () => {
    const auth = authWith(P.ATTENDANCE_VIEW_OWN, P.ATTENDANCE_CREATE);
    assert.strictEqual(settingsAuth.canViewSettings(auth), false);
    assert.strictEqual(settingsAuth.canManageSettings(auth), false);
  });

  await test('null auth is unauthorized', () => {
    assert.throws(
      () => settingsAuth.assertCanViewSettings(null),
      (e) => e instanceof ApiError && e.statusCode === 401,
    );
  });

  console.log(`\n${passed} tests passed`);
})();
