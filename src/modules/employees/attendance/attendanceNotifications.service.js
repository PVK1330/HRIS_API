'use strict';

const {
  pushNotification,
  sendSystemNotification,
} = require('../../notifications/notifications.service');

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

function tenantCtx(tenantDb) {
  return { db_name: tenantDb, dbName: tenantDb };
}

async function notifyEmployee(pool, tenantDb, {
  employeeId,
  type,
  title,
  message,
  entityId,
  redirectUrl,
  sendEmail = false,
  emailSubject,
}) {
  const tenant = tenantCtx(tenantDb);
  const payload = {
    employeeId,
    recipientId: employeeId,
    recipientRole: 'employee',
    type,
    title,
    message,
    entityType: 'attendance',
    entityId: entityId ? String(entityId) : null,
    redirectUrl: redirectUrl || '/employee/attendance',
  };

  if (sendEmail) {
    await sendSystemNotification(tenant, {
      ...payload,
      emailMessage: message,
      emailSubject: emailSubject || title,
      sendEmail: true,
    });
    return;
  }

  await pushNotification(tenant, payload);
}

async function notifyManagersForRegularization(pool, tenantDb, record) {
  const { rows } = await pool.query(
    `SELECT e.reporting_manager_id AS manager_id
     FROM employees e WHERE e.id = $1`,
    [record.employee_id],
  );
  const mgrId = rows[0]?.manager_id;
  if (!mgrId) return;
  await pushNotification(tenantCtx(tenantDb), {
    recipientId: mgrId,
    recipientRole: 'employee',
    type: TYPES.REG_SUBMITTED,
    title: 'Regularization pending',
    message: `${record.employee_name || 'Employee'} submitted attendance regularization for ${record.date}`,
    entityType: 'attendance',
    entityId: String(record.id),
    redirectUrl: '/admin/attendance/regularizations',
  });
}

module.exports = {
  TYPES,
  notifyEmployee,
  notifyManagersForRegularization,
};
