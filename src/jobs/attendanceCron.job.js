'use strict';

const cron = require('node-cron');
const logger = require('../utils/logger');
const { superAdminPool, getTenantPool } = require('../config/db');
const { runTenantMigrations } = require('../modules/tenant/tenant.service');
const cronService = require('../modules/employees/attendance/attendanceCron.service');
const notify = require('../modules/employees/attendance/attendanceNotifications.service');
const holidaysService = require('../modules/holidays/holidays.service');

function yesterdayStr() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split('T')[0];
}

async function processMissingCheckout(pool, tenantDb, dateStr) {
  const { rows } = await pool.query(
    `SELECT a.id, a.employee_id, e.full_name
     FROM attendance a
     JOIN employees e ON e.id = a.employee_id
     WHERE a.date = $1::date
       AND a.check_in_time IS NOT NULL
       AND a.check_out_time IS NULL
       AND a.status NOT IN ('On Leave','Holiday','Weekend','Absent')`,
    [dateStr],
  );
  for (const row of rows) {
    try {
      await notify.notifyMissingCheckout(pool, tenantDb, {
        employeeId: row.employee_id,
        date: dateStr,
        entityId: row.id,
      });
    } catch (e) {
      logger.warn(`[attendanceCron] missing-checkout notify failed for record ${row.id}`, e.message);
    }
  }
}

async function processTenant(tenant) {
  const pool = getTenantPool(tenant.db_name);
  await runTenantMigrations(tenant.db_name);
  const yday = yesterdayStr();

  const absentResult = await cronService.processDailyAbsent(pool, yday);
  if (absentResult.marked > 0) {
    logger.info(`[attendanceCron] Marked ${absentResult.marked} absent for ${yday}`);
  } else if (absentResult.skipped) {
    logger.debug(`[attendanceCron] Skipped absent marking for ${yday} (${absentResult.reason})`);
  }

  const lateResult = await cronService.processLateRecalc(pool, yday);
  if (lateResult.updated > 0) {
    logger.info(`[attendanceCron] Late recalc updated ${lateResult.updated} for ${yday}`);
  }

  const otResult = await cronService.processOvertimeRecalc(pool, yday, tenant.db_name);
  if (otResult.updated > 0) {
    logger.info(`[attendanceCron] OT recalc updated ${otResult.updated} for ${yday}`);
  }

  await cronService.processAttendanceSummary(pool, yday);
  await processMissingCheckout(pool, tenant.db_name, yday);

  try {
    const reminder = await holidaysService.sendUpcomingReminders(pool, tenant.db_name, 7);
    if (reminder.reminded > 0) {
      logger.info(`[attendanceCron] Holiday reminders sent: ${reminder.reminded}`);
    }
  } catch (e) {
    logger.warn(`[attendanceCron] Holiday reminders skipped for ${tenant.db_name}`, e.message);
  }

  // Auto-approve manager-absent regularizations BEFORE auto-reject so a request
  // that advances past the absent manager isn't also caught by the reject sweep.
  const approveResult = await cronService.processAutoApprove(pool, tenant.db_name);
  if (approveResult.approved > 0) {
    logger.info(`[attendanceCron] Auto-approved ${approveResult.approved} manager-absent regularizations`);
  }

  const rejectResult = await cronService.processAutoReject(pool, tenant.db_name);
  if (rejectResult.rejected > 0) {
    logger.info(`[attendanceCron] Auto-rejected ${rejectResult.rejected} stale regularizations`);
  }

  const now = new Date();
  if (now.getUTCDate() === 1) {
    const prevMonth = now.getUTCMonth() === 0 ? 12 : now.getUTCMonth();
    const prevYear = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
    const closeResult = await cronService.processMonthlyClosure(pool, prevYear, prevMonth);
    logger.info(
      `[attendanceCron] Month close ${prevYear}-${prevMonth}: ${closeResult.records_closed} records`,
    );
  }
}

async function runAllTenants() {
  const { rows: tenants } = await superAdminPool.query(
    `SELECT db_name FROM tenants WHERE status = 'active' AND db_name IS NOT NULL`,
  );
  for (const t of tenants) {
    try {
      await processTenant(t);
    } catch (e) {
      logger.error(`[attendanceCron] tenant=${t.db_name} failed`, e);
    }
  }
}

function startAttendanceCron() {
  if (process.env.DISABLE_ATTENDANCE_CRON === 'true') {
    logger.debug('Attendance cron disabled');
    return;
  }
  cron.schedule('15 1 * * *', () => {
    runAllTenants().catch((e) => logger.error('[attendanceCron] run failed', e));
  });
  logger.info('[attendanceCron] scheduled daily at 01:15 UTC');
}

module.exports = {
  startAttendanceCron,
  runAllTenants,
  processTenant,
  yesterdayStr,
};
