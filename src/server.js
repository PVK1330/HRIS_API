'use strict';

const http = require('http');
const app = require('./app');
const env = require('./config/env');
const db = require('./config/db');
const logger = require('./utils/logger');
const { initSocket } = require('./socket');
const {
  runSuperAdminMigrations,
  runPendingTenantMigrationsForAllActiveTenants,
} = require('./scripts/runMigrations');

async function bootstrap() {
  logger.debug(`Starting HRS backend (env=${env.NODE_ENV})...`);

  await db.assertDbConnection();

  logger.debug('Running SuperAdmin migrations...');
  const result = await runSuperAdminMigrations();
  logger.debug(`SuperAdmin migrations finished (applied=${result.applied}, skipped=${result.skipped}).`);

  logger.debug('Running pending tenant DB migrations for active tenants...');
  const tenantResult = await runPendingTenantMigrationsForAllActiveTenants();
  logger.debug(`Tenant migrations sweep finished (tenantsProcessed=${tenantResult.tenantsProcessed}).`);

  // Create HTTP server and attach socket.io to the same port
  const server = http.createServer(app);
  const io = initSocket(server);

  server.listen(env.PORT, () => {
    logger.info(`Running on port ${env.PORT}`);
    logger.debug('Available routes:');
    logger.debug('  POST /api/v1/superadmin/login');
    logger.debug('  POST /api/v1/tenants/create   (Bearer SuperAdmin JWT)');
    logger.debug('  GET  /api/v1/settings/*       (Bearer SuperAdmin JWT)');
    logger.debug('  GET  /uploads/logos/*         (static logo files)');
    logger.debug('  GET  /health');

    if (process.env.DISABLE_VISA_EXPIRY_CRON !== 'true') {
      try {
        const { startVisaExpiryAlertCron } = require('./jobs/visaExpiryAlert.job');
        startVisaExpiryAlertCron();
      } catch (e) {
        logger.error('Failed to start visa expiry alert cron', e);
      }
    } else {
      logger.debug('Visa expiry alert cron disabled (DISABLE_VISA_EXPIRY_CRON=true).');
    }

    try {
      const { startExitSlaEscalationCron } = require('./jobs/exitSlaEscalation.job');
      startExitSlaEscalationCron();
    } catch (e) {
      logger.error('Failed to start exit SLA escalation cron', e);
    }

    try {
      const { startAnnouncementScheduleCron } = require('./jobs/announcementSchedule.job');
      startAnnouncementScheduleCron();
    } catch (e) {
      logger.error('Failed to start announcement schedule cron', e);
    }

    try {
      const { startTaskRemindersCron } = require('./jobs/tasksReminder.job');
      startTaskRemindersCron();
    } catch (e) {
      logger.error('Failed to start task reminders cron', e);
    }

    try {
      const { startExitTaskReminderCron } = require('./jobs/exitTaskReminder.job');
      startExitTaskReminderCron();
    } catch (e) {
      logger.error('Failed to start exit task reminder cron', e);
    }

    try {
      const { startAttendanceCron } = require('./jobs/attendanceCron.job');
      startAttendanceCron();
    } catch (e) {
      logger.error('Failed to start attendance cron', e);
    }

    logger.info(`Socket.io attached on /socket.io`);
  });

  const shutdown = async (signal) => {
    logger.debug(`Received ${signal}. Shutting down gracefully...`);
    io.close();
    server.close(async (err) => {
      if (err) { logger.error('Error closing HTTP server', err); process.exit(1); }
      try {
        await db.closeAllTenantPools();
        await db.pool.end();
        logger.debug('All PG pools closed. Bye.');
        process.exit(0);
      } catch (e) {
        logger.error('Error closing PG pools', e);
        process.exit(1);
      }
    });
    setTimeout(() => { logger.error('Forced shutdown (timeout).'); process.exit(1); }, 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => { logger.error('Unhandled promise rejection', reason); });
  process.on('uncaughtException', (err) => { logger.error('Uncaught exception', err); });
}

bootstrap().catch((err) => {
  try { require('./utils/logger').error('Fatal startup error', err); } catch (_) { console.error('Fatal startup error', err); }
  process.exit(1);
}); // Trigger auto-reload for migration 049

