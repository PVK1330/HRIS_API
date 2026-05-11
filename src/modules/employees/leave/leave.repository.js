'use strict';

// ─── Leave Requests ───────────────────────────────────────────────────────────

async function findRequests(pool, employeeId, { status, year, limit = 20, offset = 0 } = {}) {
  const conditions = ['lr.employee_id = $1'];
  const params = [employeeId];

  if (status) { params.push(status); conditions.push(`lr.status = $${params.length}`); }
  if (year)   { params.push(year);   conditions.push(`EXTRACT(YEAR FROM lr.from_date) = $${params.length}`); }

  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT lr.id, lr.leave_type, lr.reason, lr.total_days, lr.status,
            lr.rejection_reason, lr.handover_note,
            TO_CHAR(lr.from_date,   'YYYY-MM-DD') AS from_date,
            TO_CHAR(lr.to_date,     'YYYY-MM-DD') AS to_date,
            TO_CHAR(lr.created_at,  'DD/MM/YYYY') AS "createdAt",
            TO_CHAR(lr.approved_at, 'DD/MM/YYYY') AS "approvedAt",
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

async function findAllRequests(pool, { status, year, department, search, limit = 50, offset = 0 } = {}) {
  const conditions = ['e.deleted_at IS NULL'];
  const params = [];

  if (status)     { params.push(status);     conditions.push(`lr.status = $${params.length}`); }
  if (year)       { params.push(year);       conditions.push(`EXTRACT(YEAR FROM lr.from_date) = $${params.length}`); }
  if (department) { params.push(department); conditions.push(`e.department = $${params.length}`); }
  if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    conditions.push(`(e.full_name ILIKE $${n} OR e.emp_id ILIKE $${n})`);
  }

  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT lr.id, lr.leave_type, lr.reason, lr.total_days, lr.status,
            lr.rejection_reason,
            TO_CHAR(lr.from_date,  'YYYY-MM-DD') AS from_date,
            TO_CHAR(lr.to_date,    'YYYY-MM-DD') AS to_date,
            TO_CHAR(lr.created_at, 'DD/MM/YYYY') AS "createdAt",
            e.id AS employee_id, e.full_name AS employee_name,
            e.emp_id, e.department, e.job_title,
            a.full_name AS approved_by_name
     FROM leave_requests lr
     JOIN employees e ON e.id = lr.employee_id AND e.deleted_at IS NULL
     LEFT JOIN employees a ON a.id = lr.approved_by AND a.deleted_at IS NULL
     WHERE ${conditions.join(' AND ')}
     ORDER BY lr.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

async function countAllRequests(pool, { status, year, department, search } = {}) {
  const conditions = ['e.deleted_at IS NULL'];
  const params = [];

  if (status)     { params.push(status);     conditions.push(`lr.status = $${params.length}`); }
  if (year)       { params.push(year);       conditions.push(`EXTRACT(YEAR FROM lr.from_date) = $${params.length}`); }
  if (department) { params.push(department); conditions.push(`e.department = $${params.length}`); }
  if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    conditions.push(`(e.full_name ILIKE $${n} OR e.emp_id ILIKE $${n})`);
  }

  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM leave_requests lr
     JOIN employees e ON e.id = lr.employee_id AND e.deleted_at IS NULL
     WHERE ${conditions.join(' AND ')}`,
    params
  );
  return rows[0].total;
}

async function findRequestById(pool, id) {
  const { rows } = await pool.query(
    `SELECT lr.*,
            TO_CHAR(lr.from_date,  'YYYY-MM-DD') AS from_date,
            TO_CHAR(lr.to_date,    'YYYY-MM-DD') AS to_date,
            e.full_name AS employee_name, e.emp_id, e.department
     FROM leave_requests lr
     JOIN employees e ON e.id = lr.employee_id AND e.deleted_at IS NULL
     WHERE lr.id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function insertRequest(pool, data) {
  const {
    employeeId, leaveType, fromDate, toDate, totalDays,
    reason, handoverNote, alternatContact, supportingDocumentUrl,
    status = 'Pending',
  } = data;

  const { rows } = await pool.query(
    `INSERT INTO leave_requests
       (employee_id, leave_type, from_date, to_date, total_days,
        reason, handover_note, alternate_contact, supporting_document_url, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id, leave_type, total_days, status,
               TO_CHAR(from_date, 'YYYY-MM-DD') AS from_date,
               TO_CHAR(to_date,   'YYYY-MM-DD') AS to_date,
               TO_CHAR(created_at,'DD/MM/YYYY') AS "createdAt"`,
    [
      employeeId, leaveType, fromDate, toDate, totalDays,
      reason, handoverNote || null, alternatContact || null,
      supportingDocumentUrl || null, status,
    ]
  );
  return rows[0];
}

async function updateRequestStatus(pool, id, { status, approvedBy, rejectionReason }) {
  const { rows } = await pool.query(
    `UPDATE leave_requests
     SET status           = $1::VARCHAR,
         approved_by      = $2,
         approved_at      = CASE WHEN $1::VARCHAR = 'Approved' THEN NOW() ELSE NULL END,
         rejection_reason = $3,
         updated_at       = NOW()
     WHERE id = $4
     RETURNING id, leave_type, status, total_days,
               TO_CHAR(from_date, 'YYYY-MM-DD') AS from_date,
               TO_CHAR(to_date,   'YYYY-MM-DD') AS to_date`,
    [status, approvedBy || null, rejectionReason || null, id]
  );
  return rows[0] || null;
}

// ─── Leave Balances ───────────────────────────────────────────────────────────

async function findActiveLeaveType(pool, name) {
  const { rows } = await pool.query(
    `SELECT id, name, paid_or_unpaid, annual_entitlement_days,
            max_carry_forward_days, accrual, loss_of_pay_rule,
            document_required, auto_approval, approver, is_active
     FROM leave_types
     WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) AND is_active = true
     LIMIT 1`,
    [name]
  );
  return rows[0] || null;
}

async function getActiveLeaveTypes(pool) {
  const { rows } = await pool.query(
    `SELECT name FROM leave_types WHERE is_active = true ORDER BY sort_order ASC, name ASC`
  );
  return rows.map(r => r.name);
}

// ─── Leave Balances ───────────────────────────────────────────────────────────

async function getBalanceForType(pool, employeeId, leaveType, year) {
  const { rows } = await pool.query(
    `SELECT * FROM leave_balances
     WHERE employee_id = $1 AND leave_type = $2 AND year = $3
     LIMIT 1`,
    [employeeId, leaveType, year]
  );
  return rows[0] || null;
}

async function findOverlappingRequest(pool, employeeId, fromDate, toDate) {
  const { rows } = await pool.query(
    `SELECT id, leave_type, status,
            TO_CHAR(from_date, 'YYYY-MM-DD') AS from_date,
            TO_CHAR(to_date,   'YYYY-MM-DD') AS to_date
     FROM leave_requests
     WHERE employee_id = $1
       AND status IN ('Pending', 'Approved')
       AND from_date <= $3::date
       AND to_date   >= $2::date
     LIMIT 1`,
    [employeeId, fromDate, toDate]
  );
  return rows[0] || null;
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

async function getAllBalances(pool, year, { department, search, limit = 50, offset = 0 } = {}) {
  const conditions = ['e.deleted_at IS NULL'];
  const params = [year];

  if (department) { params.push(department); conditions.push(`e.department = $${params.length}`); }
  if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    conditions.push(`(e.full_name ILIKE $${n} OR e.emp_id ILIKE $${n})`);
  }

  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT e.id AS employee_id, e.full_name AS employee_name,
            e.emp_id, e.department, e.job_title,
            COALESCE(
              json_agg(
                json_build_object(
                  'leave_type',       lb.leave_type,
                  'total_allocated',  lb.total_allocated,
                  'used',             lb.used,
                  'carry_forward',    lb.carry_forward,
                  'remaining',        lb.total_allocated + lb.carry_forward - lb.used
                ) ORDER BY lb.leave_type
              ) FILTER (WHERE lb.id IS NOT NULL),
              '[]'
            ) AS balances
     FROM employees e
     LEFT JOIN leave_balances lb ON lb.employee_id = e.id AND lb.year = $1
     WHERE ${conditions.join(' AND ')}
     GROUP BY e.id, e.full_name, e.emp_id, e.department, e.job_title
     ORDER BY e.full_name ASC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

async function upsertBalance(pool, { employeeId, leaveType, year, totalAllocated, used, carryForward }) {
  const { rows } = await pool.query(
    `INSERT INTO leave_balances (employee_id, leave_type, year, total_allocated, used, carry_forward)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (employee_id, leave_type, year) DO UPDATE SET
       total_allocated = EXCLUDED.total_allocated,
       used            = EXCLUDED.used,
       carry_forward   = EXCLUDED.carry_forward,
       updated_at      = NOW()
     RETURNING *`,
    [employeeId, leaveType, year, totalAllocated ?? 0, used ?? 0, carryForward ?? 0]
  );
  return rows[0];
}

// ─── Stats ────────────────────────────────────────────────────────────────────

async function getStats(pool, year) {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'Pending')::int  AS pending,
       COUNT(*) FILTER (WHERE status = 'Approved')::int AS approved,
       COUNT(*) FILTER (WHERE status = 'Rejected')::int AS rejected,
       COUNT(*)::int                                    AS total
     FROM leave_requests
     WHERE EXTRACT(YEAR FROM from_date) = $1`,
    [year]
  );
  return rows[0];
}

module.exports = {
  findRequests, findAllRequests, countAllRequests, findRequestById,
  insertRequest, updateRequestStatus,
  findActiveLeaveType, getActiveLeaveTypes,
  getBalanceForType, findOverlappingRequest,
  getBalances, getAllBalances, upsertBalance,
  getStats,
};
