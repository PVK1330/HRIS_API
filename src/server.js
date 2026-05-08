'use strict';

const app = require('./app');
const env = require('./config/env');
const db = require('./config/db');
const logger = require('./utils/logger');
const {
  runSuperAdminMigrations,
  runPendingTenantMigrationsForAllActiveTenants,
} = require('./scripts/runMigrations');

async function bootstrap() {
  logger.debug(`Starting HRS backend (env=${env.NODE_ENV})...`);

  // 1. Verify DB connectivity early.
  await db.assertDbConnection();

  // 2. Auto-run SuperAdmin migrations on startup.
  logger.debug('Running SuperAdmin migrations...');
  const result = await runSuperAdminMigrations();
  logger.debug(
    `SuperAdmin migrations finished (applied=${result.applied}, skipped=${result.skipped}).`
  );

  logger.debug('Running pending tenant DB migrations for active tenants...');
  const tenantMigrateResult = await runPendingTenantMigrationsForAllActiveTenants();
  logger.debug(
    `Tenant migrations sweep finished (tenantsProcessed=${tenantMigrateResult.tenantsProcessed}).`
  );

  // 3. Start HTTP server.
  const server = app.listen(env.PORT, () => {
    logger.info(`Running on port ${env.PORT}`);
    logger.debug('Available routes:');
    logger.debug('  POST /api/v1/superadmin/login');
    logger.debug('  POST /api/v1/tenants/create   (Bearer SuperAdmin JWT)');
    logger.debug('  GET  /api/v1/settings/*       (Bearer SuperAdmin JWT)');
    logger.debug('  GET  /uploads/logos/*         (static logo files)');
    logger.debug('  GET  /health');
  });

  /* -------- graceful shutdown -------- */

  const shutdown = async (signal) => {
    logger.debug(`Received ${signal}. Shutting down gracefully...`);
    server.close(async (err) => {
      if (err) {
        logger.error('Error closing HTTP server', err);
        process.exit(1);
      }
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

    // Hard exit if we can't close cleanly within 10s
    setTimeout(() => {
      logger.error('Forced shutdown (timeout).');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', reason);
  });
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', err);
    // Allow the process to keep running so the global error handler can be reviewed,
    // but log loudly. In production you may want to exit and let the orchestrator restart.
  });
}

bootstrap().catch((err) => {
  // Lazy-load logger so that a missing config error message is visible too.
  try {
    require('./utils/logger').error('Fatal startup error', err);
  } catch (_) {
    // eslint-disable-next-line no-console
    console.error('Fatal startup error', err);
  }
  process.exit(1);
});
