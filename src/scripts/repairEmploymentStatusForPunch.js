'use strict';

/**
 * Set employment_status = Active for portal-enabled employees stuck on Onboarding
 * after onboarding was completed (allows check-in).
 *
 * Usage: node src/scripts/repairEmploymentStatusForPunch.js <tenant_db_name> [--dry-run]
 */

const db = require('../config/db');

async function main() {
  const dbName = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  if (!dbName) {
    console.error('Usage: node src/scripts/repairEmploymentStatusForPunch.js <tenant_db_name> [--dry-run]');
    process.exit(1);
  }

  await db.assertDbConnection();
  const pool = db.getTenantPool(dbName);

  const { rows } = await pool.query(
    `SELECT id, full_name, work_email, employment_status, onboarding_workflow_status,
            onboarding_completed_at
     FROM employees
     WHERE deleted_at IS NULL
       AND portal_enabled = true
       AND LOWER(TRIM(employment_status)) = 'onboarding'
       AND (
         onboarding_completed_at IS NOT NULL
         OR LOWER(TRIM(COALESCE(onboarding_workflow_status, ''))) = 'onboarding_complete'
       )`,
  );

  console.log(`[repair:punch-status] ${rows.length} employee(s) to fix in ${dbName}${dryRun ? ' (dry-run)' : ''}`);
  for (const r of rows) {
    console.log(`  - id=${r.id} ${r.work_email} (${r.full_name})`);
    if (!dryRun) {
      await pool.query(
        `UPDATE employees SET employment_status = 'Active', updated_at = NOW() WHERE id = $1`,
        [r.id],
      );
    }
  }

  if (!dryRun && rows.length) {
    console.log('[repair:punch-status] Done. Employees can check in after re-login.');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
