'use strict';

/**
 * Exit Workflow Configuration (Settings > Exit Management > Department Workflow).
 * A workflow has up to 6 ordered stages; each stage carries assigned departments / roles /
 * users, approval_mode (ANY|ALL|QUORUM|SEQUENTIAL) + quorum_count, sla_hours, flat escalation
 * columns, visibility flags, block_until_checklist_complete, and optional checklist templates.
 *
 * Guarded org-wide by authorizeExitAccess({action:'config'}) — no stage context.
 */

const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');

const APPROVAL_MODES = ['ANY', 'ALL', 'QUORUM', 'SEQUENTIAL'];
const ESCALATION_ACTIONS = ['NOTIFY', 'REASSIGN'];

function validateStage(s, idx) {
  const where = `Stage ${idx + 1}`;
  if (!s.name || !String(s.name).trim()) throw ApiError.badRequest(`${where}: name is required`);
  const mode = s.approval_mode || 'ANY';
  if (!APPROVAL_MODES.includes(mode)) throw ApiError.badRequest(`${where}: invalid approval_mode`);
  if (mode === 'QUORUM' && !(Number(s.quorum_count) >= 1)) {
    throw ApiError.badRequest(`${where}: quorum_count >= 1 required for QUORUM mode`);
  }
  const escAction = s.escalation_action || 'NOTIFY';
  if (!ESCALATION_ACTIONS.includes(escAction)) throw ApiError.badRequest(`${where}: invalid escalation_action`);
  const depts = s.department_ids || [];
  const roles = s.role_ids || [];
  const users = s.user_ids || [];
  if (depts.length + roles.length + users.length === 0) {
    throw ApiError.badRequest(`${where}: assign at least one department, role, or user`);
  }
  if (s.escalation_enabled && !s.escalation_to_role_id && !s.escalation_to_user_id) {
    throw ApiError.badRequest(`${where}: escalation target (role or user) required when escalation is enabled`);
  }
}

async function insertStage(client, workflowId, s, order) {
  const { rows } = await client.query(
    `INSERT INTO exit_workflow_stages
       (workflow_id, name, stage_order, approval_mode, quorum_count,
        block_until_checklist_complete, sla_hours,
        escalation_enabled, escalation_after_hours, escalation_to_role_id,
        escalation_to_user_id, escalation_action,
        allow_future_visibility, allow_previous_edit, mandatory_comment)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING id`,
    [
      workflowId, String(s.name).trim(), order, s.approval_mode || 'ANY',
      s.approval_mode === 'QUORUM' ? Number(s.quorum_count) : null,
      Boolean(s.block_until_checklist_complete), s.sla_hours ?? null,
      Boolean(s.escalation_enabled), s.escalation_after_hours ?? null, s.escalation_to_role_id ?? null,
      s.escalation_to_user_id ?? null, s.escalation_action || 'NOTIFY',
      Boolean(s.allow_future_visibility), Boolean(s.allow_previous_edit), Boolean(s.mandatory_comment),
    ],
  );
  const stageId = rows[0].id;

  const depts = [...new Set((s.department_ids || []).map(Number).filter(Boolean))];
  for (let i = 0; i < depts.length; i += 1) {
    await client.query(
      `INSERT INTO exit_stage_departments (stage_id, department_id, is_primary, approver_order)
       VALUES ($1,$2,$3,$4) ON CONFLICT (stage_id, department_id) DO NOTHING`,
      [stageId, depts[i], i === 0, i + 1],
    );
  }
  for (const roleId of [...new Set((s.role_ids || []).map(Number).filter(Boolean))]) {
    await client.query(
      `INSERT INTO exit_stage_roles (stage_id, role_id) VALUES ($1,$2)
       ON CONFLICT (stage_id, role_id) DO NOTHING`,
      [stageId, roleId],
    );
  }
  for (const userId of [...new Set((s.user_ids || []).map(Number).filter(Boolean))]) {
    await client.query(
      `INSERT INTO exit_stage_users (stage_id, employee_id) VALUES ($1,$2)
       ON CONFLICT (stage_id, employee_id) DO NOTHING`,
      [stageId, userId],
    );
  }
  for (const [i, item] of (s.checklist_items || []).entries()) {
    await client.query(
      `INSERT INTO exit_stage_checklist_items
         (stage_id, item_type, label, description, is_mandatory, requires_proof, assigned_role_id, config, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        stageId, item.item_type || 'TASK', String(item.label).trim(), item.description || null,
        item.is_mandatory !== false, Boolean(item.requires_proof), item.assigned_role_id || null,
        item.config ? JSON.stringify(item.config) : '{}', item.sort_order ?? i,
      ],
    );
  }
  return stageId;
}

/* ------------------------------------------------------------------ */

async function createWorkflow(tenant, dto, actor) {
  const pool = await getTenantPool(tenant.dbName);
  const stages = Array.isArray(dto.stages) ? dto.stages : [];
  if (!stages.length) throw ApiError.badRequest('A workflow needs at least one stage');
  if (stages.length > 6) throw ApiError.badRequest('A workflow may have at most 6 stages');
  stages.forEach(validateStage);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO exit_workflows (name, description, exit_type, is_active, is_default, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [String(dto.name).trim(), dto.description || null, dto.exit_type || null,
       dto.is_active !== false, Boolean(dto.is_default), actor?.employeeId || null],
    );
    const workflowId = rows[0].id;

    if (dto.is_default) {
      await client.query(
        `UPDATE exit_workflows SET is_default = false
         WHERE id <> $1 AND COALESCE(exit_type,'*') = COALESCE($2::varchar,'*')`,
        [workflowId, dto.exit_type || null],
      );
    }

    const sorted = [...stages].sort((a, b) => (a.stage_order || 0) - (b.stage_order || 0));
    for (let i = 0; i < sorted.length; i += 1) {
      await insertStage(client, workflowId, sorted[i], i + 1);
    }
    await client.query('COMMIT');
    return getWorkflow(tenant, workflowId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function listWorkflows(tenant, { activeOnly } = {}) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `SELECT w.*,
            (SELECT COUNT(*)::int FROM exit_workflow_stages s WHERE s.workflow_id = w.id) AS stage_count
     FROM exit_workflows w
     ${activeOnly ? 'WHERE w.is_active = true' : ''}
     ORDER BY w.is_default DESC, w.created_at DESC`,
  );
  return rows;
}

async function getWorkflow(tenant, workflowId) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows: wfRows } = await pool.query(`SELECT * FROM exit_workflows WHERE id = $1`, [workflowId]);
  if (!wfRows.length) throw ApiError.notFound('Workflow not found');
  const workflow = wfRows[0];

  // How many exit requests have used this workflow. >0 means its stages are locked from edits
  // (stage rows back live approval history) — the UI shows them read-only and offers cloning.
  const { rows: usage } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM exit_requests WHERE workflow_id = $1`, [workflowId],
  );
  workflow.request_count = usage[0].total;

  const { rows: stages } = await pool.query(
    `SELECT * FROM exit_workflow_stages WHERE workflow_id = $1 ORDER BY stage_order ASC, id ASC`,
    [workflowId],
  );

  for (const s of stages) {
    const [depts, roles, users, items] = await Promise.all([
      pool.query(
        `SELECT d.id, d.name, sd.is_primary, sd.approver_order
         FROM exit_stage_departments sd JOIN departments d ON d.id = sd.department_id
         WHERE sd.stage_id = $1 ORDER BY sd.approver_order NULLS LAST, d.name`, [s.id]),
      pool.query(
        `SELECT r.id, r.name, sr.approver_order
         FROM exit_stage_roles sr JOIN rbac_roles r ON r.id = sr.role_id
         WHERE sr.stage_id = $1 ORDER BY r.name`, [s.id]),
      pool.query(
        `SELECT e.id, e.full_name, su.approver_order
         FROM exit_stage_users su JOIN employees e ON e.id = su.employee_id
         WHERE su.stage_id = $1`, [s.id]),
      pool.query(
        `SELECT id, item_type, label, description, is_mandatory, requires_proof, assigned_role_id, config, sort_order
         FROM exit_stage_checklist_items WHERE stage_id = $1 AND is_active = true ORDER BY sort_order, id`, [s.id]),
    ]);
    s.departments = depts.rows;
    s.roles = roles.rows;
    s.users = users.rows;
    s.checklist_items = items.rows;
  }
  return { ...workflow, stages };
}

async function updateWorkflow(tenant, workflowId, dto) {
  const pool = await getTenantPool(tenant.dbName);

  // Did the caller send a stage structure to rewrite? (vs. a top-level-only patch)
  const editingStages = Array.isArray(dto.stages);

  // Stage rows are referenced by exit_approvals / exit_request_checklist_items (ON DELETE
  // CASCADE) and exit_requests.current_stage_id (ON DELETE SET NULL). Rewriting stages on a
  // workflow that already has requests would destroy approval history and orphan in-flight
  // requests — so structural edits are only allowed while the workflow is unused. Clone instead.
  if (editingStages) {
    const stages = dto.stages;
    if (!stages.length) throw ApiError.badRequest('A workflow needs at least one stage');
    if (stages.length > 6) throw ApiError.badRequest('A workflow may have at most 6 stages');
    stages.forEach(validateStage);

    const { rows: used } = await pool.query(
      `SELECT 1 FROM exit_requests WHERE workflow_id = $1 LIMIT 1`, [workflowId],
    );
    if (used.length) {
      throw ApiError.badRequest(
        'This workflow already has exit requests; its stages cannot be changed. '
        + 'Edit its name/default flag, or create a new workflow for the revised stages.',
      );
    }
  }

  const fields = [];
  const params = [];
  let n = 1;
  for (const f of ['name', 'description', 'exit_type', 'is_active', 'is_default']) {
    if (dto[f] !== undefined) { params.push(dto[f]); fields.push(`${f} = $${n++}`); }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (fields.length) {
      fields.push('updated_at = NOW()');
      params.push(workflowId);
      const { rowCount } = await client.query(
        `UPDATE exit_workflows SET ${fields.join(', ')} WHERE id = $${n}`, params,
      );
      if (!rowCount) throw ApiError.notFound('Workflow not found');
    } else {
      const { rowCount } = await client.query(`SELECT 1 FROM exit_workflows WHERE id = $1`, [workflowId]);
      if (!rowCount) throw ApiError.notFound('Workflow not found');
    }

    if (dto.is_default) {
      await client.query(`UPDATE exit_workflows SET is_default = false WHERE id <> $1`, [workflowId]);
      await client.query(`UPDATE exit_workflows SET is_default = true WHERE id = $1`, [workflowId]);
    }

    if (editingStages) {
      // Safe to replace wholesale — guarded above to an unused workflow. Children (departments,
      // roles, users, checklist templates) cascade-delete with the stage rows.
      await client.query(`DELETE FROM exit_workflow_stages WHERE workflow_id = $1`, [workflowId]);
      const sorted = [...dto.stages].sort((a, b) => (a.stage_order || 0) - (b.stage_order || 0));
      for (let i = 0; i < sorted.length; i += 1) {
        await insertStage(client, workflowId, sorted[i], i + 1);
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return getWorkflow(tenant, workflowId);
}

async function setDefaultWorkflow(tenant, workflowId) {
  return updateWorkflow(tenant, workflowId, { is_default: true, is_active: true });
}

async function deleteWorkflow(tenant, workflowId) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows: inUse } = await pool.query(
    `SELECT 1 FROM exit_requests
     WHERE workflow_id = $1 AND status IN ('SUBMITTED','IN_PROGRESS') LIMIT 1`,
    [workflowId],
  );
  if (inUse.length) throw ApiError.badRequest('Cannot delete a workflow with in-flight exit requests; deactivate it instead');
  const { rowCount } = await pool.query(
    `UPDATE exit_workflows SET is_active = false, is_default = false, updated_at = NOW() WHERE id = $1`,
    [workflowId],
  );
  if (!rowCount) throw ApiError.notFound('Workflow not found');
  return { id: Number(workflowId), is_active: false };
}

/** Lookup data the workflow builder needs (departments / roles / employees + the clearance-item
 *  catalog), gated by the same config permission so the builder does not depend on
 *  departments.manage / rbac perms. */
async function getBuilderOptions(tenant) {
  const pool = await getTenantPool(tenant.dbName);
  const [depts, roles, emps] = await Promise.all([
    pool.query(`SELECT id, name, code FROM departments WHERE is_active = true ORDER BY name`),
    pool.query(`SELECT id, name FROM rbac_roles ORDER BY name`),
    pool.query(
      `SELECT id, full_name, work_email, job_title
       FROM employees WHERE deleted_at IS NULL AND portal_enabled = true
       ORDER BY full_name LIMIT 500`,
    ),
  ]);
  // Tolerate tenants that have not yet run migration 082 — the builder must keep working.
  let clearanceItems = [];
  try {
    const { rows } = await pool.query(
      `SELECT id, name, description, item_type, default_mandatory
       FROM exit_clearance_items WHERE is_active = true ORDER BY sort_order, name`,
    );
    clearanceItems = rows;
  } catch (_) { clearanceItems = []; }
  return {
    departments: depts.rows, roles: roles.rows, employees: emps.rows,
    clearance_items: clearanceItems,
  };
}

/* ------------------------------------------------------------------ */
/*  Clearance-item catalog (reusable checklist templates)             */
/* ------------------------------------------------------------------ */

async function listClearanceItems(tenant, { activeOnly } = {}) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `SELECT id, name, description, item_type, default_mandatory, is_active, sort_order
     FROM exit_clearance_items
     ${activeOnly ? 'WHERE is_active = true' : ''}
     ORDER BY sort_order, name`,
  );
  return rows;
}

async function createClearanceItem(tenant, dto, actor) {
  const pool = await getTenantPool(tenant.dbName);
  if (!dto.name || !String(dto.name).trim()) throw ApiError.badRequest('Name is required');
  const { rows } = await pool.query(
    `INSERT INTO exit_clearance_items (name, description, item_type, default_mandatory, is_active, sort_order, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [String(dto.name).trim(), dto.description || null, dto.item_type || 'TASK',
     dto.default_mandatory !== false, dto.is_active !== false, dto.sort_order ?? 0,
     actor?.employeeId || null],
  );
  return rows[0];
}

async function updateClearanceItem(tenant, itemId, dto) {
  const pool = await getTenantPool(tenant.dbName);
  const fields = [];
  const params = [];
  let n = 1;
  for (const f of ['name', 'description', 'item_type', 'default_mandatory', 'is_active', 'sort_order']) {
    if (dto[f] !== undefined) { params.push(dto[f]); fields.push(`${f} = $${n++}`); }
  }
  if (!fields.length) {
    const { rows } = await pool.query(`SELECT * FROM exit_clearance_items WHERE id = $1`, [itemId]);
    if (!rows.length) throw ApiError.notFound('Clearance item not found');
    return rows[0];
  }
  fields.push('updated_at = NOW()');
  params.push(itemId);
  const { rows } = await pool.query(
    `UPDATE exit_clearance_items SET ${fields.join(', ')} WHERE id = $${n} RETURNING *`, params,
  );
  if (!rows.length) throw ApiError.notFound('Clearance item not found');
  return rows[0];
}

async function deleteClearanceItem(tenant, itemId) {
  const pool = await getTenantPool(tenant.dbName);
  // Hard delete is safe: stages copy the label/type at build time, there is no FK back here.
  const { rowCount } = await pool.query(`DELETE FROM exit_clearance_items WHERE id = $1`, [itemId]);
  if (!rowCount) throw ApiError.notFound('Clearance item not found');
  return { id: Number(itemId), deleted: true };
}

module.exports = {
  createWorkflow,
  listWorkflows,
  getWorkflow,
  updateWorkflow,
  setDefaultWorkflow,
  deleteWorkflow,
  getBuilderOptions,
  listClearanceItems,
  createClearanceItem,
  updateClearanceItem,
  deleteClearanceItem,
};
