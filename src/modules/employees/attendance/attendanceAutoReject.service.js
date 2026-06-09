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

    const { rows } = await client.query(
      `UPDATE attendance
       SET regularization_status = 'Rejected',
           status = 'Regularization Rejected',
           manager_approval_status    = CASE WHEN manager_approval_status    = 'Pending' THEN 'Rejected' ELSE manager_approval_status    END,
           department_approval_status = CASE WHEN department_approval_status = 'Pending' THEN 'Rejected' ELSE department_approval_status END,
           hr_approval_status         = CASE WHEN hr_approval_status         = 'Pending' THEN 'Rejected' ELSE hr_approval_status         END,
           reg_current_stage = 'done',
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

// ─── Auto-approve when the reporting manager is absent ────────────────────────

async function findStuckManagerStageRegularizations(pool, maxDays) {
  const days = Math.max(1, Number(maxDays) || 3);
  const { rows } = await pool.query(
    `SELECT a.id, a.employee_id, TO_CHAR(a.date, 'YYYY-MM-DD') AS date,
            a.department_approval_status, a.hr_approval_status, a.updated_at,
            e.full_name AS employee_name
     FROM attendance a
     JOIN employees e ON e.id = a.employee_id AND e.deleted_at IS NULL
     WHERE a.regularization_status = 'Pending'
       AND a.reg_current_stage = 'manager'
       AND a.updated_at < NOW() - ($1::int * INTERVAL '1 day')
     ORDER BY a.updated_at ASC`,
    [days],
  );
  return rows;
}

// Approve the manager stage (manager absent) and advance to the next pending
// stage; finalise as Approved only if no later stage remains.
async function autoApproveManagerStage(pool, tenantDb, record, settings) {
  const days = settings?.regularization_auto_approve_after_days ?? 3;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE attendance
       SET manager_approval_status = 'Approved',
           manager_approved_at = NOW(),
           reg_current_stage = CASE
             WHEN department_approval_status = 'Pending' THEN 'department'
             WHEN hr_approval_status = 'Pending' THEN 'hr'
             ELSE 'done' END,
           regularization_status = CASE
             WHEN department_approval_status = 'Pending' OR hr_approval_status = 'Pending' THEN 'Pending'
             ELSE 'Approved' END,
           status = CASE
             WHEN department_approval_status = 'Pending' OR hr_approval_status = 'Pending' THEN status
             ELSE 'Regularization Approved' END,
           regularization_remarks = $2,
           regularized_at = NOW(),
           updated_at = NOW()
       WHERE id = $1 AND regularization_status = 'Pending' AND reg_current_stage = 'manager'
       RETURNING *`,
      [record.id, `Auto-approved manager stage after ${days} day(s) (manager absent)`],
    );
    await client.query('COMMIT');

    const updated = rows[0];
    if (!updated) return null;

    await audit.log(pool, {
      attendanceId: record.id,
      employeeId: record.employee_id,
      action: 'attendance.cron.auto_approve_manager_absent',
      oldValue: record,
      newValue: updated,
      performedBy: null,
      ipAddress: null,
      deviceInfo: 'attendance-cron',
    });

    try {
      if (updated.regularization_status === 'Approved') {
        await notify.notifyRegApproved(pool, tenantDb, {
          employeeId: record.employee_id, date: record.date, entityId: record.id,
        });
      } else {
        await notify.notifyRegForwarded(pool, tenantDb, {
          employeeId: record.employee_id, date: record.date, entityId: record.id,
          nextStage: updated.reg_current_stage,
        });
      }
    } catch (_) { /* non-blocking */ }

    return updated;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function processAutoApprovals(pool, tenantDb) {
  const settings = await calc.loadSettings(pool);
  if (settings?.regularization_auto_approve_enabled !== true) {
    return { approved: 0, skipped: true };
  }
  const maxDays = settings?.regularization_auto_approve_after_days;
  if (maxDays == null || Number(maxDays) < 1) {
    return { approved: 0, skipped: true };
  }

  const stuck = await findStuckManagerStageRegularizations(pool, maxDays);
  let approved = 0;
  for (const row of stuck) {
    try {
      const res = await autoApproveManagerStage(pool, tenantDb, row, settings);
      if (res) approved += 1;
    } catch (err) {
      const logger = require('../../../utils/logger');
      logger.error(`[attendanceAutoApprove] id=${row.id} failed`, err);
    }
  }
  return { approved, skipped: false };
}

module.exports = {
  findStalePendingRegularizations,
  autoRejectRecord,
  processAutoRejections,
  findStuckManagerStageRegularizations,
  autoApproveManagerStage,
  processAutoApprovals,
};
