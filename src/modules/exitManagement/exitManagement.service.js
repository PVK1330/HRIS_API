'use strict';

/**
 * Exit Management runtime — exit_requests lifecycle on the stage engine.
 * Visibility/actions resolved ONLY via ExitAccessResolver (stage ownership), never scope.
 * Canonical tokens: status IN_PROGRESS active; exit_approvals.action uppercase.
 */

const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const resolver = require('./exitAccessResolver.service');
const engine = require('./exitStageEngine.service');

let notifications = null;
function notify() {
  if (!notifications) notifications = require('../notifications/notifications.service');
  return notifications;
}
let _events = null;
function events() {
  if (!_events) _events = require('./exitEvents.service');
  return _events;
}
function emit(tenant, room, event, payload) {
  try {
    const { getIo } = require('../../socket');
    const io = getIo();
    if (io) io.to(room).emit(event, payload);
  } catch (_) { /* non-blocking */ }
}

function empName(r) {
  return r?.full_name || [r?.first_name, r?.last_name].filter(Boolean).join(' ') || 'Unknown';
}

async function getDefaultWorkflowFor(pool, exitType) {
  const { rows } = await pool.query(
    `SELECT * FROM exit_workflows
     WHERE is_active = true AND (exit_type = $1 OR exit_type IS NULL)
       AND EXISTS (SELECT 1 FROM exit_workflow_stages s WHERE s.workflow_id = exit_workflows.id)
     ORDER BY (exit_type = $1) DESC NULLS LAST, is_default DESC, id ASC
     LIMIT 1`,
    [exitType],
  );
  return rows[0] || null;
}

/* ------------------------------------------------------------------ */
/*  Submit                                                            */
/* ------------------------------------------------------------------ */

async function submitExitRequest(tenant, data, exitUser) {
  const pool = await getTenantPool(tenant.dbName);
  const employeeId = data.employee_id || exitUser.employeeId;
  if (!employeeId) throw ApiError.badRequest('employee_id is required');

  const { rows: empRows } = await pool.query(
    `SELECT id, full_name, first_name, last_name, work_email, employment_status
     FROM employees WHERE id = $1 AND deleted_at IS NULL`, [employeeId],
  );
  if (!empRows.length) throw ApiError.notFound('Employee not found');

  const { rows: active } = await pool.query(
    `SELECT id FROM exit_requests
     WHERE employee_id = $1 AND status IN ('DRAFT','SUBMITTED','IN_PROGRESS')`, [employeeId],
  );
  if (active.length) throw ApiError.conflict('An active exit request already exists for this employee');

  const exitType = data.exit_type === 'termination' ? 'termination' : 'resignation';
  const workflow = await getDefaultWorkflowFor(pool, exitType);
  if (!workflow) throw ApiError.badRequest('No active exit workflow is configured. Configure one under Settings > Exit Management.');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const firstStage = await engine.getFirstStage(client, workflow.id);
    if (!firstStage) throw ApiError.badRequest('The configured workflow has no stages');

    const { rows: reqRows } = await client.query(
      `INSERT INTO exit_requests
         (employee_id, exit_type, termination_type_id, workflow_id, status,
          exit_reason, reason_detail, notice_date, resignation_date, last_working_day,
          notice_period_days, is_voluntary, initiated_by, submitted_at)
       VALUES ($1,$2,$3,$4,'SUBMITTED',$5,$6,$7,$8,$9,$10,$11,$12,NOW())
       RETURNING id`,
      [
        employeeId, exitType, data.termination_type_id || null, workflow.id,
        data.exit_reason || null, data.reason_detail || null, data.notice_date || null,
        data.resignation_date || null, data.last_working_day || null,
        data.notice_period_days || null,
        data.is_voluntary !== undefined ? data.is_voluntary : (exitType === 'resignation'),
        exitUser.employeeId || null,
      ],
    );
    const requestId = reqRows[0].id;

    // Enter stage 1 (sets IN_PROGRESS, pointers, PENDING slot, checklist seeding).
    await engine.seedStageEntry(client, requestId, firstStage);

    await client.query('COMMIT');

    emit(tenant, `tenant:${tenant.dbName}`, 'exit:request_created', { exitRequestId: Number(requestId) });
    // Notifications + template emails + stage-1 task assignment (best-effort, post-commit).
    events().onSubmitted(tenant, requestId).catch(() => {});

    return getExitRequest(tenant, requestId, exitUser);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/* ------------------------------------------------------------------ */
/*  List (visibility-gated) + Get one (derived stage state)          */
/* ------------------------------------------------------------------ */

async function listExitRequests(tenant, filters, exitUser) {
  const pool = await getTenantPool(tenant.dbName);
  const visibleIds = await resolver.listVisibleExitRequestIds(pool, exitUser, filters);
  if (!visibleIds.length) {
    return { records: [], pagination: { total: 0, page: 1, limit: Number(filters.limit) || 10, totalPages: 1 } };
  }

  const params = [visibleIds];
  const conds = ['er.id = ANY($1::bigint[])'];
  let i = 2;
  if (filters.status && filters.status !== 'all') { params.push(filters.status); conds.push(`er.status = $${i++}`); }
  if (filters.exit_type && filters.exit_type !== 'all') { params.push(filters.exit_type); conds.push(`er.exit_type = $${i++}`); }
  if (filters.employee_id) { params.push(Number(filters.employee_id)); conds.push(`er.employee_id = $${i++}`); }
  if (filters.search && filters.search.trim()) {
    params.push(`%${filters.search.trim()}%`);
    conds.push(`(e.full_name ILIKE $${i} OR COALESCE(er.exit_reason,'') ILIKE $${i})`); i++;
  }

  const page = Math.max(1, parseInt(filters.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(filters.limit, 10) || 10));
  const offset = (page - 1) * limit;

  const where = conds.join(' AND ');
  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM exit_requests er LEFT JOIN employees e ON e.id = er.employee_id WHERE ${where}`,
    params,
  );
  const total = countRows[0].total;

  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT er.id, er.employee_id, er.exit_type, er.status, er.workflow_id,
            er.current_stage_id, er.current_owner_department_id, er.last_working_day,
            er.exit_reason, er.created_at, er.submitted_at, er.stage_entered_at,
            e.full_name, e.first_name, e.last_name, e.job_title, e.department,
            s.name AS current_stage_name, s.stage_order AS current_stage_order,
            d.name AS current_owner_department_name,
            (SELECT COUNT(*)::int FROM exit_workflow_stages ws WHERE ws.workflow_id = er.workflow_id) AS total_stages
     FROM exit_requests er
     LEFT JOIN employees e ON e.id = er.employee_id
     LEFT JOIN exit_workflow_stages s ON s.id = er.current_stage_id
     LEFT JOIN departments d ON d.id = er.current_owner_department_id
     WHERE ${where}
     ORDER BY er.created_at DESC, er.id DESC
     LIMIT $${i++} OFFSET $${i}`,
    params,
  );

  return {
    records: rows.map((r) => ({ ...r, employee_name: empName(r) })),
    pagination: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

/** Derive per-stage runtime state from current_stage_id + stage_order + exit_approvals. */
async function buildStageStates(pool, request) {
  const { rows: stages } = await pool.query(
    `SELECT s.id, s.name, s.stage_order, s.approval_mode, s.sla_hours,
            s.allow_future_visibility, s.allow_previous_edit,
            d.name AS primary_department,
            ARRAY(SELECT r.name FROM exit_stage_roles sr JOIN rbac_roles r ON r.id = sr.role_id
                  WHERE sr.stage_id = s.id ORDER BY r.name) AS owner_roles,
            ARRAY(SELECT dd.name FROM exit_stage_departments sd JOIN departments dd ON dd.id = sd.department_id
                  WHERE sd.stage_id = s.id ORDER BY dd.name) AS owner_departments,
            ARRAY(SELECT e.full_name FROM exit_stage_users su JOIN employees e ON e.id = su.employee_id
                  WHERE su.stage_id = s.id) AS owner_users
     FROM exit_workflow_stages s
     LEFT JOIN LATERAL (
       SELECT dd.name FROM exit_stage_departments sd
       JOIN departments dd ON dd.id = sd.department_id
       WHERE sd.stage_id = s.id ORDER BY sd.is_primary DESC, sd.id ASC LIMIT 1
     ) d ON true
     WHERE s.workflow_id = $1 ORDER BY s.stage_order ASC, s.id ASC`,
    [request.workflow_id],
  );
  const { rows: acts } = await pool.query(
    `SELECT stage_id, action FROM exit_approvals WHERE exit_request_id = $1`, [request.id],
  );
  const byStage = {};
  for (const a of acts) {
    (byStage[a.stage_id] = byStage[a.stage_id] || []).push(a.action);
  }
  const curOrder = stages.find((s) => s.id === request.current_stage_id)?.stage_order ?? null;

  return stages.map((s) => {
    const actions = byStage[s.id] || [];
    let state;
    if (actions.includes('REJECT')) state = 'REJECTED';
    else if (actions.includes('COMPLETE')) state = 'COMPLETED';
    else if (s.id === request.current_stage_id) state = 'ACTIVE';
    else if (curOrder != null && s.stage_order < curOrder) state = 'COMPLETED';
    else state = 'PENDING';
    return { ...s, state };
  });
}

async function getExitRequest(tenant, id, exitUser) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `SELECT er.*, e.full_name, e.first_name, e.last_name, e.work_email, e.job_title, e.department,
            tt.name AS termination_type_name, w.name AS workflow_name
     FROM exit_requests er
     LEFT JOIN employees e ON e.id = er.employee_id
     LEFT JOIN termination_types tt ON tt.id = er.termination_type_id
     LEFT JOIN exit_workflows w ON w.id = er.workflow_id
     WHERE er.id = $1`, [id],
  );
  const request = rows[0];
  if (!request) throw ApiError.notFound('Exit request not found');

  const [stages, approvals, checklist, attachments] = await Promise.all([
    buildStageStates(pool, request),
    pool.query(
      `SELECT a.*, e.full_name AS actor_full_name, s.name AS stage_name
       FROM exit_approvals a
       LEFT JOIN employees e ON e.id = a.actor_id
       LEFT JOIN exit_workflow_stages s ON s.id = a.stage_id
       WHERE a.exit_request_id = $1 ORDER BY a.created_at ASC`, [id]),
    pool.query(
      `SELECT * FROM exit_request_checklist_items WHERE exit_request_id = $1 ORDER BY stage_id, id`, [id]),
    pool.query(
      `SELECT * FROM exit_request_attachments WHERE exit_request_id = $1 ORDER BY uploaded_at DESC`, [id]),
  ]);

  // Caller's capabilities on the CURRENT stage (from the resolver).
  let myActions = [];
  let visibility = 'hidden';
  if (exitUser) {
    const wfCtx = await resolver.loadWorkflowContext(pool, id);
    const accessCtx = await resolver.resolveExitAccess(pool, exitUser, wfCtx);
    myActions = [...resolver.permittedActionsFor(accessCtx)];
    visibility = accessCtx.visibility;
  }

  return {
    ...request,
    employee_name: empName(request),
    stages,
    approvals: approvals.rows,
    checklist_items: checklist.rows,
    attachments: attachments.rows,
    my_actions: myActions,
    my_visibility: visibility,
  };
}

/* ------------------------------------------------------------------ */
/*  Stage actions                                                     */
/* ------------------------------------------------------------------ */

async function loadRequestRow(client, id) {
  const { rows } = await client.query(
    `SELECT er.*, e.full_name, e.first_name, e.last_name, e.work_email
     FROM exit_requests er LEFT JOIN employees e ON e.id = er.employee_id
     WHERE er.id = $1 FOR UPDATE OF er`, [id],
  );
  return rows[0] || null;
}

async function recordAction(client, request, action, actor, comments) {
  await client.query(
    `INSERT INTO exit_approvals
       (exit_request_id, stage_id, department_id, action, actor_id, actor_name, comments, acted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
    [request.id, request.current_stage_id, request.current_owner_department_id,
     action, actor.employeeId || null, actor.actorName || null, comments || null],
  );
}

async function approveStage(tenant, id, exitUser, comments) {
  const pool = await getTenantPool(tenant.dbName);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const request = await loadRequestRow(client, id);
    if (!request) throw ApiError.notFound('Exit request not found');
    if (request.status !== 'IN_PROGRESS') throw ApiError.badRequest('This exit request is not active');
    const stage = await engine.getStage(client, request.current_stage_id);
    if (!stage) throw ApiError.badRequest('No active stage');

    await recordAction(client, request, 'APPROVE', exitUser, comments);
    const result = await engine.advanceStage(client, request, stage);
    await client.query('COMMIT');

    emit(tenant, `tenant:${tenant.dbName}`, 'exit:workflow_updated', { exitRequestId: Number(id), action: 'approve' });
    emit(tenant, `exit:${id}`, result.completed ? 'exit:request_completed' : 'exit:stage_advanced', { exitRequestId: Number(id) });
    // Completed → notify subject; otherwise notify + assign the newly-active stage's owners.
    events().onApproved(tenant, Number(id), !!result.completed).catch(() => {});
    return getExitRequest(tenant, id, exitUser);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function rejectStage(tenant, id, exitUser, reason) {
  if (!reason || !reason.trim()) throw ApiError.badRequest('A rejection reason is required');
  const pool = await getTenantPool(tenant.dbName);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const request = await loadRequestRow(client, id);
    if (!request) throw ApiError.notFound('Exit request not found');
    if (request.status !== 'IN_PROGRESS') throw ApiError.badRequest('This exit request is not active');

    await recordAction(client, request, 'REJECT', exitUser, reason);
    await engine.closePendingSlot(client, request.id, request.current_stage_id, 'REJECT', exitUser.employeeId);
    await client.query(
      `UPDATE exit_requests
         SET status = 'REJECTED', rejection_reason = $1, current_stage_id = NULL,
             current_owner_department_id = NULL, updated_at = NOW()
       WHERE id = $2`, [reason, id],
    );
    await client.query('COMMIT');

    emit(tenant, `tenant:${tenant.dbName}`, 'exit:workflow_updated', { exitRequestId: Number(id), action: 'reject' });
    events().onRejected(tenant, Number(id), reason).catch(() => {});
    return getExitRequest(tenant, id, exitUser);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function sendBackStage(tenant, id, exitUser, { target_stage_id, comments }) {
  if (!comments || !comments.trim()) throw ApiError.badRequest('A comment is required when sending back');
  const pool = await getTenantPool(tenant.dbName);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const request = await loadRequestRow(client, id);
    if (!request) throw ApiError.notFound('Exit request not found');
    if (request.status !== 'IN_PROGRESS') throw ApiError.badRequest('This exit request is not active');
    const curStage = await engine.getStage(client, request.current_stage_id);

    // target defaults to the immediately-previous stage
    let target;
    if (target_stage_id) {
      target = await engine.getStage(client, target_stage_id);
      if (!target || target.workflow_id !== request.workflow_id) throw ApiError.badRequest('Invalid target stage');
      if (target.stage_order >= curStage.stage_order) throw ApiError.badRequest('Can only send back to an earlier stage');
    } else {
      target = await engine.getStageByOrder(client, request.workflow_id, curStage.stage_order - 1);
      if (!target) throw ApiError.badRequest('No earlier stage to send back to');
    }

    await recordAction(client, request, 'SEND_BACK', exitUser, comments);
    await engine.closePendingSlot(client, request.id, request.current_stage_id, 'SEND_BACK', exitUser.employeeId);
    await engine.moveToStage(client, request, target);
    await client.query('COMMIT');

    emit(tenant, `tenant:${tenant.dbName}`, 'exit:workflow_updated', { exitRequestId: Number(id), action: 'send_back' });
    // The target (earlier) stage is now active again — notify + assign its owners.
    events().onStageEntered(tenant, Number(id)).catch(() => {});
    return getExitRequest(tenant, id, exitUser);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function reassignStage(tenant, id, exitUser, { department_id, comments }) {
  const pool = await getTenantPool(tenant.dbName);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const request = await loadRequestRow(client, id);
    if (!request) throw ApiError.notFound('Exit request not found');
    if (request.status !== 'IN_PROGRESS') throw ApiError.badRequest('This exit request is not active');

    // department must be an assigned department of the CURRENT stage
    const { rows: ok } = await client.query(
      `SELECT 1 FROM exit_stage_departments WHERE stage_id = $1 AND department_id = $2`,
      [request.current_stage_id, department_id],
    );
    if (!ok.length) throw ApiError.badRequest('Target department is not assigned to the current stage');

    await client.query(
      `UPDATE exit_requests SET current_owner_department_id = $1, updated_at = NOW() WHERE id = $2`,
      [department_id, id],
    );
    await recordAction(client, { ...request, current_owner_department_id: department_id }, 'REASSIGN', exitUser, comments);
    await client.query('COMMIT');
    emit(tenant, `tenant:${tenant.dbName}`, 'exit:workflow_updated', { exitRequestId: Number(id), action: 'reassign' });
    events().onReassigned(tenant, Number(id)).catch(() => {});
    return getExitRequest(tenant, id, exitUser);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function escalateStage(tenant, id, exitUser, comments) {
  const pool = await getTenantPool(tenant.dbName);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const request = await loadRequestRow(client, id);
    if (!request) throw ApiError.notFound('Exit request not found');
    if (request.status !== 'IN_PROGRESS') throw ApiError.badRequest('This exit request is not active');
    const stage = await engine.getStage(client, request.current_stage_id);

    if (stage.escalation_action === 'REASSIGN' && (stage.escalation_to_user_id || stage.escalation_to_role_id)) {
      // best-effort: move ownership toward the escalation target's department if a user is set
      if (stage.escalation_to_user_id) {
        const { rows: ed } = await client.query(`SELECT department_id FROM employees WHERE id = $1`, [stage.escalation_to_user_id]);
        if (ed[0]?.department_id) {
          await client.query(`UPDATE exit_requests SET current_owner_department_id = $1, updated_at = NOW() WHERE id = $2`, [ed[0].department_id, id]);
        }
      }
    }
    await recordAction(client, request, 'ESCALATE', exitUser, comments || 'Manual escalation');
    await client.query(
      `UPDATE exit_approvals SET is_sla_breached = true, escalated_at = NOW()
       WHERE exit_request_id = $1 AND stage_id = $2 AND action = 'PENDING'`,
      [id, request.current_stage_id],
    );
    await client.query('COMMIT');
    emit(tenant, `tenant:${tenant.dbName}`, 'exit:workflow_updated', { exitRequestId: Number(id), action: 'escalate' });
    events().onEscalated(tenant, Number(id), stage.escalation_to_user_id || null).catch(() => {});
    return getExitRequest(tenant, id, exitUser);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function addComment(tenant, id, exitUser, comments) {
  if (!comments || !comments.trim()) throw ApiError.badRequest('A comment is required');
  const pool = await getTenantPool(tenant.dbName);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const request = await loadRequestRow(client, id);
    if (!request) throw ApiError.notFound('Exit request not found');
    await recordAction(client, request, 'COMMENT', exitUser, comments);
    await client.query('COMMIT');
    return getExitRequest(tenant, id, exitUser);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function withdrawExitRequest(tenant, id, exitUser, reason) {
  const pool = await getTenantPool(tenant.dbName);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const request = await loadRequestRow(client, id);
    if (!request) throw ApiError.notFound('Exit request not found');
    if (!['SUBMITTED', 'IN_PROGRESS'].includes(request.status)) {
      throw ApiError.badRequest('Only active exit requests can be withdrawn');
    }
    await recordAction(client, request, 'COMMENT', exitUser, `Withdrawal: ${reason || 'requested by employee'}`);
    await client.query(
      `UPDATE exit_requests
         SET status = 'WITHDRAWN', withdrawal_status = 'approved', withdrawal_reason = $1,
             withdrawal_requested_at = NOW(), current_stage_id = NULL,
             current_owner_department_id = NULL, updated_at = NOW()
       WHERE id = $2`, [reason || null, id],
    );
    await client.query(
      `UPDATE employees SET employment_status = 'Active', updated_at = NOW()
       WHERE id = $1 AND employment_status IN ('Notice Period','Resigned')`,
      [request.employee_id],
    );
    await client.query('COMMIT');
    emit(tenant, `tenant:${tenant.dbName}`, 'exit:workflow_updated', { exitRequestId: Number(id), action: 'withdraw' });
    events().onWithdrawn(tenant, Number(id)).catch(() => {});
    return getExitRequest(tenant, id, exitUser);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getAuditLog(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `SELECT a.*, e.full_name AS actor_full_name, s.name AS stage_name
     FROM exit_approvals a
     LEFT JOIN employees e ON e.id = a.actor_id
     LEFT JOIN exit_workflow_stages s ON s.id = a.stage_id
     WHERE a.exit_request_id = $1 ORDER BY a.created_at DESC`, [id],
  );
  return rows;
}

async function getActiveTerminationTypes(tenant) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `SELECT id, name, description FROM termination_types WHERE is_active = true ORDER BY sort_order ASC, name ASC`,
  );
  return rows;
}

module.exports = {
  getDefaultWorkflowFor,
  submitExitRequest,
  listExitRequests,
  getExitRequest,
  approveStage,
  rejectStage,
  sendBackStage,
  reassignStage,
  escalateStage,
  addComment,
  withdrawExitRequest,
  getAuditLog,
  getActiveTerminationTypes,
};
