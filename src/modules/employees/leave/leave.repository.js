'use strict';

const { appendScopeToConditions } = require('../../../utils/applyDataScope');

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

async function findAllRequests(pool, { status, year, department, search, leaveType, limit = 50, offset = 0 } = {}, auth = null) {
  const conditions = ['e.deleted_at IS NULL'];
  const params = [];

  if (status)     { params.push(status);     conditions.push(`lr.status = $${params.length}`); }
  if (year)       { params.push(year);       conditions.push(`EXTRACT(YEAR FROM lr.from_date) = $${params.length}`); }
  if (department) { params.push(department); conditions.push(`e.department = $${params.length}`); }
  if (leaveType)  { params.push(leaveType);  conditions.push(`lr.leave_type = $${params.length}`); }
  if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    conditions.push(`(e.full_name ILIKE $${n} OR e.emp_id ILIKE $${n})`);
  }

  const scoped = appendScopeToConditions(auth, conditions, params, 'e');
  scoped.params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT lr.id, lr.leave_type, lr.reason, lr.total_days, lr.status,
            lr.rejection_reason,
            TO_CHAR(lr.from_date,  'YYYY-MM-DD') AS from_date,
            TO_CHAR(lr.to_date,    'YYYY-MM-DD') AS to_date,
            TO_CHAR(lr.created_at, 'DD/MM/YYYY') AS "createdAt",
            e.id AS employee_id, e.full_name AS employee_name,
            e.emp_id, e.department, e.job_title,
            a.full_name AS approved_by_name,
            -- remaining balance for this leave type in the request year
            lb.total_allocated,
            lb.used                                                    AS balance_used,
            lb.carry_forward,
            COALESCE(lb.total_allocated + lb.carry_forward - lb.used, NULL) AS balance_remaining
     FROM leave_requests lr
     JOIN employees e ON e.id = lr.employee_id AND e.deleted_at IS NULL
     LEFT JOIN employees a ON a.id = lr.approved_by AND a.deleted_at IS NULL
     LEFT JOIN leave_balances lb
            ON lb.employee_id = lr.employee_id
           AND lb.leave_type  = lr.leave_type
           AND lb.year        = EXTRACT(YEAR FROM lr.from_date)::int
     WHERE ${scoped.conditions.join(' AND ')}
     ORDER BY lr.created_at DESC
     LIMIT $${scoped.params.length - 1} OFFSET $${scoped.params.length}`,
    scoped.params
  );
  return rows;
}

async function countAllRequests(pool, { status, year, department, search, leaveType } = {}, auth = null) {
  const conditions = ['e.deleted_at IS NULL'];
  const params = [];

  if (status)     { params.push(status);     conditions.push(`lr.status = $${params.length}`); }
  if (year)       { params.push(year);       conditions.push(`EXTRACT(YEAR FROM lr.from_date) = $${params.length}`); }
  if (department) { params.push(department); conditions.push(`e.department = $${params.length}`); }
  if (leaveType)  { params.push(leaveType);  conditions.push(`lr.leave_type = $${params.length}`); }
  if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    conditions.push(`(e.full_name ILIKE $${n} OR e.emp_id ILIKE $${n})`);
  }

  const scoped = appendScopeToConditions(auth, conditions, params, 'e');
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM leave_requests lr
     JOIN employees e ON e.id = lr.employee_id AND e.deleted_at IS NULL
     WHERE ${scoped.conditions.join(' AND ')}`,
    scoped.params
  );
  return rows[0].total;
}

async function findRequestById(pool, id) {
  const { rows } = await pool.query(
    `SELECT lr.*,
            TO_CHAR(lr.from_date,  'YYYY-MM-DD') AS from_date,
            TO_CHAR(lr.to_date,    'YYYY-MM-DD') AS to_date,
            e.full_name AS employee_name, e.emp_id, e.department, e.reporting_manager_id
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
    reason, handoverNote, alternateContact, supportingDocumentUrl,
    status = 'Pending Manager Approval',
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
      reason, handoverNote || null, alternateContact || null,
      supportingDocumentUrl || null, status,
    ]
  );
  return rows[0];
}

/**
 * Update a request's lifecycle. `stage` records which approver acted:
 *   'manager'    → sets manager_approved_by/at
 *   'department' → sets department_approved_by/at
 *   'hr'         → sets hr_approved_by/at AND approved_by/at (final approval)
 * Reject/cancel pass no stage and just set status + rejection_reason.
 */
async function updateRequestStatus(pool, id, { status, stage, actorId, rejectionReason, remarks }) {
  const sets = ['status = $1::VARCHAR', 'updated_at = NOW()'];
  const params = [status];
  let i = 2;

  if (stage === 'manager') {
    sets.push(`manager_approved_by = $${i}`); params.push(actorId || null); i += 1;
    sets.push('manager_approved_at = NOW()');
  } else if (stage === 'department') {
    sets.push(`department_approved_by = $${i}`); params.push(actorId || null); i += 1;
    sets.push('department_approved_at = NOW()');
  } else if (stage === 'hr') {
    sets.push(`hr_approved_by = $${i}`); params.push(actorId || null); i += 1;
    sets.push('hr_approved_at = NOW()');
    sets.push(`approved_by = $${i}`); params.push(actorId || null); i += 1;
    sets.push('approved_at = NOW()');
  }

  sets.push(`rejection_reason = $${i}`); params.push(rejectionReason || null); i += 1;

  params.push(id);
  const { rows } = await pool.query(
    `UPDATE leave_requests
     SET ${sets.join(', ')}
     WHERE id = $${i}
     RETURNING id, leave_type, status, total_days,
               manager_approved_by, department_approved_by, hr_approved_by,
               TO_CHAR(from_date, 'YYYY-MM-DD') AS from_date,
               TO_CHAR(to_date,   'YYYY-MM-DD') AS to_date`,
    params
  );
  return rows[0] || null;
}

// ─── Leave Balances ───────────────────────────────────────────────────────────

async function findActiveLeaveType(pool, name) {
  const { rows } = await pool.query(
    `SELECT id, name, paid_or_unpaid, annual_entitlement_days,
            max_carry_forward_days, accrual, loss_of_pay_rule,
            document_required, auto_approval, approver, is_active,
            notice_period_required, gender_restriction,
            probation_restriction, minimum_service_months
     FROM leave_types
     WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) AND is_active = true
     LIMIT 1`,
    [name]
  );
  return rows[0] || null;
}

async function findActiveLeaveTypeById(pool, id) {
  const { rows } = await pool.query(
    `SELECT id, name, paid_or_unpaid, annual_entitlement_days,
            max_carry_forward_days, accrual, loss_of_pay_rule,
            document_required, auto_approval, approver, is_active,
            notice_period_required, gender_restriction,
            probation_restriction, minimum_service_months
     FROM leave_types
     WHERE id = $1 AND is_active = true
     LIMIT 1`,
    [id]
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
       AND status IN ('Pending Manager Approval', 'Pending Dept Approval', 'Pending HR Approval', 'Approved')
       AND from_date <= $3::date
       AND to_date   >= $2::date
     LIMIT 1`,
    [employeeId, fromDate, toDate]
  );
  return rows[0] || null;
}

/**
 * Total leave days the employee already has tied up in OTHER in-flight (Pending) requests of
 * the same leave type for the given balance year. These requests have NOT yet been deducted
 * from leave_balances.used — only Approved days are — so the apply-time balance check must
 * subtract them too, otherwise an employee can stack several pending requests that together
 * exceed their entitlement.
 *
 * Counts only the not-yet-resolved Pending* statuses; Approved (already in `used`), Rejected,
 * Cancelled and Draft are excluded. `excludeRequestId` lets a caller ignore one specific
 * request (e.g. when re-checking an already-inserted one). Year is matched on from_date so it
 * lines up with how leave_balances is bucketed.
 */
async function sumPendingDaysForType(pool, employeeId, leaveType, year, excludeRequestId = null) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(total_days), 0)::float AS pending_days
       FROM leave_requests
      WHERE employee_id = $1
        AND LOWER(TRIM(leave_type)) = LOWER(TRIM($2))
        AND status IN ('Pending Manager Approval', 'Pending Dept Approval', 'Pending HR Approval')
        AND EXTRACT(YEAR FROM from_date) = $3
        AND ($4::int IS NULL OR id <> $4)`,
    [employeeId, leaveType, year, excludeRequestId]
  );
  return Number(rows[0].pending_days) || 0;
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

async function getAllBalances(pool, year, { department, search, limit = 50, offset = 0 } = {}, auth = null) {
  const conditions = ['e.deleted_at IS NULL'];
  const params = [year];

  if (department) { params.push(department); conditions.push(`e.department = $${params.length}`); }
  if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    conditions.push(`(e.full_name ILIKE $${n} OR e.emp_id ILIKE $${n})`);
  }

  const scoped = appendScopeToConditions(auth, conditions, params, 'e');
  scoped.params.push(limit, offset);
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
     WHERE ${scoped.conditions.join(' AND ')}
     GROUP BY e.id, e.full_name, e.emp_id, e.department, e.job_title
     ORDER BY e.full_name ASC
     LIMIT $${scoped.params.length - 1} OFFSET $${scoped.params.length}`,
    scoped.params
  );
  return rows;
}

/**
 * Concurrency-safe balance access. Seeds the row from the entitlement if absent,
 * then locks it FOR UPDATE so two concurrent approvals/applies cannot both read a
 * stale `used` and over/under-deduct. MUST be called inside a transaction (client).
 */
async function lockBalanceForUpdate(client, employeeId, leaveType, year, annualDays = 0) {
  await client.query(
    `INSERT INTO leave_balances (employee_id, leave_type, year, total_allocated, used, carry_forward)
     VALUES ($1,$2,$3,$4,0,0)
     ON CONFLICT (employee_id, leave_type, year) DO NOTHING`,
    [employeeId, leaveType, year, annualDays ?? 0]
  );
  const { rows } = await client.query(
    `SELECT * FROM leave_balances
     WHERE employee_id = $1 AND leave_type = $2 AND year = $3
     FOR UPDATE`,
    [employeeId, leaveType, year]
  );
  return rows[0];
}

/**
 * Atomically adjust `used` by deltaDays (positive = consume, negative = restore),
 * clamped at 0. Pair with lockBalanceForUpdate inside the same transaction.
 */
async function incrementUsed(client, employeeId, leaveType, year, deltaDays) {
  const { rows } = await client.query(
    `UPDATE leave_balances
     SET used = GREATEST(0, used + $4), updated_at = NOW()
     WHERE employee_id = $1 AND leave_type = $2 AND year = $3
     RETURNING *`,
    [employeeId, leaveType, year, deltaDays]
  );
  return rows[0];
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

async function getStats(pool, year, auth = null) {
  const conditions = ['EXTRACT(YEAR FROM lr.from_date) = $1', 'e.deleted_at IS NULL'];
  const params = [year];
  const scoped = appendScopeToConditions(auth, conditions, params, 'e');

  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE lr.status IN ('Pending Manager Approval', 'Pending Dept Approval', 'Pending HR Approval'))::int AS pending,
       COUNT(*) FILTER (WHERE lr.status = 'Approved')::int AS approved,
       COUNT(*) FILTER (WHERE lr.status LIKE 'Rejected%')::int AS rejected,
       COUNT(*)::int AS total
     FROM leave_requests lr
     JOIN employees e ON e.id = lr.employee_id
     WHERE ${scoped.conditions.join(' AND ')}`,
    scoped.params
  );
  return rows[0];
}

module.exports = {
  findRequests, findAllRequests, countAllRequests, findRequestById,
  insertRequest, updateRequestStatus,
  findActiveLeaveType,
  findActiveLeaveTypeById,
  getActiveLeaveTypes,
  getBalanceForType, findOverlappingRequest, sumPendingDaysForType,
  getBalances, getAllBalances, upsertBalance,
  lockBalanceForUpdate, incrementUsed,
  getStats,
};
