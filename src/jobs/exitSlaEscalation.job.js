'use strict';

const cron = require('node-cron');
const logger = require('../utils/logger');
const { superAdminPool, getTenantPool } = require('../config/db');
const delivery = require('../modules/notifications/notificationDelivery.service');
const { getHROrAdminRecipients } = require('../modules/employees/onboarding/utils/onboardingRecipients.utils');
const workflowAudit = require('../modules/workflow/workflowAudit.service');
const { getIo } = require('../socket');

async function getCompanyName(tenant) {
  try {
    const tenantSettingsService = require('../modules/tenantSettings/tenantSettings.service');
    const settings = await tenantSettingsService.getAdminSettings(tenant.db_name, '');
    return settings.companyName || tenant.name || 'Organisation';
  } catch (_) {
    return tenant.name || 'Organisation';
  }
}

async function notifySlaBreach(tenant, row, companyName) {
  const pool = await getTenantPool(tenant.db_name);
  const empName = row.full_name || [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Employee';
  const dueDate = row.stage_entered_at
    ? new Date(new Date(row.stage_entered_at).getTime() + (row.sla_hours || 0) * 3600000).toISOString()
    : '';
  const delayHours = row.sla_hours || row.escalation_after_hours || 0;
  const variables = {
    recipient_name: '',
    employee_name: empName,
    stage_name: row.stage_name || '',
    due_date: dueDate,
    delay_hours: String(delayHours),
    company_name: companyName,
  };

  const targets = new Map();

  if (row.escalation_to_user_id) {
    const { rows } = await pool.query(
      `SELECT id, full_name, work_email FROM employees WHERE id = $1 AND deleted_at IS NULL`,
      [row.escalation_to_user_id],
    );
    if (rows[0]) targets.set(rows[0].id, rows[0]);
  }

  if (row.current_owner_department_id) {
    const { rows } = await pool.query(
      `SELECT e.id, e.full_name, e.work_email
       FROM departments d
       JOIN employees e ON e.id = d.manager_id AND e.deleted_at IS NULL
       WHERE d.id = $1`,
      [row.current_owner_department_id],
    );
    if (rows[0]) targets.set(rows[0].id, rows[0]);
  }

  const hrAdmins = await getHROrAdminRecipients(pool);
  for (const hr of hrAdmins) targets.set(hr.id, hr);

  const tenantCtx = { dbName: tenant.db_name, db_name: tenant.db_name, id: tenant.id };

  for (const person of targets.values()) {
    variables.recipient_name = person.full_name || 'Colleague';
    await delivery.sendDedupedSystem(tenantCtx, {
      employeeId: person.id,
      title: 'Exit Workflow SLA Breach',
      message: `Stage "${row.stage_name}" for ${empName} is overdue (${delayHours}h SLA).`,
      type: 'exit_management',
      priority: 'HIGH',
      sendEmail: true,
      emailSubject: `Exit Workflow SLA Breach — ${row.stage_name}`,
      entityType: 'exit_request',
      entityId: row.request_id,
      redirectUrl: `/admin/exit-management/${row.request_id}`,
    }, {
      tenantId: tenant.id,
      notificationType: 'exit.sla_breach',
      entityType: 'exit_request',
      entityId: row.request_id,
      recipientId: person.id,
    });

    if (person.work_email) {
      await delivery.sendDedupedEmailOnly(
        tenantCtx,
        { to: person.work_email, templateSlug: 'exit_sla_escalation', variables },
        {
          tenantId: tenant.id,
          notificationType: 'exit.sla_breach.email',
          entityType: 'exit_request',
          entityId: row.request_id,
          recipientId: person.id,
        },
      );
    }
  }

  await workflowAudit.log(tenantCtx, {
    module: 'exit',
    action: 'sla_breach',
    entityType: 'exit_request',
    entityId: row.request_id,
    detail: { stageName: row.stage_name, delayHours },
  });
}

async function processTenantSlas(tenant) {
  const pool = await getTenantPool(tenant.db_name);

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
      AND COALESCE(s.escalation_after_hours, s.sla_hours) IS NOT NULL
      AND (er.stage_entered_at
           + (COALESCE(s.escalation_after_hours, s.sla_hours) || ' hours')::interval) < NOW()
      AND NOT EXISTS (
            SELECT 1 FROM exit_approvals a
            WHERE a.exit_request_id = er.id AND a.stage_id = s.id AND a.action = 'ESCALATE')
  `);

  if (!breached.length) return;

  logger.info(`[exitSlaEscalation] Found ${breached.length} SLA-breached stages for tenant=${tenant.db_name}`);
  const companyName = await getCompanyName(tenant);

  for (const row of breached) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

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

      await notifySlaBreach(tenant, row, companyName);

      const io = getIo();
      if (io) {
        const empName = row.full_name || [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Employee';
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
      `SELECT id, name, db_name FROM public.tenants WHERE status = 'active' ORDER BY id ASC`,
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

  scheduledJob = cron.schedule(
    '0 * * * *',
    () => {
      runExitSlaEscalationJob().catch((err) => logger.error('[exitSlaEscalation] cron runner error', err));
    },
    opts,
  );
  logger.info('[exitSlaEscalation] Cron registered successfully (runs hourly: 0 * * * *)');
  return scheduledJob;
}

module.exports = { startExitSlaEscalationCron, runExitSlaEscalationJob };
