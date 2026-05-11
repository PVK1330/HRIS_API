'use strict';

async function findRequests(pool, employeeId, { status, year, limit = 20, offset = 0 } = {}) {
  const conditions = ['lr.employee_id = $1'];
  const params = [employeeId];

  if (status) {
    params.push(status);
    conditions.push(`lr.status = $${params.length}`);
  }
  if (year) {
    params.push(year);
    conditions.push(`EXTRACT(YEAR FROM lr.from_date) = $${params.length}`);
  }

  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT lr.id, lr.leave_type, lr.reason, lr.total_days, lr.status,
            lr.rejection_reason,
            TO_CHAR(lr.from_date, 'YYYY-MM-DD') AS from_date,
            TO_CHAR(lr.to_date,   'YYYY-MM-DD') AS to_date,
            TO_CHAR(lr.created_at, 'DD/MM/YYYY') AS "createdAt",
            a.full_name AS approved_by_name
     FROM leave_requests lr
     LEFT JOIN employees a ON a.id = lr.approved_by AND a.deleted_at IS NULL
     WHERE ${conditions.join(' AND ')}
     ORDER BY lr.from_date DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

async function getBalances(pool, employeeId, year) {
  const { rows } = await pool.query(
    `SELECT leave_type, total_allocated, used, carry_forward,
            (total_allocated + carry_forward - used) AS remaining
     FROM leave_balances
     WHERE employee_id = $1 AND year = $2
     ORDER BY leave_type`,
    [employeeId, year]
  );
  return rows;
}

module.exports = { findRequests, getBalances };
