'use strict';

const cron = require('node-cron');
const logger = require('../utils/logger');
const { superAdminPool, getTenantPool } = require('../config/db');
const { pushNotification } = require('../modules/notifications/notifications.service');
const { getIo } = require('../socket');

async function processTenantSlas(tenant) {
  const pool = await getTenantPool(tenant.db_name);

  // Requests whose ACTIVE stage breached its SLA and have not been escalated this occurrence.
  // Reads the flat escalation columns + the exit_requests.stage_entered_at cache.
  const { rows: breached } = await pool.query(`
    SELECT er.id AS request_id, er.current_stage_id, er.current_owner_department_id,
           er.stage_entered_at, er.employee_id,
           s.name AS stage_name, s.sla_hours,
           s.escalation_enabled, s.escalation_after_hours,
           s.escalation_to_role_id, s.escalation_to_user_id, s.escalation_action,
           e.first_name, e.last_name, e.full_name
    FROM exit_requests er
    JOIN exit_workflow_stages s ON s.id = er.current_stage_id
    JOIN employees e            ON e.id = er.employee_id
    WHERE er.status = 'IN_PROGRESS'
      AND s.escalation_enabled = true
      AND s.sla_hours IS NOT NULL
      AND (er.stage_entered_at
           + (COALESCE(s.escalation_after_hours, s.sla_hours) || ' hours')::interval) < NOW()
      AND NOT EXISTS (
            SELECT 1 FROM exit_approvals a
            WHERE a.exit_request_id = er.id AND a.stage_id = s.id AND a.action = 'ESCALATE')
  `);

  if (!breached.length) return;

  logger.info(`[exitSlaEscalation] Found ${breached.length} SLA-breached stages for tenant=${tenant.db_name}`);

  for (const row of breached) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Apply the escalation rule (REASSIGN moves ownership toward the target's department).
      if (row.escalation_action === 'REASSIGN' && row.escalation_to_user_id) {
        const { rows: ed } = await client.query(
          `SELECT department_id FROM employees WHERE id = $1`, [row.escalation_to_user_id],
        );
        if (ed[0]?.department_id) {
          await client.query(
            `UPDATE exit_requests SET current_owner_department_id = $1, updated_at = NOW() WHERE id = $2`,
            [ed[0].department_id, row.request_id],
          );
        }
      }

      // 2. Record the ESCALATE action + flag the open PENDING slot.
      await client.query(
        `INSERT INTO exit_approvals
           (exit_request_id, stage_id, department_id, action, actor_name, comments, acted_at)
         VALUES ($1, $2, $3, 'ESCALATE', 'System', 'SLA breach auto-escalation', NOW())`,
        [row.request_id, row.current_stage_id, row.current_owner_department_id],
      );
      await client.query(
        `UPDATE exit_approvals SET is_sla_breached = true, escalated_at = NOW()
         WHERE exit_request_id = $1 AND stage_id = $2 AND action = 'PENDING'`,
        [row.request_id, row.current_stage_id],
      );

      await client.query('COMMIT');

      // 3. Notify admins (and the escalation target user, if any).
      const empName = row.full_name || [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Employee';
      try {
        await pushNotification({ dbName: tenant.db_name }, {
          forAdmin: true,
          title: 'Exit SLA Escalation',
          message: `Stage "${row.stage_name}" for ${empName} has breached its SLA and was escalated.`,
          type: 'exit_management',
        });
        if (row.escalation_to_user_id) {
          await pushNotification({ dbName: tenant.db_name }, {
            employeeId: row.escalation_to_user_id,
            title: 'Exit Stage Escalated To You',
            message: `An exit stage ("${row.stage_name}") for ${empName} has been escalated to you due to an SLA breach.`,
            type: 'exit_management',
          });
        }
      } catch (err) {
        logger.error(`[exitSlaEscalation] Notification failed for request=${row.request_id}`, err);
      }

      // 4. Real-time events (tenant + exit rooms).
      const io = getIo();
      if (io) {
        io.to(`tenant:${tenant.db_name}`).emit('exit:sla_breached', {
          exitRequestId: row.request_id,
          stageId: row.current_stage_id,
          stageName: row.stage_name,
          employeeName: empName,
        });
        io.to(`exit:${row.request_id}`).emit('exit:stage_escalated', {
          exitRequestId: row.request_id,
          stageId: row.current_stage_id,
        });
      }

      logger.info(`[exitSlaEscalation] Escalated request=${row.request_id} stage=${row.current_stage_id} (${tenant.db_name})`);
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error(`[exitSlaEscalation] Failed to escalate request=${row.request_id} on tenant=${tenant.db_name}`, err);
    } finally {
      client.release();
    }
  }
}

async function runExitSlaEscalationJob() {
  logger.info('[exitSlaEscalation] Job execution started');
  try {
    const { rows } = await superAdminPool.query(
      `SELECT id, name, db_name FROM public.tenants WHERE status = 'active' ORDER BY id ASC`
    );
    for (const tenant of rows) {
      try {
        await processTenantSlas(tenant);
      } catch (err) {
        logger.error(`[exitSlaEscalation] Tenant database processing failed for db_name=${tenant.db_name}`, err);
      }
    }
  } catch (err) {
    logger.error('[exitSlaEscalation] Failed to fetch active tenants list', err);
  }
  logger.info('[exitSlaEscalation] Job execution complete');
}

let scheduledJob = null;

function startExitSlaEscalationCron() {
  if (scheduledJob) return scheduledJob;
  const opts = {};
  if (process.env.TZ) opts.timezone = process.env.TZ;
  
  // Scheduled to run hourly
  scheduledJob = cron.schedule(
    '0 * * * *',
    () => {
      runExitSlaEscalationJob().catch((err) => logger.error('[exitSlaEscalation] cron runner error', err));
    },
    opts
  );
  logger.info('[exitSlaEscalation] Cron registered successfully (runs hourly: 0 * * * *)');
  return scheduledJob;
}

module.exports = { startExitSlaEscalationCron, runExitSlaEscalationJob };
