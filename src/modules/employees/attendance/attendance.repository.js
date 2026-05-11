'use strict';

// ─── Read ─────────────────────────────────────────────────────────────────────

async function findByEmployee(pool, employeeId, { year, month, limit = 31, offset = 0 } = {}) {
  const conditions = ['a.employee_id = $1'];
  const params = [employeeId];

  if (year)  { params.push(year);  conditions.push(`EXTRACT(YEAR  FROM a.date) = $${params.length}`); }
  if (month) { params.push(month); conditions.push(`EXTRACT(MONTH FROM a.date) = $${params.length}`); }

  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT a.id,
            TO_CHAR(a.date, 'YYYY-MM-DD') AS date,
            a.check_in_time, a.check_out_time, a.work_mode,
            a.status, a.total_hours, a.overtime_hours,
            a.is_late, a.early_departure, a.notes,
            a.regularization_status,
            e.full_name AS employee_name, e.emp_id
     FROM attendance a
     JOIN employees e ON e.id = a.employee_id AND e.deleted_at IS NULL
     WHERE ${conditions.join(' AND ')}
     ORDER BY a.date DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

async function findAll(pool, { date, department, status, search, limit = 50, offset = 0 } = {}) {
  const conditions = ['a.employee_id IS NOT NULL', 'e.deleted_at IS NULL'];
  const params = [];

  if (date)       { params.push(date);           conditions.push(`a.date = $${params.length}`); }
  if (status)     { params.push(status);         conditions.push(`a.status = $${params.length}`); }
  if (department) { params.push(department);     conditions.push(`e.department = $${params.length}`); }
  if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    conditions.push(`(e.full_name ILIKE $${n} OR e.emp_id ILIKE $${n})`);
  }

  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT a.id,
            TO_CHAR(a.date, 'YYYY-MM-DD') AS date,
            a.check_in_time, a.check_out_time, a.work_mode,
            a.status, a.total_hours, a.overtime_hours,
            a.is_late, a.early_departure, a.notes,
            a.regularization_status,
            e.id AS employee_id, e.full_name AS employee_name,
            e.emp_id, e.department, e.job_title
     FROM attendance a
     JOIN employees e ON e.id = a.employee_id AND e.deleted_at IS NULL
     WHERE ${conditions.join(' AND ')}
     ORDER BY a.date DESC, e.full_name ASC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

async function countAll(pool, { date, department, status, search } = {}) {
  const conditions = ['a.employee_id IS NOT NULL', 'e.deleted_at IS NULL'];
  const params = [];

  if (date)       { params.push(date);       conditions.push(`a.date = $${params.length}`); }
  if (status)     { params.push(status);     conditions.push(`a.status = $${params.length}`); }
  if (department) { params.push(department); conditions.push(`e.department = $${params.length}`); }
  if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    conditions.push(`(e.full_name ILIKE $${n} OR e.emp_id ILIKE $${n})`);
  }

  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM attendance a
     JOIN employees e ON e.id = a.employee_id AND e.deleted_at IS NULL
     WHERE ${conditions.join(' AND ')}`,
    params
  );
  return rows[0].total;
}

async function findById(pool, id) {
  const { rows } = await pool.query(
    `SELECT a.*,
            TO_CHAR(a.date, 'YYYY-MM-DD') AS date,
            e.full_name AS employee_name, e.emp_id, e.department
     FROM attendance a
     JOIN employees e ON e.id = a.employee_id AND e.deleted_at IS NULL
     WHERE a.id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function getSummary(pool, employeeId, year, month) {
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
    [employeeId, year, month]
  );
  return rows[0];
}

async function getDailySummary(pool, date) {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE a.status = 'Present')::int  AS present,
       COUNT(*) FILTER (WHERE a.status = 'Absent')::int   AS absent,
       COUNT(*) FILTER (WHERE a.status = 'Late')::int     AS late,
       COUNT(*) FILTER (WHERE a.status = 'On Leave')::int AS on_leave,
       COUNT(*) FILTER (WHERE a.work_mode = 'Remote')::int AS remote,
       COUNT(*) FILTER (WHERE a.work_mode = 'In Office')::int AS in_office,
       COUNT(*) FILTER (WHERE a.regularization_status = 'Pending')::int AS pending_regularization,
       COUNT(*) FILTER (WHERE a.check_out_time IS NULL AND a.status = 'Present')::int AS missing_checkout
     FROM attendance a
     JOIN employees e ON e.id = a.employee_id AND e.deleted_at IS NULL
     WHERE a.date = $1`,
    [date]
  );
  return rows[0];
}

// ─── Write ────────────────────────────────────────────────────────────────────

async function upsert(pool, data) {
  const {
    employeeId, date, checkInTime, checkOutTime, workMode,
    status, totalHours, overtimeHours, isLate, earlyDeparture, notes,
  } = data;

  const { rows } = await pool.query(
    `INSERT INTO attendance
       (employee_id, date, check_in_time, check_out_time, work_mode,
        status, total_hours, overtime_hours, is_late, early_departure, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (employee_id, date) DO UPDATE SET
       check_in_time       = EXCLUDED.check_in_time,
       check_out_time      = EXCLUDED.check_out_time,
       work_mode           = EXCLUDED.work_mode,
       status              = EXCLUDED.status,
       total_hours         = EXCLUDED.total_hours,
       overtime_hours      = EXCLUDED.overtime_hours,
       is_late             = EXCLUDED.is_late,
       early_departure     = EXCLUDED.early_departure,
       notes               = EXCLUDED.notes,
       updated_at          = NOW()
     RETURNING id,
               TO_CHAR(date, 'YYYY-MM-DD') AS date,
               check_in_time, check_out_time, work_mode,
               status, total_hours, overtime_hours, is_late, early_departure,
               notes, regularization_status`,
    [
      employeeId, date,
      checkInTime   || null,
      checkOutTime  || null,
      workMode      || 'In Office',
      status        || 'Present',
      totalHours    ?? null,
      overtimeHours ?? 0,
      isLate        ?? false,
      earlyDeparture ?? false,
      notes         || null,
    ]
  );
  return rows[0];
}

async function updateRegularization(pool, id, { status, regularizedBy }) {
  const { rows } = await pool.query(
    `UPDATE attendance
     SET regularization_status = $1,
         regularized_by        = $2,
         regularized_at        = NOW(),
         updated_at            = NOW()
     WHERE id = $3
     RETURNING id, regularization_status,
               TO_CHAR(date, 'YYYY-MM-DD') AS date`,
    [status, regularizedBy || null, id]
  );
  return rows[0] || null;
}

async function getPendingRegularizations(pool, { limit = 50, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT a.id,
            TO_CHAR(a.date, 'YYYY-MM-DD') AS date,
            a.check_in_time, a.check_out_time, a.work_mode,
            a.status, a.total_hours, a.notes, a.regularization_status,
            e.id AS employee_id, e.full_name AS employee_name,
            e.emp_id, e.department
     FROM attendance a
     JOIN employees e ON e.id = a.employee_id AND e.deleted_at IS NULL
     WHERE a.regularization_status = 'Pending'
     ORDER BY a.date DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows;
}

module.exports = {
  findByEmployee, findAll, countAll, findById,
  getSummary, getDailySummary,
  upsert, updateRegularization, getPendingRegularizations,
};
