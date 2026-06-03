'use strict';

const audit = require('./attendanceAudit.service');
const notify = require('./attendanceNotifications.service');
const { sendSystemNotification } = require('../../notifications/notifications.service');
const calc = require('./attendanceCalculation.service');

async function findStalePendingRegularizations(pool, maxDays) {
  const days = Math.max(1, Number(maxDays) || 3);
  const { rows } = await pool.query(
    `SELECT a.id, a.employee_id,
            TO_CHAR(a.date, 'YYYY-MM-DD') AS date,
            a.regularization_status, a.regularization_reason,
            a.updated_at,
            e.full_name AS employee_name, e.work_email
     FROM attendance a
     JOIN employees e ON e.id = a.employee_id AND e.deleted_at IS NULL
     WHERE a.regularization_status = 'Pending'
       AND a.updated_at < NOW() - ($1::int * INTERVAL '1 day')
     ORDER BY a.updated_at ASC`,
    [days],
  );
  return rows;
}

async function autoRejectRecord(pool, tenantDb, record, settings) {
  const days = settings?.auto_rejection_after_days ?? 3;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE attendance_regularization_steps
       SET status = 'Rejected', acted_by = NULL, acted_at = NOW(),
           remarks = $2
       WHERE attendance_id = $1 AND status = 'Pending'`,
      [
        record.id,
        `Auto-rejected after ${days} day(s) without approval`,
      ],
    );

    const { rows } = await client.query(
      `UPDATE attendance
       SET regularization_status = 'Rejected',
           status = 'Regularization Rejected',
           regularization_remarks = $2,
           regularized_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [record.id, `Auto-rejected after ${days} day(s) without approval`],
    );

    await client.query('COMMIT');

    const updated = rows[0];
    await audit.log(pool, {
      attendanceId: record.id,
      employeeId: record.employee_id,
      action: 'attendance.cron.auto_reject',
      oldValue: record,
      newValue: updated,
      performedBy: null,
      ipAddress: null,
      deviceInfo: 'attendance-cron',
    });

    await notify.notifyRegAutoRejected(pool, tenantDb, {
      employeeId: record.employee_id,
      date: record.date,
      entityId: record.id
    });

    return updated;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function processAutoRejections(pool, tenantDb, { skipBatchAudit = false } = {}) {
  const settings = await calc.loadSettings(pool);
  const maxDays = settings?.auto_rejection_after_days;
  if (maxDays == null || Number(maxDays) < 1) {
    return { rejected: 0, skipped: true };
  }

  const stale = await findStalePendingRegularizations(pool, maxDays);
  let rejected = 0;
  for (const row of stale) {
    try {
      await autoRejectRecord(pool, tenantDb, row, settings);
      rejected += 1;
    } catch (err) {
      const logger = require('../../../utils/logger');
      logger.error(`[attendanceAutoReject] id=${row.id} failed`, err);
    }
  }
  if (!skipBatchAudit && rejected > 0) {
    await audit.log(pool, {
      action: 'attendance.cron.auto_reject',
      newValue: { rejected, maxDays },
      deviceInfo: 'attendance-cron',
    });
  }
  return { rejected, skipped: false };
}

module.exports = {
  findStalePendingRegularizations,
  autoRejectRecord,
  processAutoRejections,
};
