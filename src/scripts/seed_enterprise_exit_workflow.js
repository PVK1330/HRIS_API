'use strict';

const { getTenantPool } = require('../config/db');

async function seedEnterpriseExitWorkflow(dbName) {
  const pool = getTenantPool(dbName);
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Clear existing
    await client.query('DELETE FROM exit_workflows');
    
    // Create new workflow
    const { rows: wfRows } = await client.query(`
      INSERT INTO exit_workflows (name, exit_type, description, is_default, is_active)
      VALUES ('Enterprise Employee Exit', NULL, 'Standard 8-stage enterprise exit pipeline', true, true)
      RETURNING id
    `);
    const workflowId = wfRows[0].id;
    
    // Define the 8 stages
    const stages = [
      { name: 'Reporting Manager Approval', order: 1, mode: 'ANY', sla: 48, dep: null, es_action: 'REASSIGN' },
      { name: 'Department Head Approval', order: 2, mode: 'ANY', sla: 48, dep: null, es_action: 'REASSIGN' },
      { name: 'HR Review', order: 3, mode: 'ANY', sla: 48, dep: 'HR', es_action: 'REASSIGN' },
      { name: 'Finance Clearance', order: 4, mode: 'ANY', sla: 120, dep: 'Finance', es_action: 'REASSIGN' },
      { name: 'IT Account Disablement', order: 5, mode: 'ANY', sla: 24, dep: 'IT', es_action: 'REASSIGN' },
      { name: 'Asset Recovery', order: 6, mode: 'ANY', sla: 48, dep: 'Administration', es_action: 'REASSIGN' },
      { name: 'Final HR Approval', order: 7, mode: 'ANY', sla: 24, dep: 'HR', es_action: 'REASSIGN' },
      { name: 'Org Admin Sign-off', order: 8, mode: 'ANY', sla: 48, dep: 'Administration', es_action: 'REASSIGN' }
    ];
    
    for (const stage of stages) {
      const { rows: stageRows } = await client.query(`
        INSERT INTO exit_workflow_stages 
        (workflow_id, name, stage_order, approval_mode, sla_hours, escalation_action, block_until_checklist_complete)
        VALUES ($1, $2, $3, $4, $5, $6, true)
        RETURNING id
      `, [workflowId, stage.name, stage.order, stage.mode, stage.sla, stage.es_action]);
      
      const stageId = stageRows[0].id;
      
      if (stage.dep) {
        // Find department ID
        const { rows: depRows } = await client.query(`SELECT id FROM departments WHERE name ILIKE $1 LIMIT 1`, [stage.dep]);
        if (depRows.length > 0) {
          await client.query(`
            INSERT INTO exit_stage_departments (stage_id, department_id, is_primary)
            VALUES ($1, $2, true)
          `, [stageId, depRows[0].id]);
        }
      }
    }
    
    await client.query('COMMIT');
    console.log(`[${dbName}] Successfully seeded Enterprise Exit Workflow`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`[${dbName}] Failed to seed exit workflow:`, err);
  } finally {
    client.release();
  }
}

if (require.main === module) {
  const dbName = process.argv[2];
  if (!dbName) {
    console.error("Please provide dbName as argument");
    process.exit(1);
  }
  seedEnterpriseExitWorkflow(dbName).then(() => process.exit(0));
}

module.exports = seedEnterpriseExitWorkflow;
