'use strict';

const cron = require('node-cron');
const moment = require('moment-timezone');
const logger = require('../utils/logger');
const { superAdminPool, getTenantPool } = require('../config/db');
const { sendMail } = require('../utils/mail');

/**
 * Process performance cycle reminders for a specific tenant.
 */
async function processTenant(tenant) {
  const pool = getTenantPool(tenant.db_name);

  // 1. Find cycles that need reminders (automated_reminder = true, ACTIVE/UPCOMING, deadline within 3 days)
  const cyclesQuery = `
    SELECT id, cycle_name, submission_deadline 
    FROM performance_cycles 
    WHERE deleted_at IS NULL 
      AND automated_reminder = true 
      AND status IN ('ACTIVE', 'UPCOMING')
      AND submission_deadline > NOW() 
      AND submission_deadline <= NOW() + INTERVAL '3 days'
  `;
  const { rows: cycles } = await pool.query(cyclesQuery);

  if (cycles.length === 0) return;

  for (const cycle of cycles) {
    // 2. Find employees with pending assessments who haven't received a reminder
    const pendingQuery = `
      SELECT ep.id as assessment_id, ep.employee_id, e.work_email, e.full_name
      FROM employee_performance ep
      JOIN employees e ON e.id = ep.employee_id
      LEFT JOIN performance_cycle_reminders pcr 
        ON pcr.cycle_id = ep.performance_cycle_id 
        AND pcr.recipient_id = ep.employee_id 
        AND pcr.recipient_type = 'EMPLOYEE'
      WHERE ep.performance_cycle_id = $1
        AND ep.status = 'Pending'
        AND ep.deleted_at IS NULL
        AND e.deleted_at IS NULL
        AND pcr.id IS NULL
    `;
    const { rows: pendingEmployees } = await pool.query(pendingQuery, [cycle.id]);

    for (const emp of pendingEmployees) {
      if (!emp.work_email) continue;

      try {
        const deadlineStr = moment(cycle.submission_deadline).format('MMMM Do, YYYY');

        // 3. Send Email
        await sendMail({
          to: emp.work_email,
          subject: `Reminder: Performance Review Due for ${cycle.cycle_name}`,
          text: `Reminder: Your performance review for ${cycle.cycle_name} is due on ${deadlineStr}. Please complete your pending actions.`,
          html: `
            <div style="font-family: sans-serif;">
              <h2>Performance Review Reminder</h2>
              <p>Hi ${emp.full_name},</p>
              <p>This is an automated reminder that your performance review for <strong>${cycle.cycle_name}</strong> is due on <strong>${deadlineStr}</strong>.</p>
              <p>Please log in to the HRIS portal to complete any pending actions.</p>
              <br/>
              <p>Thank you,</p>
              <p>HR Team</p>
            </div>
          `,
          tenant: { dbName: tenant.db_name }
        });

        // 4. Record reminder sent
        await pool.query(
          `INSERT INTO performance_cycle_reminders (cycle_id, recipient_type, recipient_id, sent_at)
           VALUES ($1, 'EMPLOYEE', $2, NOW())`,
          [cycle.id, emp.employee_id]
        );

        logger.debug(`[performanceReminder] Sent reminder to ${emp.work_email} for cycle ${cycle.id}`);
      } catch (err) {
        logger.error(`[performanceReminder] Failed to send reminder to ${emp.work_email}: ${err.message}`);
      }
    }
  }
}

async function runAllTenants() {
  const { rows: tenants } = await superAdminPool.query(
    `SELECT db_name FROM tenants WHERE status = 'active' AND db_name IS NOT NULL`
  );

  for (const t of tenants) {
    try {
      await processTenant(t);
    } catch (e) {
      logger.error(`[performanceReminder] tenant=${t.db_name} failed`, e);
    }
  }
}

function startPerformanceCycleReminderCron() {
  if (process.env.DISABLE_PERFORMANCE_CRON === 'true') {
    logger.debug('Performance reminder cron disabled');
    return;
  }

  const { isCronLeader } = require('../utils/cronLeader');
  if (!isCronLeader()) {
    logger.info('[performanceReminder] not the cron leader — not scheduling');
    return;
  }

  // Run daily at 09:00 UTC
  cron.schedule('0 9 * * *', () => {
    runAllTenants().catch((e) => logger.error('[performanceReminder] run failed', e));
  });
  logger.info('[performanceReminder] scheduled daily at 09:00 UTC');
}

module.exports = {
  startPerformanceCycleReminderCron,
  runAllTenants,
  processTenant,
};
