'use strict';

const calc = require('./attendanceCalculation.service');

const SKIP_REASONS = Object.freeze({
  LEAVE: 'approved_leave',
  HOLIDAY: 'holiday',
  WEEKEND: 'weekend',
  COMPANY_CLOSURE: 'company_closure',
});

async function findCompanyClosure(pool, dateStr) {
  const { rows } = await pool.query(
    `SELECT id, name, closure_date
     FROM company_closures
     WHERE closure_date = $1::date AND is_active = true
     LIMIT 1`,
    [dateStr],
  );
  return rows[0] || null;
}

/**
 * Determine if absent marking must be skipped for an employee on a date.
 * Uses attendance_settings (weekend), holiday_calendars/dates, leave_requests, company_closures.
 */
async function shouldSkipAbsentMarking(pool, employeeId, dateStr, settings) {
  const leave = await calc.findLeaveForDate(pool, employeeId, dateStr);
  if (leave) {
    return { skip: true, reason: SKIP_REASONS.LEAVE, detail: leave };
  }

  const holiday = await calc.findHolidayForDate(
    pool,
    dateStr,
    settings?.uk_holiday_region,
  );
  if (holiday) {
    return { skip: true, reason: SKIP_REASONS.HOLIDAY, detail: holiday };
  }

  if (calc.isWeekend(dateStr, settings)) {
    return { skip: true, reason: SKIP_REASONS.WEEKEND, detail: { weekend_mode: settings?.weekend_mode } };
  }

  const closure = await findCompanyClosure(pool, dateStr);
  if (closure) {
    return { skip: true, reason: SKIP_REASONS.COMPANY_CLOSURE, detail: closure };
  }

  return { skip: false, reason: null, detail: null };
}

/** True when the date is non-working for the whole tenant (no absent marks). */
async function isTenantNonWorkingDay(pool, dateStr, settings) {
  if (calc.isWeekend(dateStr, settings)) return true;
  const holiday = await calc.findHolidayForDate(pool, dateStr, settings?.uk_holiday_region);
  if (holiday) return true;
  const closure = await findCompanyClosure(pool, dateStr);
  if (closure) return true;
  return false;
}

module.exports = {
  SKIP_REASONS,
  findCompanyClosure,
  shouldSkipAbsentMarking,
  isTenantNonWorkingDay,
};
