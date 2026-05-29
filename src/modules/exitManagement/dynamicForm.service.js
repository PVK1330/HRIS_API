'use strict';

const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');

async function getFormDefinition(tenant, formId) {
  const pool = await getTenantPool(tenant.dbName);
  
  const { rows: formRows } = await pool.query(
    `SELECT * FROM workflow_step_forms WHERE id = $1`, [formId]
  );
  if (!formRows.length) throw ApiError.notFound('Form not found');

  const { rows: fieldRows } = await pool.query(
    `SELECT * FROM workflow_form_fields WHERE form_id = $1 ORDER BY id ASC`, [formId]
  );

  return {
    ...formRows[0],
    fields: fieldRows
  };
}

async function submitForm(tenant, instanceStepId, formId, userId, data) {
  const pool = await getTenantPool(tenant.dbName);
  
  // Validate if step is active
  const { rows: stepRows } = await pool.query(
    `SELECT * FROM exit_workflow_instance_steps WHERE id = $1 AND status = 'Active'`,
    [instanceStepId]
  );
  if (!stepRows.length) throw ApiError.badRequest('Step is not active or does not exist');

  // Insert submission
  const { rows: submissionRows } = await pool.query(
    `INSERT INTO exit_workflow_form_submissions (instance_step_id, form_id, submitted_by, data)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [instanceStepId, formId, userId, JSON.stringify(data)]
  );

  return submissionRows[0];
}

async function getFormSubmission(tenant, instanceStepId, formId) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `SELECT * FROM exit_workflow_form_submissions 
     WHERE instance_step_id = $1 AND form_id = $2 
     ORDER BY submitted_at DESC LIMIT 1`,
    [instanceStepId, formId]
  );
  return rows[0] || null;
}

module.exports = {
  getFormDefinition,
  submitForm,
  getFormSubmission
};
