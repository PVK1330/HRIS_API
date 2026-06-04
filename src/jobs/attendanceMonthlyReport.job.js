'use strict';

const cron = require('node-cron');
const logger = require('../utils/logger');
const { superAdminPool, getTenantPool } = require('../config/db');
const { runTenantMigrations } = require('../modules/tenant/tenant.service');
const reportService = require('../modules/employees/attendance/attendanceMonthlyReport.service');

/** The month immediately before `now` as { year, month(1-12) }. */
function previousMonth(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-11 → this is already last month in 1-based terms
  if (m === 0) return { year: y - 1, month: 12 };
  return { year: y, month: m };
}

async function processTenant(tenant, year, month) {
  const pool = await getTenantPool(tenant.db_name);
  await runTenantMigrations(tenant.db_name);
  const result = await reportService.emailMonthlyReports(pool, tenant.db_name, year, month);
  if (result.emailsSent > 0 || result.departments > 0) {
    logger.info(
      `[attendanceMonthlyReport] tenant=${tenant.db_name} ${year}-${month}: ` +
      `${result.departments} dept(s), ${result.emailsSent} email(s), ${result.skipped} skipped`,
    );
  }
  return result;
}

async function runAllTenants(year, month) {
  let y = year;
  let m = month;
  if (!y || !m) { const p = previousMonth(); y = p.year; m = p.month; }
  logger.info(`[attendanceMonthlyReport] run start for ${y}-${m}`);
  const { rows: tenants } = await superAdminPool.query(
    `SELECT db_name FROM tenants WHERE status = 'active' AND db_name IS NOT NULL`,
  );
  for (const t of tenants) {
    try {
      await processTenant(t, y, m);
    } catch (e) {
      logger.error(`[attendanceMonthlyReport] tenant=${t.db_name} failed`, e);
    }
  }
  logger.info('[attendanceMonthlyReport] run complete');
}

function startAttendanceMonthlyReportCron() {
  if (process.env.DISABLE_ATTENDANCE_MONTHLY_REPORT_CRON === 'true') {
    logger.debug('Attendance monthly report cron disabled');
    return null;
  }
  const opts = {};
  if (process.env.TZ) opts.timezone = process.env.TZ;
  // 02:00 on the 1st of every month — email the previous month's late/early-exit report.
  const scheduled = cron.schedule('0 2 1 * *', () => {
    runAllTenants().catch((e) => logger.error('[attendanceMonthlyReport] run failed', e));
  }, opts);
  logger.info('[attendanceMonthlyReport] scheduled monthly on the 1st at 02:00');
  return scheduled;
}

module.exports = { startAttendanceMonthlyReportCron, runAllTenants, processTenant, previousMonth };
