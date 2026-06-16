'use strict';

const settingsRepo = require('../../attendanceSettings/attendanceSettings.repository');
const graceEngine = require('./attendanceGrace.service');
const overtimeEngine = require('./attendanceOvertime.service');
const integrity = require('./attendanceIntegrity.service');

function parseTimeToMinutes(t) {
  if (!t) return null;
  const s = String(t).slice(0, 5);
  const [h, m] = s.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function minutesToHours(mins) {
  if (mins == null || mins <= 0) return 0;
  return parseFloat((mins / 60).toFixed(2));
}

function getDayOfWeek(dateStr) {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay();
}

function isWeekend(dateStr, settings) {
  const dow = getDayOfWeek(dateStr);
  // Prefer the explicit Work Week list (General settings, e.g. "Mon,Tue,Wed,Thu,Fri"):
  // any weekday NOT in it is a non-working day.
  const workWeek = settings?.work_week_days;
  if (workWeek && String(workWeek).trim()) {
    const NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const working = new Set(String(workWeek).split(',').map((d) => d.trim()));
    if (working.size) return !working.has(NAMES[dow]);
  }
  const mode = settings?.weekend_mode || 'Saturday/Sunday';
  if (mode === 'Sunday Only') return dow === 0;
  if (mode === 'Custom Week Off') {
    const days = settings?.custom_week_off_days || [0, 6];
    return days.includes(dow);
  }
  return dow === 0 || dow === 6;
}

async function loadSettings(pool) {
  let s = await settingsRepo.getSettings(pool);
  if (!s) s = await settingsRepo.seedDefault(pool);
  return s;
}

async function findLeaveForDate(pool, employeeId, dateStr) {
  const { rows } = await pool.query(
    `SELECT id, leave_type, status
     FROM leave_requests
     WHERE employee_id = $1
       AND status = 'Approved'
       AND from_date <= $2::date
       AND to_date >= $2::date
     LIMIT 1`,
    [employeeId, dateStr],
  );
  return rows[0] || null;
}

async function findHolidayForDate(pool, dateStr, region) {
  const reg = region || 'England';
  const year = parseInt(String(dateStr).slice(0, 4), 10);
  const { rows } = await pool.query(
    `SELECT hd.name, hc.region
     FROM holiday_dates hd
     JOIN holiday_calendars hc ON hc.id = hd.calendar_id
     WHERE hd.holiday_date = $1::date
       -- Match the tenant's configured UK region OR any tenant-wide ('Global')
       -- calendar. Holidays added through the Settings → Holidays UI are stored
       -- under the 'Global' region, so without this they would never apply.
       AND (hc.region = $2 OR hc.region = 'Global')
       AND hc.year = $3
       AND hc.is_active = true
     ORDER BY (hc.region = $2) DESC
     LIMIT 1`,
    [dateStr, reg, year],
  );
  return rows[0] || null;
}

async function getEmployeeShift(pool, employeeId, dateStr) {
  // 1. Date-specific assignment overrides everything (e.g. temporary shift change)
  const { rows: esa } = await pool.query(
    `SELECT s.*
     FROM employee_shift_assignments esa
     JOIN shifts s ON s.id = esa.shift_id
     WHERE esa.employee_id = $1
       AND esa.effective_from <= $2::date
       AND (esa.effective_to IS NULL OR esa.effective_to >= $2::date)
     ORDER BY esa.effective_from DESC
     LIMIT 1`,
    [employeeId, dateStr],
  );
  if (esa[0]) return esa[0];

  // 2. Employee's directly assigned shift (employees.shift_id)
  const { rows: direct } = await pool.query(
    `SELECT s.*
     FROM employees e
     JOIN shifts s ON s.id = e.shift_id
     WHERE e.id = $1 AND e.deleted_at IS NULL AND s.is_active = true
     LIMIT 1`,
    [employeeId],
  );
  if (direct[0]) return direct[0];

  // 3. System default: first active shift
  const { rows: def } = await pool.query(
    `SELECT * FROM shifts WHERE is_active = true ORDER BY id ASC LIMIT 1`,
  );
  return def[0] || null;
}

/**
 * Compute attendance metrics from punch times and tenant settings.
 */
function computeFromPunch({
  settings,
  shift,
  checkInTime,
  checkOutTime,
  workMode,
  dateStr,
  leaveRecord,
  holidayRecord,
  monthlyLateCountBefore = 0,
}) {
  if (leaveRecord) {
    return {
      status: 'On Leave',
      leave_type: leaveRecord.leave_type,
      worked_hours: 0,
      break_hours: 0,
      total_hours: 0,
      overtime_hours: 0,
      late_minutes: 0,
      early_departure_minutes: 0,
      is_late: false,
      early_departure: false,
      paid_day: true,
    };
  }

  if (holidayRecord) {
    return {
      status: 'Holiday',
      holiday_region: holidayRecord.region,
      worked_hours: 0,
      break_hours: 0,
      total_hours: 0,
      overtime_hours: 0,
      late_minutes: 0,
      early_departure_minutes: 0,
      is_late: false,
      early_departure: false,
      paid_day: true,
    };
  }

  if (isWeekend(dateStr, settings)) {
    return {
      status: 'Weekend',
      worked_hours: 0,
      break_hours: 0,
      total_hours: 0,
      overtime_hours: 0,
      late_minutes: 0,
      early_departure_minutes: 0,
      is_late: false,
      early_departure: false,
      paid_day: false,
    };
  }

  const workStart = parseTimeToMinutes(shift?.start_time || settings?.work_start_time);
  const workEnd = parseTimeToMinutes(shift?.end_time || settings?.work_end_time);
  const breakMins = shift?.break_minutes ?? settings?.break_duration_minutes ?? 30;
  const graceMins = shift?.grace_minutes ?? settings?.grace_period_minutes ?? 0;
  const bufferMins = settings?.ten_minute_buffer ? 10 : 0;
  const minPresent = Number(
    shift?.minimum_hours ?? settings?.min_hours_for_present ?? 6,
  );
  // Half-day lower bound: hours >= halfDayMin and < minPresent = half day
  const halfDayMin = settings?.half_day_min_hours != null
    ? Number(settings.half_day_min_hours)
    : (settings?.half_day_threshold_hours != null ? Number(settings.half_day_threshold_hours) : minPresent / 2);
  // Half-day threshold used for late-mark vs half-day decision
  const halfDayThreshold = settings?.half_day_min_hours != null
    ? Number(settings.half_day_min_hours)
    : (settings?.half_day_threshold_hours != null ? Number(settings.half_day_threshold_hours) : minPresent);
  // Absent threshold: worked hours below this = absent (even with a punch)
  const absentBelowHours = settings?.absent_below_hours != null
    ? Number(settings.absent_below_hours)
    : 0;
  // Automated Quota Calculus: when enabled, derive the required daily hours from
  // the operational window (end − start − break) instead of the manual quota.
  // Falls back to the manual value if the window can't be resolved.
  let requiredHours = Number(settings?.total_required_hours ?? 8);
  if (settings?.auto_calculate_hours === true && workStart != null && workEnd != null) {
    let windowMins = workEnd - workStart;
    if (windowMins < 0) windowMins += 24 * 60; // overnight window
    const derived = minutesToHours(Math.max(0, windowMins - breakMins));
    if (derived > 0) requiredHours = derived;
  }
  const otAfter = Number(shift?.overtime_after_hours ?? requiredHours);
  const otEligible = settings?.overtime_eligibility === true;

  const inMins = parseTimeToMinutes(checkInTime);
  const outMins = parseTimeToMinutes(checkOutTime);

  let workedMins = 0;
  if (inMins != null && outMins != null) {
    let diff = outMins - inMins;
    if (shift?.is_night_shift && diff < 0) diff += 24 * 60;
    workedMins = Math.max(0, diff - breakMins);
  }

  const workedHours = minutesToHours(workedMins);
  const breakHours = minutesToHours(breakMins);
  const totalHours = workedHours;

  let lateMinutes = 0;
  if (inMins != null && workStart != null) {
    const allowedStart = workStart + graceMins + bufferMins;
    if (inMins > allowedStart) lateMinutes = inMins - allowedStart;
  }

  let earlyDepartureMinutes = 0;
  if (outMins != null && workEnd != null && outMins < workEnd) {
    earlyDepartureMinutes = workEnd - outMins;
  }

  let rawOvertimeHours = 0;
  if (otEligible && workedHours > otAfter) {
    rawOvertimeHours = parseFloat((workedHours - otAfter).toFixed(2));
  }
  const otResult = overtimeEngine.calculateOvertimeHours(settings, rawOvertimeHours);

  let status = 'Present';
  const mode = workMode || 'In Office';
  if (mode === 'Remote') status = 'Remote';
  else if (mode === 'Field' || mode === 'Field Duty') status = 'Field Duty';
  else if (mode === 'Work From Home') status = 'Work From Home';

  let graceApplied = false;
  let isLate = false;
  const lateMarkEnabled = settings?.enable_late_mark !== false && settings?.late_mark_auto_calculation !== false;
  const autoMarkAbsent = settings?.auto_mark_absent !== false;

  if (!checkInTime && !checkOutTime) {
    // No punch at all — absent only if auto_mark_absent is on
    status = autoMarkAbsent ? 'Absent' : 'Present';
  } else if (absentBelowHours > 0 && workedHours < absentBelowHours && workedHours > 0) {
    // Punched but too few hours — treat as absent per policy
    status = 'Absent';
  } else if (lateMinutes > 0 && lateMarkEnabled) {
    const rawLateStatus = workedHours < halfDayThreshold ? 'Half Day' : 'Late';
    const graceResult = graceEngine.applyGraceToLateStatus({
      settings,
      rawStatus: rawLateStatus,
      lateMinutes,
      monthlyLateCountBefore,
      workedHours,
      minPresent: halfDayThreshold,
    });
    status = graceResult.status;
    isLate = graceResult.is_late;
    graceApplied = graceResult.grace_applied;

    // Apply monthly late penalty tiers (e.g. 3 lates → Half Day, 6 lates → 1 Leave Deduction)
    if (isLate) {
      const penaltyResult = graceEngine.getPenaltyForLateCount(settings, monthlyLateCountBefore + 1);
      if (penaltyResult && penaltyResult !== 'None') {
        status = penaltyResult;
      }
    }
  }

  if (workedHours > 0 && workedHours < halfDayThreshold && status !== 'Late' && status !== 'Absent') {
    const rule = settings?.early_departure_rule || 'Mark half day';
    if (rule.toLowerCase().includes('half')) status = 'Half Day';
    else if (earlyDepartureMinutes > 0) status = 'Half Day';
  }

  if (workedHours === 0 && (checkInTime || checkOutTime)) {
    status = 'Half Day';
  }

  const raw = {
    status,
    worked_hours: workedHours,
    break_hours: breakHours,
    total_hours: totalHours,
    overtime_hours: otResult.overtime_hours,
    overtime_raw_hours: otResult.raw_hours,
    overtime_multiplier: otResult.multiplier,
    late_minutes: lateMinutes,
    early_departure_minutes: earlyDepartureMinutes,
    is_late: isLate,
    early_departure: earlyDepartureMinutes > 0,
    paid_day: status !== 'Absent',
    grace_applied: graceApplied,
  };

  return integrity.sanitizeMetrics(raw, checkInTime, checkOutTime, 'N/A');
}

module.exports = {
  loadSettings,
  findLeaveForDate,
  findHolidayForDate,
  getEmployeeShift,
  computeFromPunch,
  isWeekend,
  parseTimeToMinutes,
  graceEngine,
  overtimeEngine,
};
