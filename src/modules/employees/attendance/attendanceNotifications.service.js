'use strict';

const { pushNotification } = require('../../notifications/notifications.service');

const TYPES = {
  CHECK_IN: 'attendance.check_in',
  CHECK_OUT: 'attendance.check_out',
  LATE: 'attendance.late',
  MISSING: 'attendance.missing',
  REG_SUBMITTED: 'attendance.regularization.submitted',
  REG_APPROVED: 'attendance.regularization.approved',
  REG_REJECTED: 'attendance.regularization.rejected',
  OT_APPROVED: 'attendance.overtime.approved',
};

async function notifyEmployee(pool, tenantDb, {
  employeeId,
  type,
  title,
  message,
  entityId,
  redirectUrl,
}) {
  await pushNotification(pool, {
    recipientId: employeeId,
    recipientRole: 'employee',
    type,
    title,
    message,
    entityType: 'attendance',
    entityId: entityId ? String(entityId) : null,
    redirectUrl: redirectUrl || '/employee/attendance',
    tenantDb,
  });
}

async function notifyManagersForRegularization(pool, tenantDb, record) {
  const { rows } = await pool.query(
    `SELECT e.reporting_manager_id AS manager_id
     FROM employees e WHERE e.id = $1`,
    [record.employee_id],
  );
  const mgrId = rows[0]?.manager_id;
  if (!mgrId) return;
  await pushNotification(pool, {
    recipientId: mgrId,
    recipientRole: 'employee',
    type: TYPES.REG_SUBMITTED,
    title: 'Regularization pending',
    message: `${record.employee_name || 'Employee'} submitted attendance regularization for ${record.date}`,
    entityType: 'attendance',
    entityId: String(record.id),
    redirectUrl: '/admin/attendance/regularizations',
    tenantDb,
  });
}

module.exports = {
  TYPES,
  notifyEmployee,
  notifyManagersForRegularization,
};
