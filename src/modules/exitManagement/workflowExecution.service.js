'use strict';

const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const { STATES, determineNextWorkflowStatus } = require('./state-machine/exitStateMachine');
const { evaluateConditions } = require('./rules/ruleEngine.service');
const { exitEvents, EVENTS } = require('./events/exitEventPublisher');

// Ensure listeners are loaded
require('./events/exitEventListeners');

/**
 * Resolves assignees for a step (very simplified mock implementation)
 */
async function resolveAssigneesForStep(pool, stepId) {
  // In a real system, you query the assignees from exit_workflow_step_assignees
  // and map them to actual user IDs based on the employee's department/role.
  const { rows } = await pool.query(
    `SELECT assignee_type, assignee_value FROM exit_workflow_step_assignees WHERE step_id = $1`,
    [stepId]
  );
  
  const resolvedUsers = [];
  const resolvedRoles = [];
  
  for (const a of rows) {
    if (a.assignee_type === 'SpecificUser') {
      resolvedUsers.push(parseInt(a.assignee_value, 10));
    } else {
      resolvedRoles.push(`${a.assignee_type}:${a.assignee_value}`);
    }
  }
  
  return { resolvedUsers, resolvedRoles };
}

/**
 * Initiates a workflow instance from a template
 */
async function startWorkflow(tenant, employeeId, workflowId, initiatedBy) {
  const pool = await getTenantPool(tenant.dbName);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Validate template
    const { rows: wfRows } = await client.query(
      `SELECT * FROM exit_workflows WHERE id = $1 AND tenant_id = $2`,
      [workflowId, tenant.id]
    );
    if (!wfRows.length) throw ApiError.notFound('Workflow template not found');

    // 2. Create Instance
    const { rows: instanceRows } = await client.query(
      `INSERT INTO exit_workflow_instances (tenant_id, employee_id, workflow_id, status, initiated_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [tenant.id, employeeId, workflowId, STATES.SUBMITTED, initiatedBy]
    );
    const instanceId = instanceRows[0].id;

    // 3. Instantiate steps
    const { rows: stepRows } = await client.query(
      `SELECT * FROM exit_workflow_steps WHERE workflow_id = $1 ORDER BY step_order ASC`,
      [workflowId]
    );

    // Get employee context for rule engine
    const { rows: empRows } = await client.query(
      `SELECT * FROM employees WHERE id = $1`, [employeeId]
    );
    const employeeContext = empRows[0] || {};

    let orderMap = new Map();
    
    for (const step of stepRows) {
      // Rule Engine: Skip steps that do not meet conditions
      const shouldRun = evaluateConditions(step.conditions, employeeContext);
      const status = shouldRun ? 'Pending' : 'Skipped';

      const { resolvedUsers, resolvedRoles } = await resolveAssigneesForStep(client, step.id);

      const { rows: instStepRows } = await client.query(
        `INSERT INTO exit_workflow_instance_steps (instance_id, step_id, status, assigned_to_users, assigned_to_roles)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [instanceId, step.id, status, resolvedUsers, resolvedRoles]
      );
      
      if (!orderMap.has(step.step_order)) {
        orderMap.set(step.step_order, []);
      }
      orderMap.get(step.step_order).push({ id: instStepRows[0].id, status });
    }

    await client.query('COMMIT');
    
    exitEvents.emit(EVENTS.WORKFLOW_STARTED, { tenant, instanceId, actorId: initiatedBy });

    // Progress the workflow immediately to trigger the first set of Active steps
    await processNextSteps(tenant, instanceId);

    return { instanceId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Core engine to progress the workflow states
 */
async function processNextSteps(tenant, instanceId) {
  const pool = await getTenantPool(tenant.dbName);
  
  // Fetch instance and all instance_steps joined with template steps to get ordering
  const { rows: instRows } = await pool.query(
    `SELECT * FROM exit_workflow_instances WHERE id = $1 AND tenant_id = $2`,
    [instanceId, tenant.id]
  );
  if (!instRows.length) return;
  const instance = instRows[0];

  const { rows: steps } = await pool.query(
    `SELECT i.*, t.step_order, t.is_parallel, t.step_type
     FROM exit_workflow_instance_steps i
     JOIN exit_workflow_steps t ON t.id = i.step_id
     WHERE i.instance_id = $1
     ORDER BY t.step_order ASC`,
    [instanceId]
  );

  let activeOrder = null;

  // Find the first order that is not completely Approved or Skipped
  for (const step of steps) {
    if (step.status === 'Pending' || step.status === 'Active' || step.status === 'Rejected') {
      activeOrder = step.step_order;
      break;
    }
  }

  let stepsActivated = false;

  if (activeOrder !== null) {
    // Activate all pending steps in the current order block
    const currentBlockSteps = steps.filter(s => s.step_order === activeOrder);
    
    for (const step of currentBlockSteps) {
      if (step.status === 'Pending') {
        await pool.query(
          `UPDATE exit_workflow_instance_steps SET status = 'Active', started_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [step.id]
        );
        stepsActivated = true;
        exitEvents.emit(EVENTS.STEP_ACTIVATED, { tenant, instanceId, stepId: step.id });
      }
    }
  }

  // Update high-level instance status based on step progression
  const newStatus = determineNextWorkflowStatus(instance.status, steps);
  if (newStatus !== instance.status) {
    await pool.query(
      `UPDATE exit_workflow_instances SET status = $1, updated_at = NOW() WHERE id = $2`,
      [newStatus, instanceId]
    );
    if (newStatus === STATES.COMPLETED) {
      exitEvents.emit(EVENTS.WORKFLOW_COMPLETED, { tenant, instanceId });
    }
  }
}

/**
 * Approve a specific step
 */
async function approveStep(tenant, instanceId, instanceStepId, userId, comments) {
  const pool = await getTenantPool(tenant.dbName);
  
  const { rows } = await pool.query(
    `UPDATE exit_workflow_instance_steps 
     SET status = 'Approved', completed_by = $1, completed_at = NOW(), comments = $2, updated_at = NOW()
     WHERE id = $3 AND instance_id = $4 AND status = 'Active' RETURNING *`,
    [userId, comments, instanceStepId, instanceId]
  );

  if (!rows.length) throw ApiError.badRequest('Step is not active or not found');

  exitEvents.emit(EVENTS.STEP_APPROVED, { tenant, instanceId, stepId: instanceStepId, actorId: userId, comments });

  await processNextSteps(tenant, instanceId);
  return rows[0];
}

/**
 * Reject a specific step
 */
async function rejectStep(tenant, instanceId, instanceStepId, userId, comments) {
  const pool = await getTenantPool(tenant.dbName);
  
  const { rows } = await pool.query(
    `UPDATE exit_workflow_instance_steps 
     SET status = 'Rejected', completed_by = $1, completed_at = NOW(), comments = $2, updated_at = NOW()
     WHERE id = $3 AND instance_id = $4 AND status = 'Active' RETURNING *`,
    [userId, comments, instanceStepId, instanceId]
  );

  if (!rows.length) throw ApiError.badRequest('Step is not active or not found');

  // Fast-fail the whole workflow
  await pool.query(
    `UPDATE exit_workflow_instances SET status = $1, updated_at = NOW() WHERE id = $2`,
    [STATES.REJECTED, instanceId]
  );

  exitEvents.emit(EVENTS.STEP_REJECTED, { tenant, instanceId, stepId: instanceStepId, actorId: userId, comments });
  exitEvents.emit(EVENTS.WORKFLOW_REJECTED, { tenant, instanceId });
  
  return rows[0];
}

module.exports = {
  startWorkflow,
  approveStep,
  rejectStep,
  processNextSteps
};
