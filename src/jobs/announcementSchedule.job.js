'use strict';

const cron = require('node-cron');
const logger = require('../utils/logger');
const { superAdminPool, getTenantPool } = require('../config/db');
const { runTenantMigrations } = require('../modules/tenant/tenant.service');
const service = require('../modules/announcements/announcements.service');

async function processAllTenants() {
  const { rows: tenants } = await superAdminPool.query(
    `SELECT id, db_name, admin_email, name, status FROM public.tenants WHERE status = 'active'`,
  );

  let total = 0;
  for (const tenant of tenants) {
    try {
      await runTenantMigrations(tenant.db_name).catch(() => {});
      const pool = getTenantPool(tenant.db_name);
      const n = await service.processScheduledForTenant(
        { dbName: tenant.db_name, adminEmail: tenant.admin_email, id: tenant.id },
        pool,
      );
      if (n > 0) {
        logger.info(`[announcementSchedule] published ${n} scheduled announcement(s) for ${tenant.db_name}`);
        total += n;
      }
    } catch (err) {
      logger.error(`[announcementSchedule] tenant ${tenant.db_name} failed:`, err.message);
    }
  }
  return total;
}

function startAnnouncementScheduleCron() {
  cron.schedule('* * * * *', () => {
    processAllTenants().catch((err) => {
      logger.error('[announcementSchedule] cron error:', err);
    });
  });
  logger.info('[announcementSchedule] Cron registered (runs every minute)');
}

module.exports = { startAnnouncementScheduleCron, processAllTenants };
