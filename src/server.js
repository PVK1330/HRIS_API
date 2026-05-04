'use strict';

const app = require('./app');
const env = require('./config/env');
const db = require('./config/db');
const logger = require('./utils/logger');
const { runSuperAdminMigrations } = require('./scripts/runMigrations');

async function bootstrap() {
  logger.info(`Starting HRS backend (env=${env.NODE_ENV})...`);

  // 1. Verify DB connectivity early.
  await db.assertDbConnection();

  // 2. Auto-run SuperAdmin migrations on startup.
  logger.info('Running SuperAdmin migrations...');
  const result = await runSuperAdminMigrations();
  logger.info(
    `SuperAdmin migrations finished (applied=${result.applied}, skipped=${result.skipped}).`
  );

  // 3. Start HTTP server.
  const server = app.listen(env.PORT, () => {
    logger.info(`HRS backend listening on http://localhost:${env.PORT}`);
    logger.info('Available routes:');
    logger.info('  POST /api/v1/superadmin/login');
    logger.info('  POST /api/v1/tenants/create   (Bearer SuperAdmin JWT)');
    logger.info('  GET  /api/v1/settings/*       (Bearer SuperAdmin JWT)');
    logger.info('  GET  /uploads/logos/*         (static logo files)');
    logger.info('  GET  /health');
  });

  /* -------- graceful shutdown -------- */

  const shutdown = async (signal) => {
    logger.info(`Received ${signal}. Shutting down gracefully...`);
    server.close(async (err) => {
      if (err) {
        logger.error('Error closing HTTP server', err);
        process.exit(1);
      }
      try {
        await db.pool.end();
        logger.info('PG pool closed. Bye.');
        process.exit(0);
      } catch (e) {
        logger.error('Error closing PG pool', e);
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
