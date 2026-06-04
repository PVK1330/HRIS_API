'use strict';

const cron = require('node-cron');
const logger = require('../utils/logger');
const { superAdminPool, getTenantPool } = require('../config/db');
const delivery = require('../modules/notifications/notificationDelivery.service');

async function processTenantOnboardingTasks(tenant) {
  const pool = await getTenantPool(tenant.db_name);

  // Look for pending tasks related to onboarding that are overdue
  const { rows: overdueTasks } = await pool.query(`
    SELECT t.id, t.title, t.assignee_id, t.due_date, t.related_entity_id,
           e.full_name AS assignee_name, e.work_email AS assignee_email,
           EXTRACT(EPOCH FROM (NOW() - t.due_date::timestamp))/3600 AS hours_overdue
    FROM tasks t
    JOIN employees e ON e.id = t.assignee_id
    WHERE t.related_entity_type = 'onboarding' 
      AND t.status = 'Pending'
      AND t.due_date::timestamp < NOW()
  `);

  if (!overdueTasks.length) return;

  logger.info(`[onboardingTaskEscalation] Found ${overdueTasks.length} overdue onboarding tasks for tenant=${tenant.db_name}`);

  for (const task of overdueTasks) {
    const hours = Math.floor(task.hours_overdue);
    
    // Only trigger escalations at specific intervals (e.g. 24, 48, 72 hours)
    if (hours >= 24 && hours < 25 || hours >= 48 && hours < 49 || hours >= 72 && hours < 73) {
      await delivery.sendDedupedSystem({ dbName: tenant.db_name }, {
        employeeId: task.assignee_id,
        title: 'Overdue Onboarding Task',
        message: `Your task "${task.title}" is ${hours} hours overdue. Please complete it immediately.`,
        type: 'onboarding',
        sendEmail: true,
        emailSubject: `Overdue Task: ${task.title}`
      }, {
        tenantId: tenant.id,
        notificationType: `onboarding.task.overdue.${hours}`,
        entityType: 'task',
        entityId: task.id,
        recipientId: task.assignee_id,
      });
      logger.info(`[onboardingTaskEscalation] Escalated task=${task.id} (${hours}h overdue) for tenant=${tenant.db_name}`);
    }
  }
}

async function runOnboardingTaskEscalationJob() {
  logger.info('[onboardingTaskEscalation] Job execution started');
  try {
    const { rows } = await superAdminPool.query(
      `SELECT id, name, db_name FROM public.tenants WHERE status = 'active' ORDER BY id ASC`,
    );
    for (const tenant of rows) {
      try {
        await processTenantOnboardingTasks(tenant);
      } catch (err) {
        logger.error(`[onboardingTaskEscalation] Tenant database processing failed for db_name=${tenant.db_name}`, err);
      }
    }
  } catch (err) {
    logger.error('[onboardingTaskEscalation] Failed to fetch active tenants list', err);
  }
  logger.info('[onboardingTaskEscalation] Job execution complete');
}

let scheduledJob = null;

function startOnboardingTaskEscalationCron() {
  if (scheduledJob) return scheduledJob;
  const opts = {};
  if (process.env.TZ) opts.timezone = process.env.TZ;

  // Run every hour
  scheduledJob = cron.schedule(
    '0 * * * *',
    () => {
      runOnboardingTaskEscalationJob().catch((err) => logger.error('[onboardingTaskEscalation] cron runner error', err));
    },
    opts,
  );
  logger.info('[onboardingTaskEscalation] Cron registered successfully (runs hourly: 0 * * * *)');
  return scheduledJob;
}

module.exports = { startOnboardingTaskEscalationCron, runOnboardingTaskEscalationJob };
