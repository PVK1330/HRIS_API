'use strict';

const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const { pushNotification, sendSystemNotification } = require('../notifications/notifications.service');
const { getIo } = require('../../socket');

const PIPELINE_STAGES = ['submitted', 'approved', 'clearance', 'interview', 'settlement', 'exited'];

function empName(r) {
  return r?.full_name || [r?.first_name, r?.last_name].filter(Boolean).join(' ') || 'Unknown';
}

async function logStatusChange(pool, exitRecordId, fromStatus, toStatus, fromStage, toStage, notes, actorId) {
  await pool.query(
    `INSERT INTO exit_status_logs (exit_record_id, from_status, to_status, from_stage, to_stage, notes, actor_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [exitRecordId, fromStatus, toStatus, fromStage, toStage, notes, actorId || null],
  );
}

async function logApproval(pool, exitRecordId, workflowStepId, action, actorId, actorName, comments, metadata) {
  await pool.query(
    `INSERT INTO exit_approvals (exit_record_id, workflow_step_id, action, actor_id, actor_name, comments, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [exitRecordId, workflowStepId, action, actorId || null, actorName || null, comments || null, metadata || null],
  );
}

async function getExitRecordRow(pool, exitRecordId) {
  const { rows } = await pool.query(`SELECT * FROM exit_records WHERE id = $1`, [exitRecordId]);
  if (!rows.length) throw ApiError.notFound('Exit record not found');
  return rows[0];
}

async function listDepartmentsWithHeads(tenant) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `SELECT d.id, d.name, d.code, d.manager_id,
            e.full_name AS head_name, e.first_name, e.last_name, e.work_email AS head_email
     FROM departments d
     LEFT JOIN employees e ON e.id = d.manager_id AND e.deleted_at IS NULL
     WHERE d.is_active = true
     ORDER BY d.name ASC`,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    code: r.code,
    manager_id: r.manager_id,
    head_name: empName(r),
    head_email: r.head_email,
  }));
}

async function fetchWorkflowSteps(pool, exitRecordId) {
  const { rows } = await pool.query(
    `SELECT w.*,
            d.name AS department_name,
            e.full_name AS head_full_name, e.first_name AS head_first, e.last_name AS head_last,
            ab.full_name AS approved_by_name
     FROM exit_department_workflows w
     JOIN departments d ON d.id = w.department_id
     LEFT JOIN employees e ON e.id = w.department_head_id
     LEFT JOIN employees ab ON ab.id = w.approved_by
     WHERE w.exit_record_id = $1
     ORDER BY w.step_order ASC, w.id ASC`,
    [exitRecordId],
  );
  return rows.map((r) => ({
    id: r.id,
    exit_record_id: r.exit_record_id,
    department_id: r.department_id,
    department_name: r.department_name,
    department_head_id: r.department_head_id,
    department_head_name: empName({ full_name: r.head_full_name, first_name: r.head_first, last_name: r.head_last }),
    step_order: r.step_order,
    is_mandatory: r.is_mandatory,
    remarks: r.remarks,
    status: r.status,
    approved_by: r.approved_by,
    approved_by_name: r.approved_by_name,
    approved_at: r.approved_at,
    rejection_reason: r.rejection_reason,
  }));
}

async function activateNextStep(pool, exitRecordId) {
  const { rows: active } = await pool.query(
    `SELECT id FROM exit_department_workflows
     WHERE exit_record_id = $1 AND status = 'Active' LIMIT 1`,
    [exitRecordId],
  );
  if (active.length) return active[0].id;

  const { rows: next } = await pool.query(
    `SELECT id FROM exit_department_workflows
     WHERE exit_record_id = $1 AND status = 'Pending'
     ORDER BY step_order ASC, id ASC LIMIT 1`,
    [exitRecordId],
  );
  if (!next.length) return null;

  await pool.query(
    `UPDATE exit_department_workflows SET status = 'Active', updated_at = NOW() WHERE id = $1`,
    [next[0].id],
  );
  return next[0].id;
}

async function notifyDepartmentHead(tenant, step, exitRecord, employeeName) {
  if (!step.department_head_id) return;
  try {
    await pushNotification(tenant, {
      userId: step.department_head_id,
      title: 'Exit approval required',
      message: `${employeeName} exit request needs your approval (${step.department_name}).`,
      type: 'exit_management',
      metadata: { exit_record_id: exitRecord.id, step_id: step.id },
    });
  } catch {
    /* non-blocking */
  }
}

async function emitWorkflowUpdate(exitRecordId, payload) {
  try {
    const io = getIo();
    io?.emit('exit:workflow_updated', { exitRecordId, ...payload });
  } catch {
    /* non-blocking */
  }
}

async function completeDepartmentWorkflow(pool, tenant, exitRecord, actorId) {
  const er = exitRecord;
  await pool.query(
    `UPDATE exit_records
     SET pipeline_stage = 'clearance', status = 'clearance', workflow_configured = true, updated_at = NOW()
     WHERE id = $1`,
    [er.id],
  );
  await logStatusChange(pool, er.id, er.status, 'clearance', er.pipeline_stage, 'clearance', 'All department approvals completed', actorId);

  const exitManagement = require('./exitManagement.service');
  if (typeof exitManagement.seedClearanceTasksForExit === 'function') {
    await exitManagement.seedClearanceTasksForExit(pool, er.id);
  } else {
    const { rows: existing } = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM clearance_tasks WHERE exit_record_id = $1`,
      [er.id],
    );
    if (existing[0].cnt === 0) {
      await pool.query(
        `INSERT INTO clearance_tasks (exit_record_id, department, task_name, sort_order)
         VALUES ($1, 'HR', 'Department clearance complete — proceed with exit clearance', 1)`,
        [er.id],
      );
    }
  }

  emitWorkflowUpdate(er.id, { pipeline_stage: 'clearance', status: 'clearance' });
}

async function getWorkflowForExit(tenant, exitRecordId) {
  const pool = await getTenantPool(tenant.dbName);
  await getExitRecordRow(pool, exitRecordId);
  const steps = await fetchWorkflowSteps(pool, exitRecordId);
  const activeStep = steps.find((s) => s.status === 'Active') || null;
  const { rows: approvals } = await pool.query(
    `SELECT * FROM exit_approvals WHERE exit_record_id = $1 ORDER BY created_at ASC`,
    [exitRecordId],
  );
  const { rows: logs } = await pool.query(
    `SELECT * FROM exit_status_logs WHERE exit_record_id = $1 ORDER BY created_at ASC`,
    [exitRecordId],
  );
  return { steps, active_step: activeStep, approvals, status_logs: logs, pipeline_stages: PIPELINE_STAGES };
}

async function assignDepartments(tenant, exitRecordId, stepsPayload, actorId, actorName) {
  const pool = await getTenantPool(tenant.dbName);
  const exitRecord = await getExitRecordRow(pool, exitRecordId);

  if (!Array.isArray(stepsPayload) || !stepsPayload.length) {
    throw ApiError.badRequest('Select at least one department for the workflow');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM exit_department_workflows WHERE exit_record_id = $1`, [exitRecordId]);

    const sorted = [...stepsPayload].sort((a, b) => (a.step_order || 0) - (b.step_order || 0));
    for (let i = 0; i < sorted.length; i += 1) {
      const s = sorted[i];
      const deptId = Number(s.department_id);
      if (!deptId) throw ApiError.badRequest('Invalid department_id');

      const { rows: deptRows } = await client.query(
        `SELECT d.id, d.manager_id FROM departments d WHERE d.id = $1 AND d.is_active = true`,
        [deptId],
      );
      if (!deptRows.length) throw ApiError.notFound(`Department ${deptId} not found`);

      const headId = s.department_head_id ? Number(s.department_head_id) : deptRows[0].manager_id;

      await client.query(
        `INSERT INTO exit_department_workflows
         (exit_record_id, department_id, department_head_id, step_order, is_mandatory, remarks, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'Pending')`,
        [
          exitRecordId,
          deptId,
          headId || null,
          i + 1,
          s.is_mandatory !== false,
          s.remarks || null,
        ],
      );
    }

    await client.query(
      `UPDATE exit_records
       SET workflow_configured = true, pipeline_stage = 'approved',
           status = CASE WHEN status = 'Pending Approval' THEN 'In Progress' ELSE status END,
           updated_at = NOW()
       WHERE id = $1`,
      [exitRecordId],
    );

    await logStatusChange(
      client, exitRecordId, exitRecord.status, exitRecord.status,
      exitRecord.pipeline_stage, 'approved', 'Department workflow assigned', actorId,
    );
    await logApproval(client, exitRecordId, null, 'WorkflowAssigned', actorId, actorName, 'Department workflow configured', { steps: sorted.length });

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  await activateNextStep(pool, exitRecordId);
  const workflow = await getWorkflowForExit(tenant, exitRecordId);
  const active = workflow.active_step;
  if (active) {
    const { rows: er } = await pool.query(
      `SELECT er.*, e.full_name FROM exit_records er JOIN employees e ON e.id = er.employee_id WHERE er.id = $1`,
      [exitRecordId],
    );
    await notifyDepartmentHead(tenant, active, er[0], empName(er[0]));
  }
  emitWorkflowUpdate(exitRecordId, { action: 'assigned' });
  return workflow;
}

async function reorderWorkflow(tenant, exitRecordId, orderedStepIds, actorId) {
  const pool = await getTenantPool(tenant.dbName);
  await getExitRecordRow(pool, exitRecordId);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < orderedStepIds.length; i += 1) {
      await client.query(
        `UPDATE exit_department_workflows SET step_order = $1 WHERE id = $2 AND exit_record_id = $3`,
        [i + 1, orderedStepIds[i], exitRecordId],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return getWorkflowForExit(tenant, exitRecordId);
}

async function assertCanActOnStep(pool, step, user) {
  const uid = Number(user?.employeeId || user?.id);
  const role = user?.role || '';
  if (['admin', 'hr_admin', 'hr_manager'].includes(role)) return true;
  if (step.department_head_id && Number(step.department_head_id) === uid) return true;
  throw ApiError.forbidden('You are not authorized to act on this department step');
}

async function approveStep(tenant, exitRecordId, stepId, userId, user, comments) {
  const pool = await getTenantPool(tenant.dbName);
  const exitRecord = await getExitRecordRow(pool, exitRecordId);

  const { rows: stepRows } = await pool.query(
    `SELECT w.*, d.name AS department_name
     FROM exit_department_workflows w
     JOIN departments d ON d.id = w.department_id
     WHERE w.id = $1 AND w.exit_record_id = $2`,
    [stepId, exitRecordId],
  );
  if (!stepRows.length) throw ApiError.notFound('Workflow step not found');
  const step = stepRows[0];
  if (step.status !== 'Active') throw ApiError.badRequest('This step is not active');

  await assertCanActOnStep(pool, step, user);

  await pool.query(
    `UPDATE exit_department_workflows
     SET status = 'Approved', approved_by = $1, approved_at = NOW(), updated_at = NOW()
     WHERE id = $2`,
    [userId, stepId],
  );
  await logApproval(pool, exitRecordId, stepId, 'Approved', userId, empName(user), comments, null);

  const { rows: pendingMandatory } = await pool.query(
    `SELECT id FROM exit_department_workflows
     WHERE exit_record_id = $1 AND status IN ('Pending', 'Active') AND is_mandatory = true`,
    [exitRecordId],
  );

  const { rows: anyPending } = await pool.query(
    `SELECT id FROM exit_department_workflows
     WHERE exit_record_id = $1 AND status IN ('Pending', 'Active')`,
    [exitRecordId],
  );

  if (!anyPending.length) {
    await completeDepartmentWorkflow(pool, tenant, exitRecord, userId);
  } else {
    await activateNextStep(pool, exitRecordId);
    const workflow = await getWorkflowForExit(tenant, exitRecordId);
    if (workflow.active_step) {
      const { rows: er } = await pool.query(
        `SELECT er.*, e.full_name FROM exit_records er JOIN employees e ON e.id = er.employee_id WHERE er.id = $1`,
        [exitRecordId],
      );
      await notifyDepartmentHead(tenant, workflow.active_step, er[0], empName(er[0]));
    }
  }

  emitWorkflowUpdate(exitRecordId, { action: 'approved', stepId });
  return getWorkflowForExit(tenant, exitRecordId);
}

async function rejectStep(tenant, exitRecordId, stepId, userId, user, reason) {
  const pool = await getTenantPool(tenant.dbName);
  const exitRecord = await getExitRecordRow(pool, exitRecordId);

  const { rows: stepRows } = await pool.query(
    `SELECT * FROM exit_department_workflows WHERE id = $1 AND exit_record_id = $2`,
    [stepId, exitRecordId],
  );
  if (!stepRows.length) throw ApiError.notFound('Workflow step not found');
  const step = stepRows[0];
  if (step.status !== 'Active') throw ApiError.badRequest('This step is not active');

  await assertCanActOnStep(pool, step, user);

  await pool.query(
    `UPDATE exit_department_workflows
     SET status = 'Rejected', rejection_reason = $1, updated_at = NOW()
     WHERE id = $2`,
    [reason || 'Rejected', stepId],
  );
  await pool.query(
    `UPDATE exit_records SET status = 'Rejected', pipeline_stage = 'submitted', updated_at = NOW() WHERE id = $1`,
    [exitRecordId],
  );
  await logApproval(pool, exitRecordId, stepId, 'Rejected', userId, empName(user), reason, null);
  await logStatusChange(pool, exitRecordId, exitRecord.status, 'Rejected', exitRecord.pipeline_stage, 'submitted', reason, userId);

  emitWorkflowUpdate(exitRecordId, { action: 'rejected', stepId });
  return getWorkflowForExit(tenant, exitRecordId);
}

async function skipStep(tenant, exitRecordId, stepId, userId, user) {
  const pool = await getTenantPool(tenant.dbName);
  const exitRecord = await getExitRecordRow(pool, exitRecordId);

  const { rows: stepRows } = await pool.query(
    `SELECT * FROM exit_department_workflows WHERE id = $1 AND exit_record_id = $2`,
    [stepId, exitRecordId],
  );
  if (!stepRows.length) throw ApiError.notFound('Workflow step not found');
  const step = stepRows[0];
  if (step.is_mandatory) throw ApiError.badRequest('Mandatory steps cannot be skipped');
  if (step.status !== 'Active') throw ApiError.badRequest('This step is not active');

  if (!['admin', 'hr_admin', 'hr_manager'].includes(user?.role || '')) {
    await assertCanActOnStep(pool, step, user);
  }

  await pool.query(
    `UPDATE exit_department_workflows SET status = 'Skipped', updated_at = NOW() WHERE id = $1`,
    [stepId],
  );
  await logApproval(pool, exitRecordId, stepId, 'Skipped', userId, empName(user), null, null);

  const { rows: anyPending } = await pool.query(
    `SELECT id FROM exit_department_workflows
     WHERE exit_record_id = $1 AND status IN ('Pending', 'Active')`,
    [exitRecordId],
  );

  if (!anyPending.length) {
    await completeDepartmentWorkflow(pool, tenant, exitRecord, userId);
  } else {
    await activateNextStep(pool, exitRecordId);
  }

  emitWorkflowUpdate(exitRecordId, { action: 'skipped', stepId });
  return getWorkflowForExit(tenant, exitRecordId);
}

async function reassignHead(tenant, exitRecordId, stepId, newHeadId, actorId, actorName) {
  const pool = await getTenantPool(tenant.dbName);
  await getExitRecordRow(pool, exitRecordId);

  const { rows: emp } = await pool.query(
    `SELECT id FROM employees WHERE id = $1 AND deleted_at IS NULL`,
    [newHeadId],
  );
  if (!emp.length) throw ApiError.notFound('Employee not found');

  await pool.query(
    `UPDATE exit_department_workflows SET department_head_id = $1, updated_at = NOW()
     WHERE id = $2 AND exit_record_id = $3`,
    [newHeadId, stepId, exitRecordId],
  );
  await logApproval(pool, exitRecordId, stepId, 'Reassigned', actorId, actorName, `Head reassigned to employee #${newHeadId}`, null);
  return getWorkflowForExit(tenant, exitRecordId);
}

async function restartWorkflow(tenant, exitRecordId, actorId, actorName) {
  const pool = await getTenantPool(tenant.dbName);
  const exitRecord = await getExitRecordRow(pool, exitRecordId);

  await pool.query(
    `UPDATE exit_department_workflows
     SET status = 'Pending', approved_by = NULL, approved_at = NULL, rejection_reason = NULL, updated_at = NOW()
     WHERE exit_record_id = $1`,
    [exitRecordId],
  );
  await pool.query(
    `UPDATE exit_records SET status = 'In Progress', pipeline_stage = 'approved', updated_at = NOW() WHERE id = $1`,
    [exitRecordId],
  );
  await logApproval(pool, exitRecordId, null, 'Restarted', actorId, actorName, 'Workflow restarted', null);
  await logStatusChange(pool, exitRecordId, exitRecord.status, 'In Progress', exitRecord.pipeline_stage, 'approved', 'Workflow restarted', actorId);

  await activateNextStep(pool, exitRecordId);
  emitWorkflowUpdate(exitRecordId, { action: 'restarted' });
  return getWorkflowForExit(tenant, exitRecordId);
}

async function getWorkflowSummaryForList(pool, exitRecordIds) {
  if (!exitRecordIds.length) return {};
  const { rows } = await pool.query(
    `SELECT w.exit_record_id,
            w.status, w.step_order, d.name AS department_name,
            e.full_name AS head_name
     FROM exit_department_workflows w
     JOIN departments d ON d.id = w.department_id
     LEFT JOIN employees e ON e.id = w.department_head_id
     WHERE w.exit_record_id = ANY($1::int[])
     ORDER BY w.exit_record_id, w.step_order`,
    [exitRecordIds],
  );

  const map = {};
  for (const r of rows) {
    if (!map[r.exit_record_id]) {
      map[r.exit_record_id] = { steps: [], active_stage: null, heads: [] };
    }
    map[r.exit_record_id].steps.push(r);
    if (r.status === 'Active') {
      map[r.exit_record_id].active_stage = r.department_name;
    }
    if (r.head_name) map[r.exit_record_id].heads.push(r.head_name);
  }
  return map;
}

module.exports = {
  PIPELINE_STAGES,
  listDepartmentsWithHeads,
  getWorkflowForExit,
  assignDepartments,
  reorderWorkflow,
  approveStep,
  rejectStep,
  skipStep,
  reassignHead,
  restartWorkflow,
  getWorkflowSummaryForList,
  fetchWorkflowSteps,
};
