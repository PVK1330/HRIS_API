'use strict';

/**
 * Assets assigned via Asset Management live in `assets`.
 * Legacy rows may exist in `employee_assets` — both are merged for the profile tab.
 */
async function findByEmployee(pool, employeeId) {
  const { rows: fromAssets } = await pool.query(
    `SELECT
       a.id,
       COALESCE(a.asset_id, a.serial_number, 'AST-' || a.id::text) AS asset_tag,
       COALESCE(ac.name, a.type, 'Asset') AS asset_name,
       COALESCE(ac.name, a.type, '—') AS category,
       a.serial_number,
       a.condition,
       a.status,
       a.notes,
       TO_CHAR(a.issue_date, 'YYYY-MM-DD') AS assigned_date,
       NULL::text AS returned_date,
       NULL::text AS assigned_by_name,
       'assets' AS source
     FROM assets a
     LEFT JOIN asset_categories ac ON ac.id = a.category_id
     WHERE a.employee_id = $1
     ORDER BY a.issue_date DESC NULLS LAST, a.created_at DESC`,
    [employeeId],
  );

  const { rows: fromLegacy } = await pool.query(
    `SELECT
       ea.id,
       ea.asset_tag,
       ea.asset_name,
       ea.category,
       ea.serial_number,
       ea.condition,
       ea.status,
       ea.notes,
       TO_CHAR(ea.assigned_date, 'YYYY-MM-DD') AS assigned_date,
       TO_CHAR(ea.returned_date, 'YYYY-MM-DD') AS returned_date,
       ab.full_name AS assigned_by_name,
       'employee_assets' AS source
     FROM employee_assets ea
     LEFT JOIN employees ab ON ab.id = ea.assigned_by AND ab.deleted_at IS NULL
     WHERE ea.employee_id = $1
     ORDER BY ea.assigned_date DESC`,
    [employeeId],
  );

  const seen = new Set(fromAssets.map((r) => `${r.asset_tag}|${r.serial_number}`));
  const merged = [...fromAssets];
  for (const row of fromLegacy) {
    const key = `${row.asset_tag}|${row.serial_number}`;
    if (!seen.has(key)) {
      merged.push(row);
      seen.add(key);
    }
  }
  return merged;
}

async function countByEmployee(pool, employeeId) {
  const list = await findByEmployee(pool, employeeId);
  const activeStatuses = new Set(['Issued', 'Assigned', 'In Use']);
  const active = list.filter((r) => activeStatuses.has(String(r.status || ''))).length;
  return { active, total: list.length };
}

module.exports = { findByEmployee, countByEmployee };
