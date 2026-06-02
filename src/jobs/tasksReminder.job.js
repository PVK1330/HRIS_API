'use strict';

const cron = require('node-cron');
const { superAdminPool, getTenantPool } = require('../config/db');
const { runTenantMigrations } = require('../modules/tenant/tenant.service');
const notificationService = require('../modules/notifications/notifications.service');
const { getTaskReminderTemplate } = require('../templates/taskReminder.template');
const logger = require('../utils/logger');
const moment = require('moment');

async function processTenant(tenant) {
  const dbName = tenant.db_name;
  try {
    await runTenantMigrations(dbName);
    const pool = await getTenantPool(dbName);
    
    // Check 3 days before
    await checkAndSendReminders(pool, tenant, '3d', 3, 'Task Due in 3 Days');
    
    // Check 1 day before
    await checkAndSendReminders(pool, tenant, '1d', 1, 'Task Due Tomorrow');
    
    // Check due today
    await checkAndSendReminders(pool, tenant, 'due', 0, 'Task Due Today');
    
    // Check overdue
    await checkAndSendReminders(pool, tenant, 'overdue', -1, 'Task Overdue');
    
  } catch (err) {
    logger.error(`Error processing task reminders for tenant ${dbName}:`, err);
  }
}

async function checkAndSendReminders(pool, tenant, type, daysOffset, titlePrefix) {
  const columnMap = {
    '3d': 'reminded_3d',
    '1d': 'reminded_1d',
    'due': 'reminded_due',
    'overdue': 'reminded_overdue'
  };
  const flagColumn = columnMap[type];
  
  let dateFilter = '';
  if (daysOffset === -1) {
    // Overdue: Due date is in the past, and status is not Completed
    dateFilter = `due_date < CURRENT_DATE`;
  } else {
    // Specific offset
    dateFilter = `due_date = CURRENT_DATE + INTERVAL '${daysOffset} days'`;
  }

  const query = `
    SELECT t.*, 
           e.first_name || ' ' || e.last_name as assignee_name,
           e.work_email as assignee_email
    FROM tasks t
    JOIN employees e ON t.assignee_id = e.id
    WHERE t.status != 'Completed'
      AND t.due_date IS NOT NULL
      AND ${dateFilter}
      AND t.${flagColumn} = FALSE
  `;

  const { rows: tasks } = await pool.query(query);

  for (const task of tasks) {
    try {
      const emailHtml = getTaskReminderTemplate({
        title: titlePrefix,
        assigneeName: task.assignee_name,
        taskTitle: task.title,
        dueDate: moment(task.due_date).format('MMMM Do YYYY'),
        status: task.status,
        message: type === 'overdue' 
          ? `This is a reminder that the task "${task.title}" is overdue. Please address it as soon as possible.`
          : `This is a reminder that the task "${task.title}" is due soon.`
      });

      await notificationService.sendSystemNotification(tenant, {
        employeeId: task.assignee_id,
        title: `${titlePrefix}: ${task.title}`,
        message: `Task "${task.title}" is ${type === 'overdue' ? 'overdue' : 'due soon'}.`,
        emailMessage: emailHtml,
        type: type === 'overdue' ? 'warning' : 'info',
        entityType: 'task',
        entityId: task.id,
        redirectUrl: `/admin/tasks/${task.id}`,
        sendEmail: true
      });

      // Mark as reminded
      await pool.query(`UPDATE tasks SET ${flagColumn} = TRUE WHERE id = $1`, [task.id]);

    } catch (err) {
      logger.error(`Failed to send reminder for task ${task.id} in tenant ${tenant.db_name}:`, err);
    }
  }
}

async function runTaskReminders() {
  logger.info('Starting task reminders cron job sweep...');
  try {
    const { rows: tenants } = await superAdminPool.query(
      "SELECT * FROM tenants WHERE status = 'active'"
    );
    for (const tenant of tenants) {
      await processTenant(tenant);
    }
  } catch (err) {
    logger.error('Error running task reminders sweep:', err);
  }
}

function startTaskRemindersCron() {
  // Run every day at 08:00 AM server time
  cron.schedule('0 8 * * *', () => {
    runTaskReminders();
  });
  logger.info('Task reminders cron job scheduled (0 8 * * *)');
}

module.exports = {
  startTaskRemindersCron,
  runTaskReminders // exported for manual testing
};
