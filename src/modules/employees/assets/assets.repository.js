'use strict';

async function findByEmployee(pool, employeeId) {
  const { rows } = await pool.query(
    `SELECT ea.id, ea.asset_tag, ea.asset_name, ea.category,
            ea.serial_number, ea.condition, ea.status, ea.notes,
            TO_CHAR(ea.assigned_date,  'YYYY-MM-DD') AS assigned_date,
            TO_CHAR(ea.returned_date,  'YYYY-MM-DD') AS returned_date,
            a.full_name AS assigned_by_name
     FROM employee_assets ea
     LEFT JOIN employees a ON a.id = ea.assigned_by AND a.deleted_at IS NULL
     WHERE ea.employee_id = $1
     ORDER BY ea.assigned_date DESC`,
    [employeeId]
  );
  return rows;
}

async function countByEmployee(pool, employeeId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'Issued')::int  AS active,
            COUNT(*)::int                                   AS total
     FROM employee_assets WHERE employee_id = $1`,
    [employeeId]
  );
  return rows[0];
}

module.exports = { findByEmployee, countByEmployee };
