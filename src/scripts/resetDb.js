'use strict';

const db = require('../config/db');
const logger = require('../utils/logger');

async function resetDb() {
  await db.assertDbConnection();

  logger.warn('WARNING: Dropping all tables in the public schema...');
  
  await db.query('DROP SCHEMA public CASCADE');
  await db.query('CREATE SCHEMA public');
  await db.query('GRANT ALL ON SCHEMA public TO postgres');
  await db.query('GRANT ALL ON SCHEMA public TO public');

  logger.info('Database reset successful. Schema "public" is now empty.');
}

if (require.main === module) {
  (async () => {
    try {
      await resetDb();
      await db.pool.end();
      process.exit(0);
    } catch (err) {
      logger.error('Database reset failed', err);
      try { await db.pool.end(); } catch (_) {}
      process.exit(1);
    }
  })();
}

module.exports = { resetDb };
