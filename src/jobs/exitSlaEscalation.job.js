'use strict';

const cron = require('node-cron');
const logger = require('../utils/logger');
const { superAdminPool, getTenantPool } = require('../config/db');
const { pushNotification } = require('../modules/notifications/notifications.service');
const { getIo } = require('../socket');

async function processTenantSlas(tenant) {
  const pool = await getTenantPool(tenant.db_name);
  
  // Find overdue incomplete tasks that have not been escalated yet
  const { rows: overdueTasks } = await pool.query(`
    SELECT ct.id, ct.task_name, ct.due_date, ct.exit_record_id, ct.department,
           e.first_name, e.last_name, e.full_name
    FROM clearance_tasks ct
    INNER JOIN exit_records er ON er.id = ct.exit_record_id
    INNER JOIN employees e ON e.id = er.employee_id
    WHERE ct.is_completed = false
      AND ct.due_date IS NOT NULL
      AND ct.due_date < NOW()
      AND ct.is_escalated = false
  `);

  if (!overdueTasks.length) return;

  logger.info(`[exitSlaEscalation] Found ${overdueTasks.length} overdue tasks for tenant=${tenant.db_name}`);

  for (const task of overdueTasks) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Mark task as escalated
      await client.query(`
        UPDATE clearance_tasks
        SET is_escalated = true, updated_at = NOW()
        WHERE id = $1
      `, [task.id]);

      // 2. Insert Exit Audit Log
      const empName = task.full_name || [task.first_name, task.last_name].filter(Boolean).join(' ') || 'Employee';
      await client.query(`
        INSERT INTO exit_audit_logs (exit_request_id, performed_by, performed_by_name, action, before_value, after_value)
        VALUES ($1, NULL, 'System', 'sla_escalated', $2, $3)
      `, [
        task.exit_record_id,
        JSON.stringify({ is_escalated: false }),
        JSON.stringify({ is_escalated: true, task_name: task.task_name, department: task.department })
      ]);

      await client.query('COMMIT');

      // 3. Push in-app notification to all Admins/HR
      try {
        await pushNotification(
          { dbName: tenant.db_name },
          {
            forAdmin: true,
            title: 'SLA Escalation Alert',
            message: `Clearance task "${task.task_name}" in department "${task.department}" for ${empName} has breached its due date!`,
            type: 'exit_management'
          }
        );
      } catch (err) {
        logger.error(`[exitSlaEscalation] Notification send failed for task=${task.id}`, err);
      }

      // 4. Emit WebSocket Event (Real-time update)
      const io = getIo();
      if (io) {
        // Emit to the tenant room and the exit room
        io.to(`tenant:${tenant.db_name}`).emit('exit:sla_breached', {
          taskId: task.id,
          exitRecordId: task.exit_record_id,
          taskName: task.task_name,
          employeeName: empName,
          department: task.department
        });
        io.to(`exit:${task.exit_record_id}`).emit('exit:task_updated', {
          taskId: task.id,
          is_escalated: true
        });
      }

      logger.info(`[exitSlaEscalation] Escalated task=${task.id} exit_record_id=${task.exit_record_id} successfully`);
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error(`[exitSlaEscalation] Failed to escalate task=${task.id} on tenant=${tenant.db_name}`, err);
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
