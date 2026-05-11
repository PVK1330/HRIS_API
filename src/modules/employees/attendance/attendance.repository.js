'use strict';

async function findByEmployee(pool, employeeId, { year, month, limit = 31, offset = 0 } = {}) {
  const conditions = ['employee_id = $1'];
  const params = [employeeId];

  if (year) {
    params.push(year);
    conditions.push(`EXTRACT(YEAR FROM date) = $${params.length}`);
  }
  if (month) {
    params.push(month);
    conditions.push(`EXTRACT(MONTH FROM date) = $${params.length}`);
  }

  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT id, date, check_in_time, check_out_time, work_mode,
            status, total_hours, overtime_hours, is_late, early_departure, notes,
            regularization_status,
            TO_CHAR(date, 'YYYY-MM-DD') AS date
     FROM attendance
     WHERE ${conditions.join(' AND ')}
     ORDER BY date DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

async function getSummary(pool, employeeId, year, month) {
  const params = [employeeId, year, month];
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'Present')::int   AS present,
       COUNT(*) FILTER (WHERE status = 'Absent')::int    AS absent,
       COUNT(*) FILTER (WHERE status = 'Late')::int      AS late,
       COUNT(*) FILTER (WHERE status = 'Half Day')::int  AS half_day,
       COUNT(*) FILTER (WHERE status = 'On Leave')::int  AS on_leave,
       ROUND(AVG(total_hours)::numeric, 2)               AS avg_hours,
       COUNT(*)::int                                     AS total_days
     FROM attendance
     WHERE employee_id = $1
       AND EXTRACT(YEAR  FROM date) = $2
       AND EXTRACT(MONTH FROM date) = $3`,
    params
  );
  return rows[0];
}

module.exports = { findByEmployee, getSummary };
