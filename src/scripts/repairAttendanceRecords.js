'use strict';

/**
 * One-time attendance data repair using attendanceIntegrity rules.
 * Usage: node src/scripts/repairAttendanceRecords.js [tenant_db_name] [--dry-run]
 */

require('dotenv').config();
const db = require('../config/db');
const { runTenantMigrations } = require('../modules/tenant/tenant.service');
const integrity = require('../modules/employees/attendance/attendanceIntegrity.service');

const PRESENT_LIKE = new Set([
  'Present', 'Late', 'Remote', 'Work From Home', 'Field Duty', 'Half Day',
]);

function needsRepair(row) {
  const status = row.status || '';
  const hasIn = Boolean(row.check_in_time);
  const hasOut = Boolean(row.check_out_time);
  const wh = Number(row.worked_hours ?? row.total_hours) || 0;
  const ot = Number(row.overtime_hours) || 0;
  const isLate = row.is_late === true;

  if (PRESENT_LIKE.has(status) && !hasIn) return true;
  if (PRESENT_LIKE.has(status) && wh <= 0 && !hasIn && !hasOut) return true;
  if (ot > 0 && wh <= 0) return true;
  if (isLate && !hasIn) return true;

  const derived = integrity.deriveStatus({
    status: row.status,
    checkInTime: row.check_in_time,
    checkOutTime: row.check_out_time,
    regularizationStatus: row.regularization_status,
    workedHours: wh,
    overtimeHours: ot,
    isLate,
  });
  if (derived !== status) return true;
  return false;
}

async function repairTenant(pool, dbName, dryRun) {
  await runTenantMigrations(dbName);

  const { rows } = await pool.query(
    `SELECT id, employee_id, status, check_in_time, check_out_time,
            worked_hours, total_hours, overtime_hours, is_late,
            regularization_status, paid_day
     FROM attendance
     ORDER BY id`,
  );

  const beforeCounts = {};
  const afterCounts = {};
  for (const r of rows) {
    const k = r.status || 'Unknown';
    beforeCounts[k] = (beforeCounts[k] || 0) + 1;
  }

  const toFix = rows.filter(needsRepair);
  let repaired = 0;
  const samples = [];

  for (const row of toFix) {
    const sanitized = integrity.sanitizeMetrics(
      {
        status: row.status,
        worked_hours: row.worked_hours,
        total_hours: row.total_hours,
        overtime_hours: row.overtime_hours,
        is_late: row.is_late,
        paid_day: row.paid_day,
      },
      row.check_in_time,
      row.check_out_time,
      row.regularization_status || 'N/A',
    );

    if (!dryRun) {
      await pool.query(
        `UPDATE attendance SET
           status = $1,
           worked_hours = $2,
           total_hours = $3,
           overtime_hours = $4,
           is_late = $5,
           paid_day = $6,
           updated_at = NOW()
         WHERE id = $7`,
        [
          sanitized.status,
          sanitized.worked_hours,
          sanitized.total_hours,
          sanitized.overtime_hours,
          sanitized.is_late,
          sanitized.paid_day,
          row.id,
        ],
      );
    }
    repaired += 1;
    if (samples.length < 10) {
      samples.push({
        id: row.id,
        before: row.status,
        after: sanitized.status,
      });
    }
  }

  const { rows: afterRows } = await pool.query(`SELECT status FROM attendance`);
  for (const r of afterRows) {
    const k = r.status || 'Unknown';
    afterCounts[k] = (afterCounts[k] || 0) + 1;
  }

  return {
    tenant: dbName,
    dryRun,
    scanned: rows.length,
    repaired,
    beforeCounts,
    afterCounts,
    samples,
  };
}

async function run() {
  await db.assertDbConnection();
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const target = args.find((a) => a !== '--dry-run');

  const tenants = target
    ? [{ db_name: target }]
    : (await db.superAdminPool.query(
      `SELECT db_name FROM tenants WHERE status = 'active' AND db_name IS NOT NULL`,
    )).rows;

  console.log('\n=== Attendance Record Repair ===\n');
  console.log(`Mode: ${dryRun ? 'DRY RUN (no writes)' : 'LIVE UPDATE'}\n`);

  for (const t of tenants) {
    const pool = db.getTenantPool(t.db_name);
    const report = await repairTenant(pool, t.db_name, dryRun);
    console.log(`Tenant: ${report.tenant}`);
    console.log(`  Rows scanned:  ${report.scanned}`);
    console.log(`  Rows repaired: ${report.repaired}`);
    console.log('  Before status counts:', JSON.stringify(report.beforeCounts, null, 0));
    console.log('  After status counts: ', JSON.stringify(report.afterCounts, null, 0));
    if (report.samples.length) {
      console.log('  Sample fixes:', report.samples);
    }
    console.log('');
  }

  console.log('Done.');
}

if (require.main === module) {
  run()
    .then(() => { try { db.pool.end(); } catch (_) {} process.exit(0); })
    .catch((err) => {
      console.error('repairAttendanceRecords failed:', err.message);
      try { db.pool.end(); } catch (_) {}
      process.exit(1);
    });
}

module.exports = { repairTenant, needsRepair };
