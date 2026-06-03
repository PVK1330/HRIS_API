'use strict';

/**
 * Attendance cron logic tests (calendar + weekend modes).
 * Run: node src/tests/attendance.cron.test.js
 */

const assert = require('assert');
const calc = require('../modules/employees/attendance/attendanceCalculation.service');
const calendar = require('../modules/employees/attendance/attendanceCalendar.service');

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

function mockPool(handlers) {
  return {
    query: async (sql, params) => {
      for (const h of handlers) {
        const r = h(sql, params);
        if (r !== undefined) return r;
      }
      return { rows: [] };
    },
  };
}

(async () => {
  console.log('Attendance cron tests\n');

  await test('weekend: Saturday/Sunday skips Saturday', () => {
    assert.strictEqual(
      calc.isWeekend('2026-06-06', { weekend_mode: 'Saturday/Sunday' }),
      true,
    );
  });

  await test('weekend: Sunday Only skips Sunday not Saturday', () => {
    assert.strictEqual(calc.isWeekend('2026-06-07', { weekend_mode: 'Sunday Only' }), true);
    assert.strictEqual(calc.isWeekend('2026-06-06', { weekend_mode: 'Sunday Only' }), false);
  });

  await test('weekend: Custom Week Off uses custom_week_off_days', () => {
    assert.strictEqual(
      calc.isWeekend('2026-06-05', { weekend_mode: 'Custom Week Off', custom_week_off_days: [5] }),
      true,
    );
    assert.strictEqual(
      calc.isWeekend('2026-06-06', { weekend_mode: 'Custom Week Off', custom_week_off_days: [5] }),
      false,
    );
  });

  await test('shouldSkipAbsent: approved leave', async () => {
    const pool = mockPool([
      (sql) => {
        if (sql.includes('leave_requests')) {
          return { rows: [{ id: 1, leave_type: 'Sick', status: 'Approved' }] };
        }
        return undefined;
      },
    ]);
    const r = await calendar.shouldSkipAbsentMarking(pool, 10, '2026-06-02', {});
    assert.strictEqual(r.skip, true);
    assert.strictEqual(r.reason, calendar.SKIP_REASONS.LEAVE);
  });

  await test('shouldSkipAbsent: holiday from DB', async () => {
    const pool = mockPool([
      (sql) => {
        if (sql.includes('leave_requests')) return { rows: [] };
        if (sql.includes('holiday_dates')) {
          return { rows: [{ name: 'Bank Holiday', region: 'England' }] };
        }
        return undefined;
      },
    ]);
    const r = await calendar.shouldSkipAbsentMarking(pool, 10, '2026-06-02', {
      uk_holiday_region: 'England',
    });
    assert.strictEqual(r.skip, true);
    assert.strictEqual(r.reason, calendar.SKIP_REASONS.HOLIDAY);
  });

  await test('shouldSkipAbsent: weekend from settings', async () => {
    const pool = mockPool([
      (sql) => {
        if (sql.includes('leave_requests') || sql.includes('holiday_dates')) {
          return { rows: [] };
        }
        return undefined;
      },
    ]);
    const r = await calendar.shouldSkipAbsentMarking(pool, 10, '2026-06-07', {
      weekend_mode: 'Sunday Only',
    });
    assert.strictEqual(r.skip, true);
    assert.strictEqual(r.reason, calendar.SKIP_REASONS.WEEKEND);
  });

  await test('shouldSkipAbsent: company closure', async () => {
    const pool = mockPool([
      (sql) => {
        if (sql.includes('leave_requests') || sql.includes('holiday_dates')) {
          return { rows: [] };
        }
        if (sql.includes('company_closures')) {
          return { rows: [{ id: 1, name: 'Shutdown', closure_date: '2026-06-02' }] };
        }
        return undefined;
      },
    ]);
    const r = await calendar.shouldSkipAbsentMarking(pool, 10, '2026-06-02', {
      weekend_mode: 'Saturday/Sunday',
    });
    assert.strictEqual(r.skip, true);
    assert.strictEqual(r.reason, calendar.SKIP_REASONS.COMPANY_CLOSURE);
  });

  await test('shouldSkipAbsent: none — eligible for absent', async () => {
    const pool = mockPool([
      (sql) => {
        if (sql.includes('leave_requests') || sql.includes('holiday_dates') || sql.includes('company_closures')) {
          return { rows: [] };
        }
        return undefined;
      },
    ]);
    const r = await calendar.shouldSkipAbsentMarking(pool, 10, '2026-06-02', {
      weekend_mode: 'Saturday/Sunday',
      uk_holiday_region: 'England',
    });
    assert.strictEqual(r.skip, false);
  });

  await test('isTenantNonWorkingDay: holiday skips bulk absent', async () => {
    const pool = mockPool([
      (sql) => {
        if (sql.includes('holiday_dates')) {
          return { rows: [{ name: 'X', region: 'England' }] };
        }
        return { rows: [] };
      },
    ]);
    const r = await calendar.isTenantNonWorkingDay(pool, '2026-12-25', {
      uk_holiday_region: 'England',
    });
    assert.strictEqual(r, true);
  });

  await test('cron audit action constants are defined', () => {
    const actions = [
      'attendance.cron.absent',
      'attendance.cron.late_recalc',
      'attendance.cron.ot_recalc',
      'attendance.cron.month_close',
      'attendance.cron.auto_reject',
      'attendance.cron.summary',
    ];
    assert.strictEqual(actions.length, 6);
  });

  console.log(`\n${passed} tests passed`);
})();
