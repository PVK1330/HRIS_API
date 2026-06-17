'use strict';

const repo = require('./attendance.repository');
const calc = require('./attendanceCalculation.service');
const graceEngine = require('./attendanceGrace.service');
const calendar = require('./attendanceCalendar.service');
const audit = require('./attendanceAudit.service');
const autoReject = require('./attendanceAutoReject.service');
const notify = require('./attendanceNotifications.service');
const logger = require('../../../utils/logger');

const CRON_DEVICE = 'attendance-cron';

async function logCron(pool, {
  action,
  attendanceId = null,
  employeeId = null,
  oldValue = null,
  newValue = null,
}) {
  await audit.log(pool, {
    attendanceId,
    employeeId,
    action,
    oldValue,
    newValue,
    performedBy: null,
    ipAddress: null,
    deviceInfo: CRON_DEVICE,
  });
}

/**
 * Base query: active, joined, onboarding-complete employees with no record yet.
 * Used by all three marking paths (weekly-off, holiday, absent).
 * The leave check is only added for the absent path.
 */
async function listEligibleEmployees(pool, dateStr, { excludeWithApprovedLeave = false } = {}) {
  const leaveClause = excludeWithApprovedLeave
    ? `AND NOT EXISTS (
         SELECT 1 FROM leave_requests lr
         WHERE lr.employee_id = e.id
           AND lr.status = 'Approved'
           AND lr.from_date <= $1::date
           AND lr.to_date   >= $1::date
       )`
    : '';

  const { rows } = await pool.query(
    `SELECT
       e.id                          AS employee_id,
       e.join_date,
       e.onboarding_workflow_status,
       e.shift_id
     FROM employees e
     WHERE e.deleted_at IS NULL
       AND e.employment_status IN ('Active', 'Probation')
       AND (e.join_date IS NULL OR e.join_date <= $1::date)
       AND (
         e.onboarding_workflow_status IS NULL
         OR e.onboarding_workflow_status = 'onboarding_complete'
       )
       ${leaveClause}
       AND NOT EXISTS (
         SELECT 1 FROM attendance a
         WHERE a.employee_id = e.id AND a.date = $1::date
       )`,
    [dateStr],
  );
  return rows;
}

// Convenience aliases used by the three marking paths
const listAbsentCandidates  = (pool, dateStr) => listEligibleEmployees(pool, dateStr, { excludeWithApprovedLeave: true });
const listWeeklyOffCandidates = (pool, dateStr) => listEligibleEmployees(pool, dateStr);
const listHolidayCandidates   = (pool, dateStr) => listEligibleEmployees(pool, dateStr);

/**
 * Bulk-upsert a fixed status for all employees in the list.
 * Used for Weekly Off and Holiday passes (no shift stamp needed — they didn't miss a shift).
 */
async function bulkMarkStatus(pool, employees, dateStr, { status, paidDay, auditAction }) {
  let marked = 0;
  for (const emp of employees) {
    const record = await repo.upsert(pool, {
      employeeId: emp.employee_id,
      date: dateStr,
      status,
      paidDay,
      workMode: 'In Office',
    });
    await logCron(pool, {
      action: auditAction,
      attendanceId: record.id,
      employeeId: emp.employee_id,
      newValue: { status, date: dateStr },
    });
    marked += 1;
  }
  return marked;
}

/**
 * Auto-mark attendance for ALL active employees for a given date.
 *
 * Priority:
 *   1. Weekend  → status = 'Weekend'   (Weekly Off, paid_day = false)
 *   2. Holiday  → status = 'Holiday'   (paid_day = true)
 *   3. Working day, no punch → status = 'Absent' (paid_day = false)
 *      • Skip if employee has an Approved leave (those become 'On Leave' via the leave flow)
 *      • Skip if it's a company closure day
 *
 * Employees are only eligible when:
 *   - Active / Probation
 *   - join_date <= date
 *   - onboarding_workflow_status is null or 'onboarding_complete'
 *   - No existing attendance record for the date
 */
async function processDailyAbsent(pool, dateStr) {
  const settings = await calc.loadSettings(pool);

  // ── 1. WEEKEND → mark Weekly Off ─────────────────────────────────────────
  if (calc.isWeekend(dateStr, settings)) {
    const candidates = await listWeeklyOffCandidates(pool, dateStr);
    const marked = await bulkMarkStatus(pool, candidates, dateStr, {
      status: 'Weekend',
      paidDay: false,
      auditAction: 'attendance.cron.weekly_off',
    });
    logger.info(`[attendanceCron] Weekly Off marked: ${marked} for ${dateStr}`);
    return { marked, weeklyOff: true };
  }

  // ── 2. HOLIDAY → mark Holiday ────────────────────────────────────────────
  const holiday = await calc.findHolidayForDate(pool, dateStr, settings?.uk_holiday_region);
  if (holiday) {
    const candidates = await listHolidayCandidates(pool, dateStr);
    const marked = await bulkMarkStatus(pool, candidates, dateStr, {
      status: 'Holiday',
      paidDay: true,
      auditAction: 'attendance.cron.holiday',
    });
    logger.info(`[attendanceCron] Holiday "${holiday.name}" marked: ${marked} for ${dateStr}`);
    return { marked, holiday: true, holidayName: holiday.name };
  }

  // ── 3. COMPANY CLOSURE → skip (no absent records on closure days) ────────
  const closure = await calendar.findCompanyClosure(pool, dateStr);
  if (closure) {
    return { marked: 0, skipped: true, reason: 'company_closure', closureName: closure.name };
  }

  // ── 4. WORKING DAY → mark Absent for employees who didn't punch ──────────
  //    Approved-leave employees are excluded (their 'On Leave' record is created
  //    by the leave-approval flow, not the cron).
  const candidates = await listAbsentCandidates(pool, dateStr);
  let marked = 0;

  for (const emp of candidates) {
    const { employee_id: employeeId } = emp;

    // Resolve scheduled shift (date-specific → employees.shift_id → default active).
    let resolvedShift = null;
    try {
      resolvedShift = await calc.getEmployeeShift(pool, employeeId, dateStr);
    } catch (shiftErr) {
      logger.warn('[attendanceCron] shift lookup failed', { employeeId, date: dateStr, err: shiftErr.message });
    }

    const record = await repo.upsert(pool, {
      employeeId,
      date: dateStr,
      status: 'Absent',
      paidDay: false,
      workMode: 'In Office',
    });

    // Stamp shift_id so reports know which shift was missed.
    if (resolvedShift?.id && record?.id) {
      try {
        await pool.query(
          `UPDATE attendance SET shift_id = $1 WHERE id = $2 AND shift_id IS NULL`,
          [resolvedShift.id, record.id],
        );
      } catch (e) {
        logger.warn('[attendanceCron] shift_id stamp failed', { recordId: record.id, err: e.message });
      }
    }

    await logCron(pool, {
      action: 'attendance.cron.absent',
      attendanceId: record.id,
      employeeId,
      newValue: {
        ...record,
        shift_id:   resolvedShift?.id   ?? null,
        shift_name: resolvedShift?.name ?? null,
        join_date:  emp.join_date,
      },
    });

    try {
      await notify.notifyAbsent(pool, null, { employeeId, date: dateStr });
    } catch (notifyErr) {
      logger.error('[attendanceCron] notifyAbsent failed', { employeeId, date: dateStr, err: notifyErr.message });
    }

    marked += 1;
  }

  return { marked, skipped: false };
}

async function computeRowMetrics(pool, row, dateStr, settings) {
  const monthlyLateCountBefore = await graceEngine.countMonthlyLateArrivalsBeforeDate(
    pool,
    row.employee_id,
    dateStr,
  );
  return calc.computeFromPunch({
    settings,
    shift: await calc.getEmployeeShift(pool, row.employee_id, dateStr),
    checkInTime: row.check_in_time,
    checkOutTime: row.check_out_time,
    workMode: row.work_mode,
    dateStr,
    leaveRecord: await calc.findLeaveForDate(pool, row.employee_id, dateStr),
    holidayRecord: await calc.findHolidayForDate(pool, dateStr, settings.uk_holiday_region),
    monthlyLateCountBefore,
  });
}

async function processLateRecalc(pool, dateStr) {
  const settings = await calc.loadSettings(pool);
  if (!settings?.late_mark_auto_calculation) {
    return { updated: 0, skipped: true };
  }

  const { rows } = await pool.query(
    `SELECT id, employee_id, check_in_time, check_out_time, work_mode, status
     FROM attendance
     WHERE date = $1::date AND check_in_time IS NOT NULL`,
    [dateStr],
  );

  let updated = 0;
  for (const row of rows) {
    const oldSnapshot = { status: row.status, id: row.id };
    const computed = await computeRowMetrics(pool, row, dateStr, settings);

    await pool.query(
      `UPDATE attendance
       SET status = $1, is_late = $2, late_minutes = $3,
           worked_hours = $4, total_hours = $4, overtime_hours = $5,
           updated_at = NOW()
       WHERE id = $6`,
      [
        computed.status,
        computed.is_late,
        computed.late_minutes,
        computed.worked_hours,
        computed.overtime_hours,
        row.id,
      ],
    );

    await logCron(pool, {
      action: 'attendance.cron.late_recalc',
      attendanceId: row.id,
      employeeId: row.employee_id,
      oldValue: oldSnapshot,
      newValue: computed,
    });
    updated += 1;
  }

  return { updated, skipped: false };
}

async function processOvertimeRecalc(pool, dateStr, tenantDb = null) {
  const settings = await calc.loadSettings(pool);
  if (!settings?.overtime_eligibility) {
    return { updated: 0, skipped: true };
  }

  const { rows } = await pool.query(
    `SELECT id, employee_id, check_in_time, check_out_time, work_mode, overtime_hours
     FROM attendance
     WHERE date = $1::date
       AND check_in_time IS NOT NULL
       AND check_out_time IS NOT NULL`,
    [dateStr],
  );

  let updated = 0;
  for (const row of rows) {
    const computed = await computeRowMetrics(pool, row, dateStr, settings);
    const oldOt = row.overtime_hours;

    await pool.query(
      `UPDATE attendance SET overtime_hours = $1, updated_at = NOW() WHERE id = $2`,
      [computed.overtime_hours, row.id],
    );

    await logCron(pool, {
      action: 'attendance.cron.ot_recalc',
      attendanceId: row.id,
      employeeId: row.employee_id,
      oldValue: { overtime_hours: oldOt },
      newValue: {
        overtime_hours: computed.overtime_hours,
        overtime_multiplier: computed.overtime_multiplier,
        overtime_raw_hours: computed.overtime_raw_hours,
      },
    });

    // Newly-detected overtime requires manager approval — raise a pending request and
    // notify the reporting manager (idempotent: markOvertimePending only fires from 'None',
    // and notifyOtRequested de-dupes). It is NOT auto-approved.
    if (computed.overtime_hours > 0 && computed.overtime_hours !== oldOt) {
      try {
        const flagged = await repo.markOvertimePending(pool, row.id);
        if (flagged && tenantDb) {
          await notify.notifyOtRequested(pool, tenantDb, {
            employeeId: row.employee_id,
            date: dateStr,
            entityId: row.id,
            hours: computed.overtime_hours,
          });
        }
      } catch (e) { /* non-blocking */ }
    }

    updated += 1;
  }

  return { updated, skipped: false };
}

async function processAttendanceSummary(pool, dateStr) {
  const { rows: empCount } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM employees WHERE deleted_at IS NULL
       AND employment_status IN ('Active', 'Probation')`,
  );

  const { rows: agg } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE a.status IN ('Present','Late','Remote','Work From Home','Field Duty'))::int AS present_count,
       COUNT(*) FILTER (WHERE a.status = 'Absent')::int AS absent_count,
       COUNT(*) FILTER (WHERE a.is_late = true)::int AS late_count,
       COUNT(*) FILTER (WHERE a.status = 'On Leave')::int AS on_leave_count,
       COUNT(*) FILTER (WHERE a.status = 'Holiday')::int AS holiday_count,
       COUNT(*) FILTER (WHERE a.status = 'Weekend')::int AS weekend_count,
       COUNT(*) FILTER (WHERE a.work_mode = 'Remote')::int AS remote_count,
       COUNT(*) FILTER (WHERE a.work_mode = 'In Office')::int AS in_office_count,
       COUNT(*) FILTER (WHERE a.regularization_status = 'Pending')::int AS pending_regularization,
       COUNT(*) FILTER (
         WHERE a.check_in_time IS NOT NULL AND a.check_out_time IS NULL
           AND a.status NOT IN ('On Leave','Holiday','Weekend','Absent')
       )::int AS missing_checkout
     FROM attendance a
     JOIN employees e ON e.id = a.employee_id AND e.deleted_at IS NULL
     WHERE a.date = $1::date`,
    [dateStr],
  );

  const summary = {
    ...agg[0],
    total_employees: empCount[0].total,
    summary_date: dateStr,
  };

  const { rows } = await pool.query(
    `INSERT INTO attendance_daily_summaries
       (summary_date, present_count, absent_count, late_count, on_leave_count,
        holiday_count, weekend_count, remote_count, in_office_count,
        pending_regularization, missing_checkout, total_employees, summary_payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
     ON CONFLICT (summary_date) DO UPDATE SET
       present_count = EXCLUDED.present_count,
       absent_count = EXCLUDED.absent_count,
       late_count = EXCLUDED.late_count,
       on_leave_count = EXCLUDED.on_leave_count,
       holiday_count = EXCLUDED.holiday_count,
       weekend_count = EXCLUDED.weekend_count,
       remote_count = EXCLUDED.remote_count,
       in_office_count = EXCLUDED.in_office_count,
       pending_regularization = EXCLUDED.pending_regularization,
       missing_checkout = EXCLUDED.missing_checkout,
       total_employees = EXCLUDED.total_employees,
       summary_payload = EXCLUDED.summary_payload,
       generated_at = NOW()
     RETURNING id`,
    [
      dateStr,
      summary.present_count,
      summary.absent_count,
      summary.late_count,
      summary.on_leave_count,
      summary.holiday_count,
      summary.weekend_count,
      summary.remote_count,
      summary.in_office_count,
      summary.pending_regularization,
      summary.missing_checkout,
      summary.total_employees,
      JSON.stringify(summary),
    ],
  );

  await logCron(pool, {
    action: 'attendance.cron.summary',
    newValue: { summaryId: rows[0]?.id, ...summary },
  });

  return { summaryId: rows[0]?.id, ...summary };
}

async function processMonthlyClosure(pool, year, month) {
  const { rows: before } = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM attendance
     WHERE EXTRACT(YEAR FROM date) = $1 AND EXTRACT(MONTH FROM date) = $2
       AND is_closed = false`,
    [year, month],
  );

  const { rowCount } = await pool.query(
    `UPDATE attendance SET is_closed = true, updated_at = NOW()
     WHERE EXTRACT(YEAR FROM date) = $1 AND EXTRACT(MONTH FROM date) = $2
       AND is_closed = false`,
    [year, month],
  );

  await logCron(pool, {
    action: 'attendance.cron.month_close',
    newValue: { year, month, records_closed: rowCount, open_before: before[0].cnt },
  });

  return { records_closed: rowCount };
}

async function processMissingCheckoutNotifications(pool, tenantDb, dateStr) {
  const { rows } = await pool.query(
    `SELECT a.id, a.employee_id, TO_CHAR(a.date, 'YYYY-MM-DD') as date
     FROM attendance a
     JOIN employees e ON e.id = a.employee_id AND e.deleted_at IS NULL
     WHERE a.date = $1::date
       AND a.check_in_time IS NOT NULL 
       AND a.check_out_time IS NULL
       AND a.status NOT IN ('On Leave', 'Holiday', 'Weekend', 'Absent')`,
    [dateStr]
  );

  let notified = 0;
  for (const row of rows) {
    try {
      await notify.notifyMissingCheckout(pool, tenantDb, {
        employeeId: row.employee_id,
        date: row.date,
        entityId: row.id
      });
      notified++;
    } catch (notifyErr) {
      logger.error('[attendanceCron] notifyMissingCheckout failed', { employeeId: row.employee_id, date: row.date, err: notifyErr.message });
    }
  }
  return { notified };
}

async function processAutoReject(pool, tenantDb) {
  return autoReject.processAutoRejections(pool, tenantDb, { skipBatchAudit: true });
}

async function processAutoApprove(pool, tenantDb) {
  return autoReject.processAutoApprovals(pool, tenantDb);
}

module.exports = {
  processDailyAbsent,
  processLateRecalc,
  processOvertimeRecalc,
  processAttendanceSummary,
  processMonthlyClosure,
  processAutoReject,
  processAutoApprove,
  processMissingCheckoutNotifications,
  listAbsentCandidates,
  listEligibleEmployees,
  // legacy alias
  listActiveEmployeesWithoutAttendance: listAbsentCandidates,
};
