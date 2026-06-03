'use strict';

const repo = require('./attendance.repository');
const calc = require('./attendanceCalculation.service');
const graceEngine = require('./attendanceGrace.service');
const calendar = require('./attendanceCalendar.service');
const audit = require('./attendanceAudit.service');
const autoReject = require('./attendanceAutoReject.service');

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

async function listActiveEmployeesWithoutAttendance(pool, dateStr) {
  const { rows } = await pool.query(
    `SELECT e.id AS employee_id
     FROM employees e
     WHERE e.deleted_at IS NULL
       AND e.employment_status IN ('Active', 'Probation')
       AND NOT EXISTS (
         SELECT 1 FROM attendance a
         WHERE a.employee_id = e.id AND a.date = $1::date
       )`,
    [dateStr],
  );
  return rows;
}

/**
 * Mark absent only when not leave, holiday, weekend, or company closure.
 */
async function processDailyAbsent(pool, dateStr) {
  const settings = await calc.loadSettings(pool);

  if (await calendar.isTenantNonWorkingDay(pool, dateStr, settings)) {
    return { marked: 0, skipped: true, reason: 'tenant_non_working_day' };
  }

  const candidates = await listActiveEmployeesWithoutAttendance(pool, dateStr);
  let marked = 0;

  for (const { employee_id: employeeId } of candidates) {
    const skip = await calendar.shouldSkipAbsentMarking(pool, employeeId, dateStr, settings);
    if (skip.skip) continue;

    const record = await repo.upsert(pool, {
      employeeId,
      date: dateStr,
      status: 'Absent',
      paidDay: false,
      workMode: 'In Office',
    });

    await logCron(pool, {
      action: 'attendance.cron.absent',
      attendanceId: record.id,
      employeeId,
      newValue: record,
    });
    
    try {
      await notify.notifyAbsent(pool, null, {
        employeeId,
        date: dateStr
      });
    } catch (e) {}

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

async function processOvertimeRecalc(pool, dateStr) {
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

    if (computed.overtime_hours > 0 && computed.overtime_hours !== oldOt) {
      try {
        const notify = require('./attendanceNotifications.service');
        await notify.notifyOtApproved(pool, null, {
          employeeId: row.employee_id,
          date: dateStr,
          entityId: row.id,
          hours: computed.overtime_hours
        });
      } catch(e) {}
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
    } catch (e) {}
  }
  return { notified };
}

async function processAutoReject(pool, tenantDb) {
  return autoReject.processAutoRejections(pool, tenantDb, { skipBatchAudit: true });
}

module.exports = {
  processDailyAbsent,
  processLateRecalc,
  processOvertimeRecalc,
  processAttendanceSummary,
  processMonthlyClosure,
  processAutoReject,
  processMissingCheckoutNotifications,
  listActiveEmployeesWithoutAttendance,
};
