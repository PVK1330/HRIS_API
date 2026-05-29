'use strict';

const cron = require('node-cron');
const { getPool } = require('../../../config/db');
const { exitEvents, EVENTS } = require('../events/exitEventPublisher');
const logger = require('../../../utils/logger');

async function checkSlaBreaches() {
  logger.info('Running Exit SLA Escallation Cron...');
  const pool = await getPool(); // Superadmin connection to iterate tenants or just query tenant DBs
  
  // In a real multi-tenant setup, you'd iterate active tenants here.
  // Assuming a simplistic single query if tenants share a DB schema with tenant_id, 
  // or a loop over tenant DBs.
  // For the sake of this enterprise architecture:
  try {
    const { rows: tenants } = await pool.query(`SELECT tenant_id, db_name FROM tenants WHERE is_active = true`);
    
    for (const tenant of tenants) {
      const { getTenantPool } = require('../../../config/db');
      const tenantPool = await getTenantPool(tenant.db_name);
      
      const { rows: breachedSteps } = await tenantPool.query(`
        SELECT i.*, t.sla_days 
        FROM exit_workflow_instance_steps i
        JOIN exit_workflow_steps t ON t.id = i.step_id
        WHERE i.status = 'Active' 
        AND t.sla_days > 0 
        AND i.started_at + (t.sla_days || ' days')::interval < NOW()
      `);

      for (const step of breachedSteps) {
        exitEvents.emit(EVENTS.SLA_BREACHED, { 
          tenant, 
          instanceId: step.instance_id, 
          stepId: step.id 
        });
        
        // Log it to prevent duplicate notifications, or implement a cooldown
        await tenantPool.query(`UPDATE exit_workflow_instance_steps SET comments = COALESCE(comments, '') || ' [SLA BREACHED]' WHERE id = $1`, [step.id]);
      }
    }
  } catch (err) {
    logger.error('Error in Exit SLA Cron:', err);
  }
}

function startExitSlaEscalationCron() {
  // Run daily at 1 AM
  cron.schedule('0 1 * * *', checkSlaBreaches);
}

module.exports = {
  startExitSlaEscalationCron
};
