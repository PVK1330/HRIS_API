'use strict';

/**
 * Monthly grace-day engine — limits from attendance_settings.grace_days_per_month only.
 */

function monthYearFromDate(dateStr) {
  const [y, m] = String(dateStr).slice(0, 10).split('-').map(Number);
  return { year: y, month: m };
}

/**
 * Count late arrivals in calendar month before dateStr (excludes dateStr itself).
 */
async function countMonthlyLateArrivalsBeforeDate(pool, employeeId, dateStr) {
  const { year, month } = monthYearFromDate(dateStr);
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS cnt
     FROM attendance
     WHERE employee_id = $1
       AND EXTRACT(YEAR FROM date) = $2
       AND EXTRACT(MONTH FROM date) = $3
       AND date < $4::date
       AND late_minutes > 0`,
    [employeeId, year, month, dateStr],
  );
  return rows[0]?.cnt ?? 0;
}

/**
 * Apply grace_days_per_month to raw late detection.
 * @returns {{ status, is_late, grace_applied }}
 */
function applyGraceToLateStatus({
  settings,
  rawStatus,
  lateMinutes,
  monthlyLateCountBefore,
  workedHours,
  minPresent,
}) {
  const graceDays = Number(settings?.grace_days_per_month ?? 0);
  const hasLateArrival = lateMinutes > 0;

  if (!hasLateArrival || settings?.late_mark_auto_calculation === false) {
    return { status: rawStatus, is_late: hasLateArrival, grace_applied: false };
  }

  const arrivalIndex = monthlyLateCountBefore + 1;

  if (graceDays > 0 && arrivalIndex <= graceDays) {
    let status = 'Present';
    if (workedHours > 0 && workedHours < minPresent) {
      const rule = String(settings?.early_departure_rule || '').toLowerCase();
      if (rule.includes('half')) status = 'Half Day';
    }
    return { status, is_late: false, grace_applied: true };
  }

  let status = workedHours > 0 && workedHours < minPresent ? 'Half Day' : 'Late';
  return { status, is_late: true, grace_applied: false };
}

module.exports = {
  countMonthlyLateArrivalsBeforeDate,
  applyGraceToLateStatus,
  monthYearFromDate,
};
