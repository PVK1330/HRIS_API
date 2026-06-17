'use strict';

const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const { hasPermission } = require('../../services/authz.service');
const { P } = require('../../constants/permissions');
const auditService = require('../audit/audit.service');

// ─── Shift-change approval helpers (column-based, hierarchy-aware) ─────────────
// Mirrors the attendance regularization / overtime staged model:
//   Stage 1 'manager' -> Reporting Manager (pruned when the employee has none)
//   Stage 2 'hr'      -> HR / Admin (final authority)

const SHIFT_STAGE_LABELS = { manager: 'Reporting Manager', hr: 'HR' };

/** Ordered active stages for an employee, pruning the manager stage if none. */
function buildShiftChangeStages(emp) {
  const stages = ['manager', 'hr'];
  const active = stages.filter((s) => (s === 'manager' ? Boolean(emp?.reporting_manager_id) : true));
  return active.length ? active : ['hr'];
}

/** HR / admin override: may act on any stage. */
function isShiftApprovalOverride(auth) {
  return Boolean(auth?.isTenantAdmin) || hasPermission(auth, P.SHIFT_MANAGE);
}

/**
 * Non-throwing: is `auth` the responsible approver for `stage` of `emp`'s request
 * right now? Drives the per-row `can_act` flag (Approve/Reject visibility) and the
 * server-side authorization guard. Never allows self-approval.
 */
function canActOnShiftStage(auth, emp, stage) {
  if (!auth || !stage || !emp) return false;
  if (Number(emp.id) === Number(auth.employeeId)) return false; // no self-approval
  if (isShiftApprovalOverride(auth)) return true;
  if (stage === 'manager') {
    return emp.reporting_manager_id != null
      && Number(emp.reporting_manager_id) === Number(auth.employeeId);
  }
  // 'hr' stage requires SHIFT_MANAGE / admin, already covered by the override above.
  return false;
}

class ShiftsService {
  // ─── Shifts CRUD ────────────────────────────────────────────────────────────

  async listShifts(dbName, filters = {}) {
    const pool = getTenantPool(dbName);
    const conditions = [];
    const params = [];
    let i = 1;

    if (!filters.includeInactive) {
      conditions.push('s.is_active = true');
    }

    // shift_type column removed in migration 129

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT * FROM shifts s ${where} ORDER BY s.name ASC`,
      params,
    );
    return rows;
  }

  async getShift(dbName, id) {
    const pool = getTenantPool(dbName);
    const { rows } = await pool.query(`SELECT * FROM shifts WHERE id = $1`, [id]);
    if (!rows[0]) throw ApiError.notFound('Shift not found');
    return rows[0];
  }

  async createShift(dbName, data) {
    const pool = getTenantPool(dbName);
    const {
      name,
      start_time,
      end_time,
      break_minutes = 0,
      grace_minutes = 0,
      minimum_hours = null,
      overtime_after_hours = null,
      is_night_shift = false,
    } = data;

    const { rows } = await pool.query(
      `INSERT INTO shifts
         (name, start_time, end_time, break_minutes, grace_minutes,
          minimum_hours, overtime_after_hours, is_night_shift)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        name,
        start_time,
        end_time,
        break_minutes,
        grace_minutes,
        minimum_hours,
        overtime_after_hours,
        is_night_shift,
      ],
    );
    return rows[0];
  }

  async updateShift(dbName, id, data) {
    const pool = getTenantPool(dbName);

    const allowed = [
      'name',
      'start_time',
      'end_time',
      'break_minutes',
      'grace_minutes',
      'minimum_hours',
      'overtime_after_hours',
      'is_night_shift',
      'is_active',
    ];

    const fields = [];
    const params = [];
    let n = 1;

    for (const col of allowed) {
      if (data[col] !== undefined) {
        params.push(data[col]);
        fields.push(`${col} = $${n++}`);
      }
    }

    if (!fields.length) return this.getShift(dbName, id);

    fields.push('updated_at = NOW()');
    params.push(id);

    const { rows } = await pool.query(
      `UPDATE shifts SET ${fields.join(', ')} WHERE id = $${n} RETURNING *`,
      params,
    );
    if (!rows[0]) throw ApiError.notFound('Shift not found');
    return rows[0];
  }

  async deleteShift(dbName, id) {
    const pool = getTenantPool(dbName);
    const { rowCount } = await pool.query(
      `UPDATE shifts SET is_active = false, updated_at = NOW() WHERE id = $1`,
      [id],
    );
    if (!rowCount) throw ApiError.notFound('Shift not found');
    return { deleted: true };
  }

  // ─── Assignments ─────────────────────────────────────────────────────────────

  async listAssignments(dbName, filters = {}) {
    const pool = getTenantPool(dbName);
    const conditions = [];
    const params = [];
    let i = 1;

    if (filters.employeeId) {
      params.push(filters.employeeId);
      conditions.push(`esa.employee_id = $${i++}`);
    }

    if (filters.shiftId) {
      params.push(filters.shiftId);
      conditions.push(`esa.shift_id = $${i++}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT
         esa.id,
         esa.employee_id,
         esa.shift_id,
         esa.effective_from,
         esa.effective_to,
         esa.is_rotational,
         esa.created_at,
         e.first_name || ' ' || e.last_name AS employee_name,
         e.emp_id,
         s.name AS shift_name
       FROM employee_shift_assignments esa
       JOIN employees e ON e.id = esa.employee_id
       JOIN shifts s ON s.id = esa.shift_id
       ${where}
       ORDER BY esa.effective_from DESC`,
      params,
    );
    return rows;
  }

  async assignShift(dbName, data) {
    const pool = getTenantPool(dbName);
    const {
      employee_id,
      shift_id,
      effective_from,
      effective_to = null,
      is_rotational = false,
    } = data;

    const { rows } = await pool.query(
      `INSERT INTO employee_shift_assignments
         (employee_id, shift_id, effective_from, effective_to, is_rotational)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (employee_id, effective_from)
       DO UPDATE SET
         shift_id = EXCLUDED.shift_id,
         effective_to = EXCLUDED.effective_to,
         is_rotational = EXCLUDED.is_rotational
       RETURNING *`,
      [employee_id, shift_id, effective_from, effective_to, is_rotational],
    );
    return rows[0];
  }

  /**
   * Bulk-assign one shift to many employees in a single transaction.
   * Upserts on (employee_id, effective_from) so re-running is idempotent.
   */
  async bulkAssignShift(dbName, data) {
    const pool = getTenantPool(dbName);
    const {
      employee_ids,
      shift_id,
      effective_from,
      effective_to = null,
      is_rotational = false,
    } = data;

    if (!Array.isArray(employee_ids) || !employee_ids.length) {
      throw ApiError.badRequest('employee_ids must be a non-empty array');
    }
    if (!shift_id) throw ApiError.badRequest('shift_id is required');
    if (!effective_from) throw ApiError.badRequest('effective_from is required');

    const { rows: shiftRows } = await pool.query(
      `SELECT id FROM shifts WHERE id = $1 AND is_active = true`,
      [shift_id],
    );
    if (!shiftRows[0]) throw ApiError.badRequest('Shift not found or inactive');

    // De-dupe ids so a repeated employee doesn't conflict within the same batch.
    const ids = [...new Set(employee_ids.map((x) => Number(x)).filter((x) => Number.isFinite(x)))];

    const client = await pool.connect();
    const assignments = [];
    try {
      await client.query('BEGIN');
      for (const empId of ids) {
        const { rows } = await client.query(
          `INSERT INTO employee_shift_assignments
             (employee_id, shift_id, effective_from, effective_to, is_rotational)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (employee_id, effective_from)
           DO UPDATE SET
             shift_id = EXCLUDED.shift_id,
             effective_to = EXCLUDED.effective_to,
             is_rotational = EXCLUDED.is_rotational
           RETURNING *`,
          [empId, shift_id, effective_from, effective_to, is_rotational],
        );
        assignments.push(rows[0]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return { assigned_count: assignments.length, assignments };
  }

  async removeAssignment(dbName, id) {
    const pool = getTenantPool(dbName);
    const { rowCount } = await pool.query(
      `DELETE FROM employee_shift_assignments WHERE id = $1`,
      [id],
    );
    if (!rowCount) throw ApiError.notFound('Assignment not found');
    return { deleted: true };
  }

  async getEmployeeCurrentShift(dbName, employeeId) {
    const pool = getTenantPool(dbName);
    const { rows } = await pool.query(
      `SELECT
         esa.id AS assignment_id,
         esa.employee_id,
         esa.shift_id,
         esa.effective_from,
         esa.effective_to,
         esa.is_rotational,
         s.name,
         s.start_time,
         s.end_time,
         s.break_minutes,
         s.grace_minutes,
         s.minimum_hours,
         s.overtime_after_hours,
         s.is_night_shift
       FROM employee_shift_assignments esa
       JOIN shifts s ON s.id = esa.shift_id
       WHERE esa.employee_id = $1
         AND esa.effective_from <= NOW()
         AND (esa.effective_to IS NULL OR esa.effective_to >= NOW())
       ORDER BY esa.effective_from DESC
       LIMIT 1`,
      [employeeId],
    );
    return rows[0] || null;
  }

  // ─── Change Requests ─────────────────────────────────────────────────────────

  async listChangeRequests(dbName, filters = {}, auth = null) {
    const pool = getTenantPool(dbName);

    // Non-admin/HR callers can only see their own requests.
    const canManage = auth?.role === 'admin' || auth?.role === 'hr';
    if (!canManage && auth?.employeeId) {
      filters = { ...filters, employeeId: auth.employeeId };
    }

    const conditions = [];
    const params = [];
    let i = 1;

    if (filters.status) {
      params.push(filters.status);
      conditions.push(`scr.status = $${i++}`);
    }

    if (filters.employeeId) {
      params.push(filters.employeeId);
      conditions.push(`scr.employee_id = $${i++}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT
         scr.id,
         scr.employee_id,
         scr.current_shift_id,
         scr.requested_shift_id,
         scr.effective_date,
         scr.reason,
         scr.status,
         scr.current_stage,
         scr.manager_status,
         scr.hr_status,
         scr.approved_by,
         scr.approved_at,
         scr.rejection_reason,
         scr.created_at,
         scr.updated_at,
         e.first_name || ' ' || e.last_name AS employee_name,
         e.emp_id,
         e.reporting_manager_id,
         e.department_id,
         e.department,
         rs.name AS requested_shift_name,
         cs.name AS current_shift_name
       FROM shift_change_requests scr
       JOIN employees e ON e.id = scr.employee_id
       JOIN shifts rs ON rs.id = scr.requested_shift_id
       LEFT JOIN shifts cs ON cs.id = scr.current_shift_id
       ${where}
       ORDER BY scr.created_at DESC`,
      params,
    );

    return rows.map((r) => {
      const stage = r.status === 'Pending' ? (r.current_stage || 'manager') : null;
      const emp = {
        id: r.employee_id,
        reporting_manager_id: r.reporting_manager_id,
        department_id: r.department_id,
        department: r.department,
      };
      return {
        ...r,
        pending_stage: stage,
        pending_stage_label: stage ? SHIFT_STAGE_LABELS[stage] : null,
        can_act: stage ? canActOnShiftStage(auth, emp, stage) : false,
      };
    });
  }

  async createChangeRequest(dbName, data, user, req = null) {
    const pool = getTenantPool(dbName);

    // Determine employee_id: HR/admin may pass it; employees use their own id.
    const employeeId = data.employee_id || user.employeeId;
    if (!employeeId) throw ApiError.badRequest('employee_id is required');

    // Only admins / users with shift.manage may submit on behalf of another employee.
    if (data.employee_id && Number(data.employee_id) !== Number(user.employeeId)) {
      const canManage = user.role === 'admin' || (Array.isArray(user.permissions) && user.permissions.includes('shift.manage'));
      if (!canManage) throw ApiError.forbidden('You can only submit shift change requests for yourself');
    }
    if (!data.requested_shift_id) throw ApiError.badRequest('requested_shift_id is required');
    if (!data.effective_date) throw ApiError.badRequest('effective_date is required');

    // Requested shift must exist and be active.
    const { rows: shiftRows } = await pool.query(
      `SELECT id, is_active FROM shifts WHERE id = $1`,
      [data.requested_shift_id],
    );
    if (!shiftRows[0]) throw ApiError.notFound('Requested shift not found');
    if (shiftRows[0].is_active === false) throw ApiError.badRequest('Requested shift is inactive');

    // Resolve the employee's current shift; reject a no-op request.
    const current = await this.getEmployeeCurrentShift(dbName, employeeId);
    const currentShiftId = current ? current.shift_id : null;
    if (currentShiftId && Number(currentShiftId) === Number(data.requested_shift_id)) {
      throw ApiError.badRequest('Employee is already assigned to the requested shift');
    }

    // One open request at a time per employee.
    const { rows: dup } = await pool.query(
      `SELECT id FROM shift_change_requests WHERE employee_id = $1 AND status = 'Pending' LIMIT 1`,
      [employeeId],
    );
    if (dup[0]) {
      throw ApiError.badRequest('A pending shift change request already exists for this employee');
    }

    // Build the active approval stage chain and start at the first stage.
    const { rows: empRows } = await pool.query(
      `SELECT id, reporting_manager_id FROM employees WHERE id = $1 AND deleted_at IS NULL`,
      [employeeId],
    );
    if (!empRows[0]) throw ApiError.notFound('Employee not found');
    const stages = buildShiftChangeStages(empRows[0]);
    const firstStage = stages[0];

    const { rows } = await pool.query(
      `INSERT INTO shift_change_requests
         (employee_id, current_shift_id, requested_shift_id, effective_date, reason, status, current_stage)
       VALUES ($1,$2,$3,$4,$5,'Pending',$6)
       RETURNING *`,
      [
        employeeId,
        currentShiftId,
        data.requested_shift_id,
        data.effective_date,
        data.reason || null,
        firstStage,
      ],
    );

    await auditService.logAction(dbName, {
      actorEmployeeId: user.employeeId || null,
      actorName: user.name || user.email || null,
      action: 'shift.change_request.submit',
      module: 'shift',
      entityType: 'shift_change_request',
      entityId: rows[0].id,
      newValue: rows[0],
      ipAddress: req?.ip || null,
      userAgent: req?.headers?.['user-agent'] || null,
    });

    return rows[0];
  }

  /**
   * Hierarchy-aware staged action on a shift change request.
   *
   * Stage 'manager' (approve) -> advances to 'hr' (or completes if HR was pruned).
   * Stage 'hr'      (approve) -> Approved + a new assignment is created atomically.
   * Any stage       (reject)  -> Rejected.
   *
   * No self-approval. Manager stage = direct reporting manager; HR stage = SHIFT_MANAGE/admin.
   */
  async actOnChangeRequest(dbName, id, action, auth, user, reason, req = null) {
    const pool = getTenantPool(dbName);
    // Accept both 'approve'/'reject' (inbox) and 'Approved'/'Rejected' (shift UI).
    const a = String(action || '').toLowerCase();
    const normalizedAction = (a === 'approve' || a === 'approved') ? 'approve'
      : (a === 'reject' || a === 'rejected') ? 'reject'
        : null;
    if (!normalizedAction) {
      throw ApiError.badRequest('action must be approve or reject');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: existing } = await client.query(
        `SELECT scr.*, e.reporting_manager_id, e.department_id, e.department
           FROM shift_change_requests scr
           JOIN employees e ON e.id = scr.employee_id
          WHERE scr.id = $1
          FOR UPDATE OF scr`,
        [id],
      );
      if (!existing[0]) throw ApiError.notFound('Change request not found');

      const request = existing[0];
      if (request.status !== 'Pending') {
        throw ApiError.badRequest(`Change request is already ${request.status}`);
      }

      const emp = {
        id: request.employee_id,
        reporting_manager_id: request.reporting_manager_id,
        department_id: request.department_id,
        department: request.department,
      };

      if (Number(emp.id) === Number(auth?.employeeId)) {
        throw ApiError.forbidden('You cannot act on your own shift change request');
      }

      const stages = buildShiftChangeStages(emp);
      let stage = request.current_stage;
      if (!stage || stage === 'done') stage = stages[0]; // repair legacy / unset rows

      if (!canActOnShiftStage(auth, emp, stage)) {
        throw ApiError.forbidden(
          stage === 'manager'
            ? 'Only the direct reporting manager can act on this stage'
            : 'Only HR or admin can give final approval for this request',
        );
      }

      const approverId = auth?.employeeId || user?.employeeId || user?.id || null;
      const stageCols = stage === 'manager'
        ? 'manager_status = $1, manager_acted_by = $2, manager_acted_at = NOW()'
        : 'hr_status = $1, hr_acted_by = $2, hr_acted_at = NOW()';

      let updated;

      if (normalizedAction === 'reject') {
        const { rows } = await client.query(
          `UPDATE shift_change_requests
              SET ${stageCols},
                  status = 'Rejected',
                  current_stage = 'done',
                  rejection_reason = $3,
                  approved_by = $2,
                  approved_at = NOW(),
                  updated_at = NOW()
            WHERE id = $4
            RETURNING *`,
          ['Rejected', approverId, reason || null, id],
        );
        updated = rows[0];
      } else {
        const idx = stages.indexOf(stage);
        const next = idx >= 0 ? stages[idx + 1] : undefined;

        if (next) {
          // Advance to the next stage; request stays Pending.
          const { rows } = await client.query(
            `UPDATE shift_change_requests
                SET ${stageCols},
                    current_stage = $3,
                    updated_at = NOW()
              WHERE id = $4
              RETURNING *`,
            ['Approved', approverId, next, id],
          );
          updated = rows[0];
        } else {
          // Final approval — complete + create the assignment atomically.
          const { rows } = await client.query(
            `UPDATE shift_change_requests
                SET ${stageCols},
                    status = 'Approved',
                    current_stage = 'done',
                    approved_by = $2,
                    approved_at = NOW(),
                    updated_at = NOW()
              WHERE id = $3
              RETURNING *`,
            ['Approved', approverId, id],
          );
          updated = rows[0];

          await client.query(
            `INSERT INTO employee_shift_assignments
               (employee_id, shift_id, effective_from, effective_to, is_rotational)
             VALUES ($1, $2, $3, NULL, false)
             ON CONFLICT (employee_id, effective_from)
             DO UPDATE SET
               shift_id = EXCLUDED.shift_id,
               effective_to = EXCLUDED.effective_to,
               is_rotational = EXCLUDED.is_rotational`,
            [request.employee_id, request.requested_shift_id, request.effective_date],
          );
        }
      }

      await client.query('COMMIT');

      await auditService.logAction(dbName, {
        actorEmployeeId: approverId,
        actorName: user?.name || user?.email || null,
        action: `shift.change_request.${stage}_${normalizedAction}`,
        module: 'shift',
        entityType: 'shift_change_request',
        entityId: id,
        oldValue: { status: request.status, current_stage: request.current_stage },
        newValue: { status: updated.status, current_stage: updated.current_stage },
        ipAddress: req?.ip || null,
        userAgent: req?.headers?.['user-agent'] || null,
      });

      return updated;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = new ShiftsService();
module.exports.buildShiftChangeStages = buildShiftChangeStages;
module.exports.canActOnShiftStage = canActOnShiftStage;
