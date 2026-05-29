'use strict';

const { exitEvents, EVENTS } = require('./exitEventPublisher');
const { getTenantPool } = require('../../../config/db');

/**
 * Logs an event to the audit_logs table
 */
async function logAudit(tenant, instanceId, action, actorId, metadata) {
  try {
    const pool = await getTenantPool(tenant.dbName);
    await pool.query(
      `INSERT INTO exit_audit_logs (tenant_id, instance_id, action, actor_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenant.id, instanceId, action, actorId, metadata ? JSON.stringify(metadata) : null]
    );
  } catch (err) {
    console.error('Failed to write exit audit log:', err);
  }
}

// Setup listeners
exitEvents.on(EVENTS.WORKFLOW_STARTED, async ({ tenant, instanceId, actorId }) => {
  await logAudit(tenant, instanceId, EVENTS.WORKFLOW_STARTED, actorId, { status: 'Started' });
});

exitEvents.on(EVENTS.STEP_APPROVED, async ({ tenant, instanceId, stepId, actorId, comments }) => {
  await logAudit(tenant, instanceId, EVENTS.STEP_APPROVED, actorId, { stepId, comments });
});

exitEvents.on(EVENTS.STEP_REJECTED, async ({ tenant, instanceId, stepId, actorId, comments }) => {
  await logAudit(tenant, instanceId, EVENTS.STEP_REJECTED, actorId, { stepId, comments });
});

exitEvents.on(EVENTS.WORKFLOW_COMPLETED, async ({ tenant, instanceId }) => {
  await logAudit(tenant, instanceId, EVENTS.WORKFLOW_COMPLETED, null, { status: 'Completed' });
});

module.exports = {
  logAudit // Exposed for direct use if needed
};
