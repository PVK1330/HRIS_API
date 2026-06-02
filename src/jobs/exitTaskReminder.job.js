'use strict';

const cron = require('node-cron');
const logger = require('../utils/logger');
const { superAdminPool, getTenantPool } = require('../config/db');
const notificationService = require('../modules/notifications/notifications.service');
const { Mailer } = require('../helpers/mailer/mailer');

async function sendReminder({ tenant, task, overdue }) {
  const title = overdue ? 'Exit Task Overdue' : 'Exit Task Due Soon';
  const message = overdue
    ? `Your exit task "${task.title}" is overdue. Please complete it or provide a delay reason.`
    : `Your exit task "${task.title}" is due soon. Please complete it before the deadline.`;

  await notificationService.sendSystemNotification(
    { dbName: tenant.db_name },
    {
      employeeId: task.assigned_to,
      title,
      message,
      type: overdue ? 'warning' : 'info',
      entityType: 'exit_request',
      entityId: task.exit_request_id,
      redirectUrl: `/admin/exit-management/${task.exit_request_id}`,
      sendEmail: true,
      emailSubject: title,
    },
  );

  await notificationService.pushNotification(
    { dbName: tenant.db_name },
    {
      forAdmin: true,
      title,
      message: `${message} Assignee: ${task.assignee_name || 'Unknown'}.`,
      type: overdue ? 'warning' : 'info',
      entityType: 'exit_request',
      entityId: task.exit_request_id,
      redirectUrl: `/admin/exit-management/${task.exit_request_id}`,
    },
  );

  if (task.assignee_email) {
    try {
      const mailer = await Mailer.getInstance();
      await mailer.send({
        to: task.assignee_email,
        subject: title,
        html: `<p>Hello ${task.assignee_name || 'Colleague'},</p>
               <p>${message}</p>
               <p><b>Request:</b> ${task.employee_name || 'Employee'} (${task.exit_type || 'exit'})</p>
               <p><b>Due at:</b> ${task.due_at ? new Date(task.due_at).toLocaleString() : 'N/A'}</p>`,
      });
    } catch (err) {
      logger.warn(`[exitTaskReminder] direct email failed for task ${task.id}: ${err.message}`);
    }
  }
}

async function processTenant(tenant) {
  const pool = await getTenantPool(tenant.db_name);

  const { rows: dueSoon } = await pool.query(
    `SELECT t.id, t.exit_request_id, t.assigned_to, t.title, t.due_at, t.reminder_5d_sent,
            e.full_name AS assignee_name, e.work_email AS assignee_email,
            er.exit_type, emp.full_name AS employee_name
     FROM exit_tasks t
     JOIN exit_requests er ON er.id = t.exit_request_id
     LEFT JOIN employees e ON e.id = t.assigned_to
     LEFT JOIN employees emp ON emp.id = er.employee_id
     WHERE t.status = 'PENDING'
       AND t.assigned_to IS NOT NULL
       AND t.due_at IS NOT NULL
       AND t.reminder_5d_sent = false
       AND t.due_at <= NOW() + INTERVAL '2 days'
       AND t.due_at > NOW()`,
  );

  const { rows: overdue } = await pool.query(
    `SELECT t.id, t.exit_request_id, t.assigned_to, t.title, t.due_at, t.overdue_notified,
            e.full_name AS assignee_name, e.work_email AS assignee_email,
            er.exit_type, emp.full_name AS employee_name
     FROM exit_tasks t
     JOIN exit_requests er ON er.id = t.exit_request_id
     LEFT JOIN employees e ON e.id = t.assigned_to
     LEFT JOIN employees emp ON emp.id = er.employee_id
     WHERE t.status = 'PENDING'
       AND t.assigned_to IS NOT NULL
       AND t.due_at IS NOT NULL
       AND t.overdue_notified = false
       AND t.due_at <= NOW()`,
  );

  for (const task of dueSoon) {
    try {
      await sendReminder({ tenant, task, overdue: false });
      await pool.query(`UPDATE exit_tasks SET reminder_5d_sent = true WHERE id = $1`, [task.id]);
    } catch (err) {
      logger.error(`[exitTaskReminder] due-soon notification failed task=${task.id}`, err);
    }
  }

  for (const task of overdue) {
    try {
      await sendReminder({ tenant, task, overdue: true });
      await pool.query(`UPDATE exit_tasks SET overdue_notified = true WHERE id = $1`, [task.id]);
    } catch (err) {
      logger.error(`[exitTaskReminder] overdue notification failed task=${task.id}`, err);
    }
  }
}

async function runExitTaskReminderJob() {
  try {
    const { rows: tenants } = await superAdminPool.query(
      `SELECT id, db_name FROM tenants WHERE status = 'active'`,
    );
    for (const tenant of tenants) {
      await processTenant(tenant);
    }
  } catch (err) {
    logger.error('[exitTaskReminder] job failed', err);
  }
}

let scheduledJob = null;
function startExitTaskReminderCron() {
  if (scheduledJob) return scheduledJob;
  const opts = {};
  if (process.env.TZ) opts.timezone = process.env.TZ;
  scheduledJob = cron.schedule('0 * * * *', () => {
    runExitTaskReminderJob().catch((err) => logger.error('[exitTaskReminder] cron error', err));
  }, opts);
  logger.info('[exitTaskReminder] Cron registered (hourly)');
  return scheduledJob;
}

module.exports = { startExitTaskReminderCron, runExitTaskReminderJob };
