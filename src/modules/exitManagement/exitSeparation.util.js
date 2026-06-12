'use strict';

/**
 * Single source of truth for the "separated employee" state used by the exit workflow.
 *
 * Two employee columns together represent separation (these are the ONLY relevant columns
 * that exist on `employees` — there is no `status` column; migration 035 added `status` to
 * departments/designations, not employees, so the previous onCompleted UPDATE that set
 * `status = 'EXITED'` silently failed the whole statement and never soft-deleted anyone):
 *   - employment_status : 'Terminated' (separated)  <->  'Active' (restored)   [default 'Active']
 *   - deleted_at        : NOW()        (separated)  <->  NULL    (restored)
 *
 * Completion (exitStageEngine.advanceStage) and the post-commit onCompleted event both call
 * markEmployeeSeparated; withdraw calls restoreEmployeeActive. Routing every path through these
 * helpers keeps the field set identical, so a withdrawn exit FULLY reverts the employee.
 *
 * `db` may be a pool or a transaction client (both expose .query).
 */
async function markEmployeeSeparated(db, employeeId) {
  await db.query(
    `UPDATE employees
        SET employment_status = 'Terminated',
            deleted_at        = COALESCE(deleted_at, NOW()),
            updated_at        = NOW()
      WHERE id = $1`,
    [employeeId],
  );
}

async function restoreEmployeeActive(db, employeeId) {
  await db.query(
    `UPDATE employees
        SET employment_status = 'Active',
            deleted_at        = NULL,
            updated_at        = NOW()
      WHERE id = $1`,
    [employeeId],
  );
}

module.exports = { markEmployeeSeparated, restoreEmployeeActive };
