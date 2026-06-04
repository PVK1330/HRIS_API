'use strict';

const cron = require('node-cron');
const logger = require('../utils/logger');
const { superAdminPool, getTenantPool } = require('../config/db');
const { runTenantMigrations } = require('../modules/tenant/tenant.service');
const carryForward = require('../modules/employees/leave/leaveCarryForward.service');

async function processTenant(tenant, targetYear) {
  const pool = await getTenantPool(tenant.db_name);
  await runTenantMigrations(tenant.db_name);
  const result = await carryForward.processCarryForward(pool, targetYear);
  if (result.processed > 0) {
    logger.info(
      `[leaveCarryForward] tenant=${tenant.db_name} ${result.prevYear}→${result.targetYear}: ` +
      `processed ${result.processed}, carried ${result.carried}`,
    );
  }
  return result;
}

async function runAllTenants(targetYear) {
  const year = parseInt(targetYear, 10) || new Date().getFullYear();
  logger.info(`[leaveCarryForward] run start for year ${year}`);
  const { rows: tenants } = await superAdminPool.query(
    `SELECT db_name FROM tenants WHERE status = 'active' AND db_name IS NOT NULL`,
  );
  for (const t of tenants) {
    try {
      await processTenant(t, year);
    } catch (e) {
      logger.error(`[leaveCarryForward] tenant=${t.db_name} failed`, e);
    }
  }
  logger.info('[leaveCarryForward] run complete');
}

function startLeaveCarryForwardCron() {
  if (process.env.DISABLE_LEAVE_CARRY_FORWARD_CRON === 'true') {
    logger.debug('Leave carry-forward cron disabled');
    return null;
  }
  const opts = {};
  if (process.env.TZ) opts.timezone = process.env.TZ;
  // 00:30 on Jan 1 — roll unused balances into the new (current) leave year.
  const scheduled = cron.schedule('30 0 1 1 *', () => {
    runAllTenants().catch((e) => logger.error('[leaveCarryForward] run failed', e));
  }, opts);
  logger.info('[leaveCarryForward] scheduled yearly on Jan 1 at 00:30');
  return scheduled;
}

module.exports = { startLeaveCarryForwardCron, runAllTenants, processTenant };
