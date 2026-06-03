'use strict';

/**
 * Apply 094_attendance_role_permissions.sql to one or all tenant DBs.
 * Usage: node src/scripts/repairAttendancePermissions.js [db_name]
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../config/db');

const SQL_FILES = [
  '094_attendance_role_permissions.sql',
  '096_employee_attendance_punch_permissions.sql',
];

async function applyToPool(pool, label) {
  for (const file of SQL_FILES) {
    const sql = fs.readFileSync(
      path.join(__dirname, '../migrations/tenants', file),
      'utf8',
    );
    await pool.query(sql);
  }
  console.log(`  OK ${label}`);
}

async function run() {
  await db.assertDbConnection();
  const target = process.argv[2];

  if (target) {
    const pool = db.getTenantPool(target);
    await applyToPool(pool, target);
    console.log('\nDone. Users must log out and log in again to refresh permissions.');
    return;
  }

  const { rows: tenants } = await db.superAdminPool.query(
    `SELECT db_name FROM tenants WHERE status = 'active' AND db_name IS NOT NULL`,
  );
  for (const t of tenants) {
    try {
      const pool = db.getTenantPool(t.db_name);
      await applyToPool(pool, t.db_name);
    } catch (e) {
      console.error(`  FAIL ${t.db_name}:`, e.message);
    }
  }
  console.log('\nDone. Users must log out and log in again to refresh permissions.');
}

if (require.main === module) {
  run()
    .then(() => { try { db.pool.end(); } catch (_) {} process.exit(0); })
    .catch((err) => {
      console.error('repairAttendancePermissions failed:', err.message);
      try { db.pool.end(); } catch (_) {}
      process.exit(1);
    });
}

module.exports = { run };
