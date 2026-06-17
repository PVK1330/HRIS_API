'use strict';

const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const attendanceService = require('../employees/attendance/attendance.service');
const attAuthz = require('../employees/attendance/attendanceAuth.service');
const shiftsService = require('../shifts/shifts.service');

// ─── Unified inbox helpers (column-based, hierarchy-aware) ────────────────────
// The Approval Inbox aggregates the REAL staged queues that already exist on the
// attendance table (regularization + overtime) and shift_change_requests, rather
// than a disconnected generic engine. Each row's stage + can_act are resolved
// against the org hierarchy (reporting_manager_id / dept head / HR scope).

const STAGE_LABELS = { manager: 'Reporting Manager', department: 'Department Head', hr: 'HR' };

function regStatusToStage(status) {
  if (status === 'Pending') return 'manager';
  if (status === 'Manager_Approved') return 'department';
  if (status === 'Dept_Approved') return 'hr';
  return null;
}

function stageIndex(stage) {
  if (stage === 'manager') return 1;
  if (stage === 'department') return 2;
  if (stage === 'hr') return 3;
  return 1;
}

/** Map any module status to the frontend's PENDING/APPROVED/REJECTED/WITHDRAWN set. */
function normalizeStatus(status) {
  const v = String(status || '').toLowerCase();
  if (v.includes('reject')) return 'REJECTED';
  if (v === 'approved' || v === 'regularization approved') return 'APPROVED';
  if (v === 'cancelled' || v === 'withdrawn') return 'WITHDRAWN';
  return 'PENDING';
}

class ApprovalEngineService {
  // ─── Workflows ───────────────────────────────────────────────────────────────

  async listWorkflows(dbName, filters = {}) {
    const pool = getTenantPool(dbName);
    const conditions = [];
    const params = [];
    let i = 1;

    if (filters.module) {
      params.push(filters.module);
      conditions.push(`aw.module = $${i++}`);
    }

    if (filters.is_active !== undefined && filters.is_active !== '') {
      params.push(filters.is_active === 'true' || filters.is_active === true);
      conditions.push(`aw.is_active = $${i++}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT aw.*,
              COUNT(aws.id)::int AS stage_count
         FROM approval_workflows aw
         LEFT JOIN approval_workflow_stages aws ON aws.workflow_id = aw.id
        ${where}
        GROUP BY aw.id
        ORDER BY aw.name ASC`,
      params,
    );
    return rows;
  }

  async getWorkflow(dbName, id) {
    const pool = getTenantPool(dbName);

    const { rows: wfRows } = await pool.query(
      `SELECT * FROM approval_workflows WHERE id = $1`,
      [id],
    );
    if (!wfRows[0]) throw ApiError.notFound('Workflow not found');

    const { rows: stageRows } = await pool.query(
      `SELECT * FROM approval_workflow_stages
        WHERE workflow_id = $1
        ORDER BY stage_order ASC`,
      [id],
    );

    return { ...wfRows[0], stages: stageRows };
  }

  async createWorkflow(dbName, data) {
    const pool = getTenantPool(dbName);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { name, module, description, is_active = true, stages = [] } = data;

      const { rows } = await client.query(
        `INSERT INTO approval_workflows (name, module, description, is_active)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [name, module, description || null, is_active],
      );
      const workflow = rows[0];

      const insertedStages = [];
      for (const stage of stages) {
        const { rows: sr } = await client.query(
          `INSERT INTO approval_workflow_stages
             (workflow_id, stage_order, stage_name, approver_type,
              approver_role_id, approver_employee_id, mode,
              sla_hours, escalation_hours, is_optional)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING *`,
          [
            workflow.id,
            stage.stage_order,
            stage.stage_name,
            stage.approver_type,
            stage.approver_role_id || null,
            stage.approver_employee_id || null,
            stage.mode || null,
            stage.sla_hours || null,
            stage.escalation_hours || null,
            stage.is_optional || false,
          ],
        );
        insertedStages.push(sr[0]);
      }

      await client.query('COMMIT');
      return { ...workflow, stages: insertedStages };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async updateWorkflow(dbName, id, data) {
    const pool = getTenantPool(dbName);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { name, module, description, is_active, stages } = data;

      const setClauses = [];
      const params = [];
      let i = 1;

      if (name !== undefined)        { params.push(name);        setClauses.push(`name = $${i++}`); }
      if (module !== undefined)      { params.push(module);      setClauses.push(`module = $${i++}`); }
      if (description !== undefined) { params.push(description); setClauses.push(`description = $${i++}`); }
      if (is_active !== undefined)   { params.push(is_active);   setClauses.push(`is_active = $${i++}`); }

      let workflow;
      if (setClauses.length) {
        params.push(id);
        const { rows } = await client.query(
          `UPDATE approval_workflows SET ${setClauses.join(', ')} WHERE id = $${i} RETURNING *`,
          params,
        );
        if (!rows[0]) throw ApiError.notFound('Workflow not found');
        workflow = rows[0];
      } else {
        const { rows } = await client.query(
          `SELECT * FROM approval_workflows WHERE id = $1`,
          [id],
        );
        if (!rows[0]) throw ApiError.notFound('Workflow not found');
        workflow = rows[0];
      }

      let updatedStages;
      if (stages !== undefined) {
        await client.query(
          `DELETE FROM approval_workflow_stages WHERE workflow_id = $1`,
          [id],
        );
        updatedStages = [];
        for (const stage of stages) {
          const { rows: sr } = await client.query(
            `INSERT INTO approval_workflow_stages
               (workflow_id, stage_order, stage_name, approver_type,
                approver_role_id, approver_employee_id, mode,
                sla_hours, escalation_hours, is_optional)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             RETURNING *`,
            [
              id,
              stage.stage_order,
              stage.stage_name,
              stage.approver_type,
              stage.approver_role_id || null,
              stage.approver_employee_id || null,
              stage.mode || null,
              stage.sla_hours || null,
              stage.escalation_hours || null,
              stage.is_optional || false,
            ],
          );
          updatedStages.push(sr[0]);
        }
      } else {
        const { rows: sr } = await client.query(
          `SELECT * FROM approval_workflow_stages WHERE workflow_id = $1 ORDER BY stage_order ASC`,
          [id],
        );
        updatedStages = sr;
      }

      await client.query('COMMIT');
      return { ...workflow, stages: updatedStages };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ─── Pending Approvals ───────────────────────────────────────────────────────

  /**
   * Unified pending inbox: every staged request the logged-in actor can act on
   * RIGHT NOW, aggregated from the real column-based queues. Scope/segregation is
   * enforced per-row via can_act (so the actor only ever sees actionable items).
   */
  async getPendingApprovals(auth, user) {
    const dbName = user.db_name;
    const pool = getTenantPool(dbName);
    const items = [];

    // 1) Attendance regularization
    const { rows: regRows } = await pool.query(
      `SELECT a.id, a.employee_id, TO_CHAR(a.date,'YYYY-MM-DD') AS date,
              a.regularization_status, a.reg_current_stage, a.regularization_reason,
              a.created_at,
              e.full_name AS employee_name, e.emp_id,
              e.reporting_manager_id, e.department_id, e.department
         FROM attendance a
         JOIN employees e ON e.id = a.employee_id AND e.deleted_at IS NULL
        WHERE a.regularization_status IN ('Pending','Manager_Approved','Dept_Approved')
        ORDER BY a.created_at ASC NULLS LAST`,
    );
    for (const r of regRows) {
      const stage = r.reg_current_stage && r.reg_current_stage !== 'done'
        ? r.reg_current_stage
        : regStatusToStage(r.regularization_status);
      const emp = {
        id: r.employee_id,
        reporting_manager_id: r.reporting_manager_id,
        department_id: r.department_id,
        department: r.department,
      };
      if (!stage || !attAuthz.canActOnStage(auth, emp, stage, { employee_id: r.employee_id })) continue;
      items.push({
        id: r.id,
        source: 'regularization',
        module: 'regularization',
        entity_type: 'Attendance Regularization',
        employee_name: r.employee_name,
        employee_code: r.emp_id,
        submitted_at: r.created_at,
        current_stage: stageIndex(stage),
        total_stages: 3,
        stage_label: STAGE_LABELS[stage],
        can_act: true,
        detail: { date: r.date, reason: r.regularization_reason },
      });
    }

    // 2) Overtime
    const { rows: otRows } = await pool.query(
      `SELECT a.id, a.employee_id, TO_CHAR(a.date,'YYYY-MM-DD') AS date,
              a.overtime_status, a.overtime_hours, a.created_at,
              e.full_name AS employee_name, e.emp_id,
              e.reporting_manager_id, e.department_id, e.department
         FROM attendance a
         JOIN employees e ON e.id = a.employee_id AND e.deleted_at IS NULL
        WHERE a.overtime_status IN ('Pending','Manager_Approved','Dept_Approved')
        ORDER BY a.created_at ASC NULLS LAST`,
    );
    for (const r of otRows) {
      const stage = attAuthz.overtimeStatusToStage(r.overtime_status);
      const emp = {
        id: r.employee_id,
        reporting_manager_id: r.reporting_manager_id,
        department_id: r.department_id,
        department: r.department,
      };
      if (!stage || !attAuthz.canActOnStage(auth, emp, stage, { employee_id: r.employee_id })) continue;
      items.push({
        id: r.id,
        source: 'overtime',
        module: 'overtime',
        entity_type: 'Overtime',
        employee_name: r.employee_name,
        employee_code: r.emp_id,
        submitted_at: r.created_at,
        current_stage: stageIndex(stage),
        total_stages: 3,
        stage_label: STAGE_LABELS[stage],
        can_act: true,
        detail: { date: r.date, hours: r.overtime_hours },
      });
    }

    // 3) Shift change requests
    const { rows: scRows } = await pool.query(
      `SELECT scr.id, scr.employee_id, scr.current_stage, scr.effective_date,
              scr.reason, scr.created_at,
              e.full_name AS employee_name, e.emp_id,
              e.reporting_manager_id, e.department_id, e.department,
              rs.name AS requested_shift_name
         FROM shift_change_requests scr
         JOIN employees e ON e.id = scr.employee_id AND e.deleted_at IS NULL
         JOIN shifts rs ON rs.id = scr.requested_shift_id
        WHERE scr.status = 'Pending'
        ORDER BY scr.created_at ASC`,
    );
    for (const r of scRows) {
      const stage = r.current_stage && r.current_stage !== 'done' ? r.current_stage : 'manager';
      const emp = {
        id: r.employee_id,
        reporting_manager_id: r.reporting_manager_id,
        department_id: r.department_id,
        department: r.department,
      };
      if (!shiftsService.canActOnShiftStage(auth, emp, stage)) continue;
      items.push({
        id: r.id,
        source: 'shift',
        module: 'shift',
        entity_type: 'Shift Change',
        employee_name: r.employee_name,
        employee_code: r.emp_id,
        submitted_at: r.created_at,
        current_stage: stage === 'manager' ? 1 : 2,
        total_stages: 2,
        stage_label: stage === 'manager' ? STAGE_LABELS.manager : STAGE_LABELS.hr,
        can_act: true,
        detail: { effective_date: r.effective_date, requested_shift: r.requested_shift_name, reason: r.reason },
      });
    }

    items.sort((a, b) => new Date(a.submitted_at || 0) - new Date(b.submitted_at || 0));
    return items;
  }

  // ─── Actions ─────────────────────────────────────────────────────────────────

  /**
   * Dispatch an approve/reject to the owning module's column-based workflow.
   * Authorization (stage hierarchy, no self-approval) is enforced inside each
   * module's service — this only routes by `source`.
   */
  async actOnRequest(auth, user, { source, id, action, remarks }, req) {
    const act = String(action || '').toLowerCase();
    const verb = (act === 'approved' || act === 'approve') ? 'approve'
      : (act === 'rejected' || act === 'reject') ? 'reject'
        : null;
    if (!verb) throw ApiError.badRequest('action must be approve or reject');
    if (verb === 'reject' && !String(remarks || '').trim()) {
      throw ApiError.badRequest('A rejection reason is required');
    }

    switch (source) {
      case 'regularization':
        return attendanceService.regularize(auth, user, id, { action: verb, reason: remarks }, req);
      case 'overtime':
        return attendanceService.processOvertime(auth, user, id, { action: verb, reason: remarks }, req);
      case 'shift':
        return shiftsService.actOnChangeRequest(user.db_name, id, verb, auth, user, remarks, req);
      default:
        throw ApiError.badRequest('Unknown approval source');
    }
  }

  // ─── Requests ────────────────────────────────────────────────────────────────

  async createRequest(dbName, data) {
    const pool = getTenantPool(dbName);
    const { module, entity_type, entity_id, employee_id, workflow_id } = data;

    // Determine total stages from workflow
    const { rows: stageCount } = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM approval_workflow_stages WHERE workflow_id = $1`,
      [workflow_id],
    );
    const totalStages = stageCount[0]?.cnt || 0;
    if (totalStages === 0) {
      throw ApiError.badRequest('Selected workflow has no stages defined');
    }

    const { rows } = await pool.query(
      `INSERT INTO approval_requests
         (workflow_id, module, entity_type, entity_id, employee_id,
          current_stage, total_stages, status, submitted_at)
       VALUES ($1,$2,$3,$4,$5, 1, $6, 'PENDING', NOW())
       RETURNING *`,
      [workflow_id, module, entity_type, entity_id, employee_id, totalStages],
    );
    return rows[0];
  }

  /**
   * The logged-in employee's own submitted requests across every module, with
   * their current status/stage — for the "My Requests" tab.
   */
  async getMyRequests(auth, user) {
    const dbName = user.db_name;
    const pool = getTenantPool(dbName);
    const employeeId = auth?.employeeId || user?.employeeId;
    if (!employeeId) return [];

    const items = [];

    const { rows: reg } = await pool.query(
      `SELECT a.id, TO_CHAR(a.date,'YYYY-MM-DD') AS date,
              a.regularization_status, a.reg_current_stage, a.created_at
         FROM attendance a
        WHERE a.employee_id = $1
          AND COALESCE(a.regularization_status,'N/A') NOT IN ('N/A','None')
        ORDER BY a.created_at DESC NULLS LAST
        LIMIT 100`,
      [employeeId],
    );
    for (const r of reg) {
      const stage = r.reg_current_stage && r.reg_current_stage !== 'done'
        ? r.reg_current_stage
        : regStatusToStage(r.regularization_status);
      items.push({
        id: r.id,
        source: 'regularization',
        module: 'regularization',
        entity_type: 'Attendance Regularization',
        submitted_at: r.created_at,
        current_stage: stageIndex(stage),
        total_stages: 3,
        status: normalizeStatus(r.regularization_status),
        action_trail: [],
      });
    }

    const { rows: ot } = await pool.query(
      `SELECT a.id, TO_CHAR(a.date,'YYYY-MM-DD') AS date,
              a.overtime_status, a.overtime_hours, a.created_at
         FROM attendance a
        WHERE a.employee_id = $1
          AND COALESCE(a.overtime_status,'None') <> 'None'
          AND COALESCE(a.overtime_hours,0) > 0
        ORDER BY a.created_at DESC NULLS LAST
        LIMIT 100`,
      [employeeId],
    );
    for (const r of ot) {
      const stage = attAuthz.overtimeStatusToStage(r.overtime_status);
      items.push({
        id: r.id,
        source: 'overtime',
        module: 'overtime',
        entity_type: 'Overtime',
        submitted_at: r.created_at,
        current_stage: stage ? stageIndex(stage) : 3,
        total_stages: 3,
        status: normalizeStatus(r.overtime_status),
        action_trail: [],
      });
    }

    const { rows: sc } = await pool.query(
      `SELECT scr.id, scr.current_stage, scr.status, scr.created_at,
              rs.name AS requested_shift_name
         FROM shift_change_requests scr
         JOIN shifts rs ON rs.id = scr.requested_shift_id
        WHERE scr.employee_id = $1
        ORDER BY scr.created_at DESC
        LIMIT 100`,
      [employeeId],
    );
    for (const r of sc) {
      const stage = r.current_stage && r.current_stage !== 'done' ? r.current_stage : 'hr';
      items.push({
        id: r.id,
        source: 'shift',
        module: 'shift',
        entity_type: 'Shift Change',
        submitted_at: r.created_at,
        current_stage: stage === 'manager' ? 1 : 2,
        total_stages: 2,
        status: normalizeStatus(r.status),
        action_trail: [],
      });
    }

    items.sort((a, b) => new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0));
    return items;
  }

  // ─── Delegations ─────────────────────────────────────────────────────────────

  async listDelegations(dbName, employeeId) {
    const pool = getTenantPool(dbName);
    const { rows } = await pool.query(
      `SELECT ad.*,
              de.first_name AS delegate_first_name,
              de.last_name  AS delegate_last_name
         FROM approval_delegations ad
         LEFT JOIN employees de ON de.id = ad.delegate_employee_id
        WHERE ad.delegator_employee_id = $1
        ORDER BY ad.from_date DESC`,
      [employeeId],
    );
    return rows;
  }

  async createDelegation(dbName, data) {
    const pool = getTenantPool(dbName);
    const {
      delegator_employee_id,
      delegate_employee_id,
      module,
      from_date,
      to_date,
    } = data;

    if (parseInt(delegator_employee_id, 10) === parseInt(delegate_employee_id, 10)) {
      throw ApiError.badRequest('Cannot delegate to yourself');
    }

    const { rows } = await pool.query(
      `INSERT INTO approval_delegations
         (delegator_employee_id, delegate_employee_id, module,
          from_date, to_date, is_active)
       VALUES ($1,$2,$3,$4,$5, true)
       RETURNING *`,
      [delegator_employee_id, delegate_employee_id, module || null, from_date, to_date],
    );
    return rows[0];
  }

  async revokeDelegation(dbName, id, employeeId) {
    const pool = getTenantPool(dbName);
    const { rows } = await pool.query(
      `UPDATE approval_delegations
          SET is_active = false
        WHERE id = $1
          AND delegator_employee_id = $2
        RETURNING *`,
      [id, employeeId],
    );
    if (!rows[0]) {
      throw ApiError.notFound('Delegation not found or you do not own it');
    }
    return rows[0];
  }
}

module.exports = new ApprovalEngineService();
