'use strict';

const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');

const SORT_COL = {
  created_at: 'tt.created_at',
  updated_at: 'tt.updated_at',
  name: 'tt.name',
  sort_order: 'tt.sort_order',
};

function normalizeListStatus(raw) {
  let s = (raw || 'all').toString().toLowerCase();
  if (!['all', 'active', 'inactive'].includes(s)) s = 'all';
  return s;
}

function buildWhereClause(query) {
  const conditions = ['1=1'];
  const params = [];
  let i = 1;

  const search = (query.search || '').trim();
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(tt.name ILIKE $${i} OR COALESCE(tt.description, '') ILIKE $${i})`);
    i += 1;
  }

  const status = normalizeListStatus(query.status);
  if (status === 'active') conditions.push('tt.is_active = true');
  else if (status === 'inactive') conditions.push('tt.is_active = false');

  return { where: conditions.join(' AND '), params, nextIndex: i };
}

async function listTerminationTypes(tenant, query = {}) {
  const pool = await getTenantPool(tenant.dbName);
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 10));
  const offset = (page - 1) * limit;
  const sortBy = SORT_COL[query.sortBy] ? query.sortBy : 'sort_order';
  const sortOrder = String(query.sortOrder || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  const { where, params } = buildWhereClause(query);

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM termination_types tt WHERE ${where}`,
    [...params],
  );
  const total = countRows[0]?.total ?? 0;

  const dataParams = [...params, limit, offset];
  const lim = dataParams.length - 1;
  const off = dataParams.length;
  const { rows } = await pool.query(
    `SELECT tt.id, tt.name, tt.description, tt.is_active, tt.sort_order,
            tt.created_at, tt.updated_at
     FROM termination_types tt
     WHERE ${where}
     ORDER BY ${SORT_COL[sortBy]} ${sortOrder}, tt.id ASC
     LIMIT $${lim} OFFSET $${off}`,
    dataParams,
  );

  return {
    records: rows.map((r) => ({ ...r, status: r.is_active ? 'Active' : 'Inactive' })),
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
    filters: {
      applied: {
        page,
        limit,
        search: (query.search || '').trim(),
        status: normalizeListStatus(query.status),
        sortBy,
        sortOrder: sortOrder.toLowerCase(),
      },
      options: {
        statuses: [
          { value: 'active', label: 'Active' },
          { value: 'inactive', label: 'Inactive' },
          { value: 'all', label: 'All' },
        ],
      },
    },
  };
}

async function getTerminationType(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `SELECT id, name, description, is_active, sort_order, created_at, updated_at
     FROM termination_types WHERE id = $1`,
    [id],
  );
  const r = rows[0];
  if (!r) throw ApiError.notFound('Termination type not found');
  return { ...r, status: r.is_active ? 'Active' : 'Inactive' };
}

async function createTerminationType(tenant, data) {
  const pool = await getTenantPool(tenant.dbName);
  const isActive = data.is_active !== undefined ? data.is_active : data.isActive !== undefined ? data.isActive : true;
  const { rows } = await pool.query(
    `INSERT INTO termination_types (name, description, is_active, sort_order)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [
      data.name.trim(),
      data.description || null,
      isActive,
      data.sort_order || 0,
    ],
  );
  return getTerminationType(tenant, rows[0].id);
}

async function updateTerminationType(tenant, id, data) {
  const pool = await getTenantPool(tenant.dbName);
  const fields = [];
  const params = [];
  let n = 1;

  if (data.name !== undefined) {
    params.push(data.name.trim());
    fields.push(`name = $${n++}`);
  }
  if (data.description !== undefined) {
    params.push(data.description);
    fields.push(`description = $${n++}`);
  }
  const activeVal = data.is_active !== undefined ? data.is_active : data.isActive;
  if (activeVal !== undefined) {
    params.push(activeVal);
    fields.push(`is_active = $${n++}`);
  }
  if (data.sort_order !== undefined) {
    params.push(data.sort_order);
    fields.push(`sort_order = $${n++}`);
  }

  if (!fields.length) return getTerminationType(tenant, id);

  fields.push('updated_at = NOW()');
  params.push(id);
  const { rows } = await pool.query(
    `UPDATE termination_types SET ${fields.join(', ')} WHERE id = $${n} RETURNING id`,
    params,
  );
  if (!rows.length) throw ApiError.notFound('Termination type not found');
  return getTerminationType(tenant, id);
}

async function deleteTerminationType(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const { rowCount } = await pool.query(
    `UPDATE termination_types SET is_active = false, updated_at = NOW() WHERE id = $1`,
    [id],
  );
  if (!rowCount) throw ApiError.notFound('Termination type not found');
  return true;
}

/* ------------------------------------------------------------------ */
/*  Clearance Task Templates                                           */
/* ------------------------------------------------------------------ */

async function listClearanceTemplates(tenant, query = {}) {
  const pool = await getTenantPool(tenant.dbName);
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 50));
  const offset = (page - 1) * limit;

  // LEGACY: clearance_task_templates was removed by the workflow-engine redesign (migration 079).
  // Clearance items are now stage-attached checklist templates configured in the Exit Workflow
  // builder. Return empty gracefully so older settings screens do not 500.
  try {
    await pool.query('SELECT 1 FROM clearance_task_templates LIMIT 1');
  } catch (_) {
    return { records: [], pagination: { total: 0, page, limit, totalPages: 1 } };
  }

  const conditions = ['1=1'];
  const params = [];
  let i = 1;

  const search = (query.search || '').trim();
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(ct.task_name ILIKE $${i} OR ct.department ILIKE $${i})`);
    i += 1;
  }

  const status = normalizeListStatus(query.status);
  if (status === 'active') conditions.push('ct.is_active = true');
  else if (status === 'inactive') conditions.push('ct.is_active = false');

  const where = conditions.join(' AND ');

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM clearance_task_templates ct WHERE ${where}`,
    [...params],
  );
  const total = countRows[0]?.total ?? 0;

  const dataParams = [...params, limit, offset];
  const lim = dataParams.length - 1;
  const off = dataParams.length;
  const { rows } = await pool.query(
    `SELECT ct.id, ct.department, ct.task_name, ct.sort_order, ct.is_active, ct.sla_hours,
            ct.created_at, ct.updated_at
     FROM clearance_task_templates ct
     WHERE ${where}
     ORDER BY ct.sort_order ASC, ct.id ASC
     LIMIT $${lim} OFFSET $${off}`,
    dataParams,
  );

  return {
    records: rows.map((r) => ({ ...r, status: r.is_active ? 'Active' : 'Inactive' })),
    pagination: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

async function getClearanceTemplate(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `SELECT * FROM clearance_task_templates WHERE id = $1`, [id],
  );
  if (!rows[0]) throw ApiError.notFound('Clearance task template not found');
  return { ...rows[0], status: rows[0].is_active ? 'Active' : 'Inactive' };
}

async function createClearanceTemplate(tenant, data) {
  const pool = await getTenantPool(tenant.dbName);
  try { await pool.query('SELECT 1 FROM clearance_task_templates LIMIT 1'); }
  catch (_) {
    throw ApiError.badRequest(
      'Clearance items are now configured as stage checklist templates inside the Exit Workflow builder '
      + '(POST /api/v1/admin/settings/exit-workflows).',
    );
  }
  const isActive = data.is_active !== undefined ? data.is_active : data.isActive !== undefined ? data.isActive : true;
  const { rows } = await pool.query(
    `INSERT INTO clearance_task_templates (department, task_name, sort_order, is_active, sla_hours)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [data.department.trim(), data.task_name.trim(), data.sort_order || 0, isActive, data.sla_hours || 0],
  );
  return getClearanceTemplate(tenant, rows[0].id);
}

async function updateClearanceTemplate(tenant, id, data) {
  const pool = await getTenantPool(tenant.dbName);
  const fields = [];
  const params = [];
  let n = 1;

  if (data.department !== undefined) { params.push(data.department.trim()); fields.push(`department = $${n++}`); }
  if (data.task_name !== undefined) { params.push(data.task_name.trim()); fields.push(`task_name = $${n++}`); }
  if (data.sort_order !== undefined) { params.push(data.sort_order); fields.push(`sort_order = $${n++}`); }
  const activeVal = data.is_active !== undefined ? data.is_active : data.isActive;
  if (activeVal !== undefined) { params.push(activeVal); fields.push(`is_active = $${n++}`); }
  if (data.sla_hours !== undefined) { params.push(data.sla_hours); fields.push(`sla_hours = $${n++}`); }

  if (!fields.length) return getClearanceTemplate(tenant, id);

  fields.push('updated_at = NOW()');
  params.push(id);
  const { rows } = await pool.query(
    `UPDATE clearance_task_templates SET ${fields.join(', ')} WHERE id = $${n} RETURNING id`,
    params,
  );
  if (!rows.length) throw ApiError.notFound('Clearance task template not found');
  return getClearanceTemplate(tenant, id);
}

async function deleteClearanceTemplate(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const { rowCount } = await pool.query(
    `DELETE FROM clearance_task_templates WHERE id = $1`, [id],
  );
  if (!rowCount) throw ApiError.notFound('Clearance task template not found');
  return true;
}

async function getActiveClearanceTemplates(tenant) {
  const pool = await getTenantPool(tenant.dbName);
  try {
    const { rows } = await pool.query(
      `SELECT department, task_name, sort_order, sla_hours
       FROM clearance_task_templates
       WHERE is_active = true
       ORDER BY sort_order ASC, id ASC`,
    );
    return rows;
  } catch (_) {
    return []; // legacy table removed by the workflow-engine redesign
  }
}

function deptHeadName(r) {
  return r.head_full_name || [r.head_first, r.head_last].filter(Boolean).join(' ') || null;
}

async function getOrgDepartmentWorkflowTemplate(tenant) {
  const pool = await getTenantPool(tenant.dbName);
  // LEGACY: exit_organization_workflow_templates was removed by the workflow-engine redesign.
  // The department approval sequence now lives in exit_workflows / exit_workflow_stages and is
  // managed via /api/v1/admin/settings/exit-workflows. Return empty gracefully to avoid 500s.
  let rows = [];
  try {
    ({ rows } = await pool.query(
      `SELECT t.id, t.department_id, t.step_order, t.is_mandatory, t.remarks, t.is_active,
              d.name AS department_name, d.manager_id AS department_head_id,
              e.full_name AS head_full_name, e.first_name AS head_first, e.last_name AS head_last
       FROM exit_organization_workflow_templates t
       JOIN departments d ON d.id = t.department_id
       LEFT JOIN employees e ON e.id = d.manager_id AND e.deleted_at IS NULL
       WHERE t.is_active = true
       ORDER BY t.step_order ASC, t.id ASC`,
    ));
  } catch (_) {
    return { steps: [] };
  }
  return {
    steps: rows.map((r) => ({
      id: r.id,
      department_id: r.department_id,
      department_name: r.department_name,
      department_head_id: r.department_head_id,
      department_head_name: deptHeadName(r),
      step_order: r.step_order,
      is_mandatory: r.is_mandatory,
      remarks: r.remarks,
    })),
  };
}

const WORKFLOW_MOVED_MSG =
  'Exit workflow configuration has moved to the new Exit Workflow builder '
  + '(POST /api/v1/admin/settings/exit-workflows). Configure stages, departments, roles, '
  + 'approval mode, SLA and escalation there.';

async function saveOrgDepartmentWorkflowTemplate(tenant, steps = []) {
  const pool = await getTenantPool(tenant.dbName);
  try { await pool.query('SELECT 1 FROM exit_organization_workflow_templates LIMIT 1'); }
  catch (_) { throw ApiError.badRequest(WORKFLOW_MOVED_MSG); }
  if (!Array.isArray(steps) || !steps.length) {
    throw ApiError.badRequest('Add at least one department to the default workflow');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM exit_organization_workflow_templates`);

    const sorted = [...steps].sort((a, b) => (a.step_order || 0) - (b.step_order || 0));
    const seenDepts = new Set();
    let insertOrder = 1;

    for (let i = 0; i < sorted.length; i += 1) {
      const s = sorted[i];
      const deptId = Number(s.department_id);
      if (!deptId) throw ApiError.badRequest('Invalid department_id');

      if (seenDepts.has(deptId)) continue;
      seenDepts.add(deptId);

      const { rows: dept } = await client.query(
        `SELECT id FROM departments WHERE id = $1 AND is_active = true`,
        [deptId],
      );
      if (!dept.length) throw ApiError.notFound(`Department ${deptId} not found`);

      await client.query(
        `INSERT INTO exit_organization_workflow_templates
         (department_id, step_order, is_mandatory, remarks, is_active)
         VALUES ($1, $2, $3, $4, true)`,
        [deptId, insertOrder, s.is_mandatory !== false, s.remarks || null],
      );
      insertOrder += 1;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return getOrgDepartmentWorkflowTemplate(tenant);
}

const DEFAULT_PIPELINE_STAGES = [
  { stage_key: 'submitted', label: 'Submitted', step_order: 1 },
  { stage_key: 'approved', label: 'Approved', step_order: 2 },
  { stage_key: 'clearance', label: 'Clearance', step_order: 3 },
  { stage_key: 'interview', label: 'Interview', step_order: 4 },
  { stage_key: 'settlement', label: 'Settlement', step_order: 5 },
  { stage_key: 'exited', label: 'Exited', step_order: 6 },
];

async function loadStageDepartments(pool) {
  try {
    const { rows } = await pool.query(
      `SELECT psd.stage_key, psd.department_id, psd.sort_order,
              d.name AS department_name, d.manager_id AS department_head_id,
              e.full_name AS head_full_name, e.first_name AS head_first, e.last_name AS head_last
       FROM exit_pipeline_stage_departments psd
       JOIN departments d ON d.id = psd.department_id
       LEFT JOIN employees e ON e.id = d.manager_id AND e.deleted_at IS NULL
       ORDER BY psd.stage_key ASC, psd.sort_order ASC, psd.id ASC`,
    );
    const byStage = {};
    for (const r of rows) {
      if (!byStage[r.stage_key]) byStage[r.stage_key] = [];
      byStage[r.stage_key].push({
        department_id: r.department_id,
        department_name: r.department_name,
        department_head_id: r.department_head_id,
        department_head_name: deptHeadName(r),
        sort_order: r.sort_order,
      });
    }
    return byStage;
  } catch {
    return {};
  }
}

function stageDepartmentIds(s) {
  if (Array.isArray(s.department_ids) && s.department_ids.length) {
    return [...new Set(s.department_ids.map((id) => Number(id)).filter((id) => id > 0))];
  }
  if (s.department_id) return [Number(s.department_id)];
  return [];
}

async function getExitPipelineStages(tenant) {
  const pool = await getTenantPool(tenant.dbName);
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.stage_key, p.label, p.step_order, p.is_active, p.department_id,
              d.name AS department_name, d.manager_id AS department_head_id,
              e.full_name AS head_full_name, e.first_name AS head_first, e.last_name AS head_last
       FROM exit_pipeline_stages p
       LEFT JOIN departments d ON d.id = p.department_id
       LEFT JOIN employees e ON e.id = d.manager_id AND e.deleted_at IS NULL
       WHERE p.is_active = true
       ORDER BY p.step_order ASC, p.id ASC`,
    );
    if (rows.length) {
      const deptsByStage = await loadStageDepartments(pool);
      return {
        stages: rows.map((r) => {
          const departments =
            deptsByStage[r.stage_key]?.length > 0
              ? deptsByStage[r.stage_key]
              : r.department_id
                ? [
                    {
                      department_id: r.department_id,
                      department_name: r.department_name,
                      department_head_id: r.department_head_id,
                      department_head_name: deptHeadName(r),
                      sort_order: 1,
                    },
                  ]
                : [];
          const first = departments[0];
          return {
            id: r.id,
            stage_key: r.stage_key,
            label: r.label,
            step_order: r.step_order,
            is_active: r.is_active,
            department_id: first?.department_id ?? r.department_id ?? null,
            department_name: first?.department_name ?? r.department_name,
            department_head_id: first?.department_head_id ?? r.department_head_id,
            department_head_name: first?.department_head_name ?? deptHeadName(r),
            departments,
            department_ids: departments.map((d) => d.department_id),
          };
        }),
      };
    }
  } catch {
    /* table may not exist yet */
  }
  return {
    stages: DEFAULT_PIPELINE_STAGES.map((s) => ({
      ...s,
      is_active: true,
      department_id: null,
      departments: [],
      department_ids: [],
    })),
  };
}

async function saveExitPipelineStages(tenant, stages = []) {
  const pool = await getTenantPool(tenant.dbName);
  try { await pool.query('SELECT 1 FROM exit_pipeline_stages LIMIT 1'); }
  catch (_) { throw ApiError.badRequest(WORKFLOW_MOVED_MSG); }
  if (!Array.isArray(stages) || !stages.length) {
    throw ApiError.badRequest('At least one pipeline stage is required');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const s of stages) {
      const key = String(s.stage_key || '').trim();
      const label = String(s.label || '').trim();
      if (!key || !label) throw ApiError.badRequest('Each stage needs stage_key and label');

      const deptIds = stageDepartmentIds(s);
      for (const deptId of deptIds) {
        const { rows: dept } = await client.query(
          `SELECT id FROM departments WHERE id = $1 AND is_active = true`,
          [deptId],
        );
        if (!dept.length) throw ApiError.notFound(`Department ${deptId} not found`);
      }

      const primaryDeptId = deptIds[0] || null;

      await client.query(
        `INSERT INTO exit_pipeline_stages (stage_key, label, step_order, is_active, department_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (stage_key) DO UPDATE SET
           label = EXCLUDED.label,
           step_order = EXCLUDED.step_order,
           is_active = EXCLUDED.is_active,
           department_id = EXCLUDED.department_id,
           updated_at = NOW()`,
        [key, label, Number(s.step_order) || 1, s.is_active !== false, primaryDeptId],
      );

      try {
        await client.query(`DELETE FROM exit_pipeline_stage_departments WHERE stage_key = $1`, [key]);
        for (let i = 0; i < deptIds.length; i += 1) {
          await client.query(
            `INSERT INTO exit_pipeline_stage_departments (stage_key, department_id, sort_order)
             VALUES ($1, $2, $3)
             ON CONFLICT (stage_key, department_id) DO UPDATE SET sort_order = EXCLUDED.sort_order`,
            [key, deptIds[i], i + 1],
          );
        }
      } catch {
        /* junction table may not exist until migration 074 */
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return getExitPipelineStages(tenant);
}

/** Combined config for Settings tab: pipeline stages + department approval sequence */
async function getExitWorkflowConfig(tenant) {
  const [pipeline, departments] = await Promise.all([
    getExitPipelineStages(tenant),
    getOrgDepartmentWorkflowTemplate(tenant),
  ]);
  return { pipeline_stages: pipeline.stages, department_steps: departments.steps };
}

async function saveExitWorkflowConfig(tenant, body) {
  if (body.pipeline_stages?.length) {
    await saveExitPipelineStages(tenant, body.pipeline_stages);
    const deptSteps = [];
    let stepOrder = 1;
    body.pipeline_stages
      .slice()
      .sort((a, b) => (a.step_order || 0) - (b.step_order || 0))
      .forEach((s) => {
        stageDepartmentIds(s).forEach((departmentId) => {
          deptSteps.push({
            department_id: departmentId,
            step_order: stepOrder,
            is_mandatory: true,
            remarks: null,
          });
          stepOrder += 1;
        });
      });
    if (deptSteps.length) {
      await saveOrgDepartmentWorkflowTemplate(tenant, deptSteps);
    }
  } else if (body.department_steps?.length) {
    await saveOrgDepartmentWorkflowTemplate(tenant, body.department_steps);
  } else {
    throw ApiError.badRequest('Provide pipeline_stages to save');
  }
  return getExitWorkflowConfig(tenant);
}

module.exports = {
  listTerminationTypes,
  getTerminationType,
  createTerminationType,
  updateTerminationType,
  deleteTerminationType,
  listClearanceTemplates,
  getClearanceTemplate,
  createClearanceTemplate,
  updateClearanceTemplate,
  deleteClearanceTemplate,
  getActiveClearanceTemplates,
  getOrgDepartmentWorkflowTemplate,
  saveOrgDepartmentWorkflowTemplate,
  getExitPipelineStages,
  saveExitPipelineStages,
  getExitWorkflowConfig,
  saveExitWorkflowConfig,
};
