'use strict';

const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');

/**
 * Helper to build a step for a workflow
 */
async function insertStep(client, workflowId, stepData, order) {
  const { rows } = await client.query(
    `INSERT INTO exit_workflow_steps (workflow_id, step_name, step_type, step_order, is_parallel, is_mandatory, sla_days, conditions)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      workflowId,
      stepData.step_name,
      stepData.step_type || 'Approval',
      order,
      stepData.is_parallel || false,
      stepData.is_mandatory !== false,
      stepData.sla_days || 0,
      stepData.conditions ? JSON.stringify(stepData.conditions) : null,
    ]
  );
  
  const stepId = rows[0].id;

  // Insert Assignees
  if (Array.isArray(stepData.assignees)) {
    for (const assignee of stepData.assignees) {
      await client.query(
        `INSERT INTO exit_workflow_step_assignees (step_id, assignee_type, assignee_value)
         VALUES ($1, $2, $3)`,
        [stepId, assignee.type, assignee.value]
      );
    }
  }

  // Handle dynamic forms for this step if present
  if (Array.isArray(stepData.forms)) {
    for (const form of stepData.forms) {
      const { rows: formRows } = await client.query(
        `INSERT INTO workflow_step_forms (step_id, form_name, description)
         VALUES ($1, $2, $3) RETURNING id`,
        [stepId, form.form_name, form.description || null]
      );
      const formId = formRows[0].id;

      if (Array.isArray(form.fields)) {
        for (const field of form.fields) {
          await client.query(
            `INSERT INTO workflow_form_fields (form_id, field_name, field_type, is_required, options)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              formId,
              field.field_name,
              field.field_type,
              field.is_required || false,
              field.options ? JSON.stringify(field.options) : null,
            ]
          );
        }
      }
    }
  }
}

/**
 * Creates a new Workflow Template
 */
async function createWorkflow(tenant, data) {
  const pool = await getTenantPool(tenant.dbName);
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // De-activate existing default if this one is default
    if (data.is_default) {
       await client.query(
           `UPDATE exit_workflows SET is_default = false WHERE tenant_id = $1 AND is_default = true`,
           [tenant.id]
       );
    }

    const { rows } = await client.query(
      `INSERT INTO exit_workflows (tenant_id, name, description, is_default, version)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [tenant.id, data.name, data.description || null, data.is_default || false, 1]
    );
    const workflow = rows[0];

    if (Array.isArray(data.steps)) {
      let order = 1;
      for (const step of data.steps) {
        await insertStep(client, workflow.id, step, order++);
      }
    }

    await client.query('COMMIT');
    return getWorkflowById(tenant, workflow.id);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Fetches a specific workflow with all its steps, assignees, and forms
 */
async function getWorkflowById(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  
  const { rows } = await pool.query(
    `SELECT * FROM exit_workflows WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [id, tenant.id]
  );
  if (!rows.length) throw ApiError.notFound('Workflow not found');
  
  const workflow = rows[0];

  const { rows: steps } = await pool.query(
    `SELECT * FROM exit_workflow_steps WHERE workflow_id = $1 ORDER BY step_order ASC`,
    [id]
  );
  
  for (const step of steps) {
    const { rows: assignees } = await pool.query(
      `SELECT assignee_type as type, assignee_value as value FROM exit_workflow_step_assignees WHERE step_id = $1`,
      [step.id]
    );
    step.assignees = assignees;

    const { rows: forms } = await pool.query(
      `SELECT * FROM workflow_step_forms WHERE step_id = $1`,
      [step.id]
    );
    for (const form of forms) {
      const { rows: fields } = await pool.query(
        `SELECT * FROM workflow_form_fields WHERE form_id = $1`,
        [form.id]
      );
      form.fields = fields;
    }
    step.forms = forms;
  }

  workflow.steps = steps;
  return workflow;
}

/**
 * Publishes a workflow (makes it immutable)
 */
async function publishWorkflow(tenant, id) {
  const draft = await getWorkflowById(tenant, id);
  if (draft.is_published) {
    throw ApiError.badRequest('Workflow is already published');
  }
  if (!Array.isArray(draft.steps) || draft.steps.length === 0) {
    throw ApiError.badRequest('Cannot publish a workflow with no steps. Add steps and save the draft first.');
  }

  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `UPDATE exit_workflows SET is_published = true, published_at = NOW(), updated_at = NOW() 
     WHERE id = $1 AND tenant_id = $2 AND is_published = false 
     RETURNING *`,
    [id, tenant.id]
  );
  if (!rows.length) {
      throw ApiError.badRequest('Workflow not found or already published');
  }
  return getWorkflowById(tenant, id);
}

/**
 * Clones a workflow (published or draft) into a new editable draft.
 */
async function cloneWorkflow(tenant, id) {
  const source = await getWorkflowById(tenant, id);
  const steps = (source.steps || []).map((step) => ({
    step_name: step.step_name,
    step_type: step.step_type || 'Approval',
    is_parallel: step.is_parallel || false,
    is_mandatory: step.is_mandatory !== false,
    sla_days: step.sla_days || 0,
    conditions: step.conditions || null,
    assignees: (step.assignees || []).map((a) => ({
      type: a.type,
      value: a.value,
    })),
    forms: step.forms || [],
  }));

  const nextVersion = Number(source.version || 1) + 1;
  return createWorkflow(tenant, {
    name: `${source.name} v${nextVersion}`,
    description: source.description,
    is_default: false,
    steps,
  });
}

/**
 * Updates a draft workflow (Deletes old steps and re-inserts)
 */
async function updateWorkflow(tenant, id, data) {
  const pool = await getTenantPool(tenant.dbName);
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { rows: existing } = await client.query(
      `SELECT is_published FROM exit_workflows WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id, tenant.id]
    );
    if (!existing.length) throw ApiError.notFound('Workflow not found');
    if (existing[0].is_published) {
        throw ApiError.badRequest('Cannot update a published workflow. Create a new version instead.');
    }

    if (data.is_default) {
        await client.query(
            `UPDATE exit_workflows SET is_default = false WHERE tenant_id = $1 AND id != $2`,
            [tenant.id, id]
        );
    }

    await client.query(
      `UPDATE exit_workflows SET name = COALESCE($1, name), description = COALESCE($2, description), is_default = COALESCE($3, is_default), updated_at = NOW()
       WHERE id = $4 AND tenant_id = $5`,
      [data.name, data.description, data.is_default, id, tenant.id]
    );

    // If steps are provided, rewrite them entirely
    if (data.steps) {
        await client.query(`DELETE FROM exit_workflow_steps WHERE workflow_id = $1`, [id]);
        
        let order = 1;
        for (const step of data.steps) {
            await insertStep(client, id, step, order++);
        }
    }

    await client.query('COMMIT');
    return getWorkflowById(tenant, id);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Fetches all workflows for a tenant
 */
async function listWorkflows(tenant, query = {}) {
    const pool = await getTenantPool(tenant.dbName);
    
    let sql = `SELECT * FROM exit_workflows WHERE tenant_id = $1 AND deleted_at IS NULL`;
    const params = [tenant.id];

    if (query.is_published !== undefined) {
        params.push(query.is_published === 'true');
        sql += ` AND is_published = $${params.length}`;
    }

    sql += ` ORDER BY created_at DESC`;

    const { rows } = await pool.query(sql, params);
    return rows;
}

/**
 * Soft deletes a workflow
 */
async function deleteWorkflow(tenant, id) {
    const pool = await getTenantPool(tenant.dbName);
    const { rows } = await pool.query(
      `UPDATE exit_workflows SET deleted_at = NOW() WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [id, tenant.id]
    );
    if (!rows.length) throw ApiError.notFound('Workflow not found');
    return { success: true };
}

module.exports = {
  createWorkflow,
  getWorkflowById,
  updateWorkflow,
  publishWorkflow,
  cloneWorkflow,
  listWorkflows,
  deleteWorkflow,
};
