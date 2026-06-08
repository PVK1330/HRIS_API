'use strict';

const { sendSystemNotification } = require('../../notifications/notifications.service');

const TYPES = {
  CHECK_IN: 'attendance.check_in',
  CHECK_OUT: 'attendance.check_out',
  LATE: 'attendance.late',
  MISSING: 'attendance.missing',
  REG_SUBMITTED: 'attendance.regularization.submitted',
  REG_FORWARDED: 'attendance.regularization.forwarded',
  REG_APPROVED: 'attendance.regularization.approved',
  REG_REJECTED: 'attendance.regularization.rejected',
  REG_AUTO_REJECTED: 'attendance.regularization.auto_rejected',
  OVERRIDE: 'attendance.override',
  ABSENT: 'attendance.absent',
  OT_REQUESTED: 'attendance.overtime.requested',
  OT_APPROVED: 'attendance.overtime.approved',
  OT_REJECTED: 'attendance.overtime.rejected',
  OT_FORWARDED: 'attendance.overtime.forwarded',
  HOLIDAY_CREATED: 'attendance.holiday.created',
  HOLIDAY_UPDATED: 'attendance.holiday.updated',
  HOLIDAY_DELETED: 'attendance.holiday.deleted',
  HOLIDAY_REMINDER: 'attendance.holiday.reminder'
};

function tenantCtx(tenantDb) {
  return { db_name: tenantDb, dbName: tenantDb };
}

const historyRepo = require('../../notifications/notificationHistory.repository');

// Helper to prevent duplicate notifications (global notification_history + legacy attendance table)
async function checkAndLogHistory(pool, eventType, entityId, employeeId) {
  const hash = historyRepo.buildHash({
    notificationType: eventType,
    entityType: 'attendance',
    entityId: String(entityId),
    recipientId: employeeId,
    sentVia: 'in_app',
    title: eventType,
  });
  if (await historyRepo.wasAlreadySent(pool, hash)) {
    return false;
  }
  await historyRepo.recordSent(pool, {
    tenantId: null,
    notificationType: eventType,
    entityType: 'attendance',
    entityId: String(entityId),
    recipientId: employeeId,
    sentVia: 'in_app',
    hash,
  });
  try {
    await pool.query(
      `INSERT INTO attendance_notification_history (event_type, entity_id, employee_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [eventType, String(entityId), employeeId],
    );
  } catch (_) { /* legacy table optional */ }
  return true;
}

// Helper to fetch template or use fallback
async function getTemplate(pool, type, fallbackSubject, fallbackBody, variables = {}) {
  let subject = fallbackSubject;
  let body = fallbackBody;
  
  try {
    const { rows } = await pool.query(
      `SELECT subject, body FROM notification_templates WHERE type = $1 AND status = 'active' LIMIT 1`,
      [type]
    );
    if (rows.length > 0) {
      subject = rows[0].subject;
      body = rows[0].body;
    }
  } catch (err) {
    // Ignore error if table doesn't exist yet or query fails, use fallback
  }

  // Replace variables like {{name}}
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`{{${key}}}`, 'g');
    subject = subject.replace(regex, value || '');
    body = body.replace(regex, value || '');
  }

  return { subject, body };
}

async function getEmployeeDetails(pool, employeeId) {
  const { rows } = await pool.query(
    `SELECT e.reporting_manager_id AS manager_id, e.first_name || ' ' || e.last_name AS name FROM employees e WHERE e.id = $1`,
    [employeeId]
  );
  return rows[0] || {};
}

async function getHrAuditGroup(pool) {
  const { rows } = await pool.query(
    `SELECT id FROM employees WHERE role IN ('admin', 'hr_admin', 'superadmin') AND deleted_at IS NULL`
  );
  return rows.map(r => r.id);
}

// The manager of the employee's department (for forwarding approved overtime onward).
async function getDepartmentManagerId(pool, employeeId) {
  const { rows } = await pool.query(
    `SELECT d.manager_id
     FROM employees e
     JOIN departments d ON d.name = e.department AND d.is_active = true
     WHERE e.id = $1
     LIMIT 1`,
    [employeeId]
  );
  return rows[0]?.manager_id || null;
}

// 1. Employee Check In
async function notifyCheckIn(pool, tenantDb, { employeeId, time, date, entityId }) {
  if (!(await checkAndLogHistory(pool, TYPES.CHECK_IN, entityId, employeeId))) return;
  const tenant = tenantCtx(tenantDb);
  const { manager_id: mgrId, name: employeeName } = await getEmployeeDetails(pool, employeeId);
  
  const empTpl = await getTemplate(pool, TYPES.CHECK_IN, 'Check-in Successful', `You have successfully checked in at ${time}.`, { time, date, name: employeeName });
  await sendSystemNotification(tenant, {
    employeeId, recipientId: employeeId, recipientRole: 'employee', type: TYPES.CHECK_IN,
    title: empTpl.subject, message: empTpl.body, entityType: 'attendance', entityId: String(entityId), sendEmail: true
  });

  if (mgrId) {
    const mgrTpl = await getTemplate(pool, TYPES.CHECK_IN + '.manager', `${employeeName} Checked In`, `${employeeName} checked in at ${time}.`, { time, date, name: employeeName });
    await sendSystemNotification(tenant, {
      recipientId: mgrId, recipientRole: 'employee', type: TYPES.CHECK_IN,
      title: mgrTpl.subject, message: mgrTpl.body, entityType: 'attendance', entityId: String(entityId), sendEmail: true
    });
  }
}

// 2. Employee Check Out
async function notifyCheckOut(pool, tenantDb, { employeeId, time, date, entityId }) {
  if (!(await checkAndLogHistory(pool, TYPES.CHECK_OUT, entityId, employeeId))) return;
  const tenant = tenantCtx(tenantDb);
  const { name: employeeName } = await getEmployeeDetails(pool, employeeId);
  
  const empTpl = await getTemplate(pool, TYPES.CHECK_OUT, 'Check-out Successful', `You have successfully checked out at ${time}.`, { time, date, name: employeeName });
  await sendSystemNotification(tenant, {
    employeeId, recipientId: employeeId, recipientRole: 'employee', type: TYPES.CHECK_OUT,
    title: empTpl.subject, message: empTpl.body, entityType: 'attendance', entityId: String(entityId), sendEmail: true
  });
}

// 3. Late Arrival
async function notifyLateArrival(pool, tenantDb, { employeeId, time, date, entityId }) {
  if (!(await checkAndLogHistory(pool, TYPES.LATE, entityId, employeeId))) return;
  const tenant = tenantCtx(tenantDb);
  const { manager_id: mgrId, name: employeeName } = await getEmployeeDetails(pool, employeeId);
  
  const empTpl = await getTemplate(pool, TYPES.LATE, 'Late Arrival', `You have been marked late for your check-in at ${time}.`, { time, date, name: employeeName });
  await sendSystemNotification(tenant, {
    employeeId, recipientId: employeeId, recipientRole: 'employee', type: TYPES.LATE,
    title: empTpl.subject, message: empTpl.body, entityType: 'attendance', entityId: String(entityId), sendEmail: true
  });

  if (mgrId) {
    const mgrTpl = await getTemplate(pool, TYPES.LATE + '.manager', `Late Arrival: ${employeeName}`, `${employeeName} checked in late at ${time}.`, { time, date, name: employeeName });
    await sendSystemNotification(tenant, {
      recipientId: mgrId, recipientRole: 'employee', type: TYPES.LATE,
      title: mgrTpl.subject, message: mgrTpl.body, entityType: 'attendance', entityId: String(entityId), sendEmail: true
    });
  }
}

// 4. Missing Checkout
async function notifyMissingCheckout(pool, tenantDb, { employeeId, date, entityId }) {
  if (!(await checkAndLogHistory(pool, TYPES.MISSING, date, employeeId))) return;
  const tenant = tenantCtx(tenantDb);
  const { manager_id: mgrId, name: employeeName } = await getEmployeeDetails(pool, employeeId);
  
  const empTpl = await getTemplate(pool, TYPES.MISSING, 'Missing Check-out', `You missed your check-out for ${date}. Please regularize.`, { date, name: employeeName });
  await sendSystemNotification(tenant, {
    employeeId, recipientId: employeeId, recipientRole: 'employee', type: TYPES.MISSING,
    title: empTpl.subject, message: empTpl.body, entityType: 'attendance', entityId: String(entityId), sendEmail: true
  });

  if (mgrId) {
    const mgrTpl = await getTemplate(pool, TYPES.MISSING + '.manager', `Missing Check-out: ${employeeName}`, `${employeeName} missed their check-out on ${date}.`, { date, name: employeeName });
    await sendSystemNotification(tenant, {
      recipientId: mgrId, recipientRole: 'employee', type: TYPES.MISSING,
      title: mgrTpl.subject, message: mgrTpl.body, entityType: 'attendance', entityId: String(entityId), sendEmail: true
    });
  }
}

// 5. Regularization Submitted
async function notifyRegSubmitted(pool, tenantDb, { employeeId, date, entityId, approverId }) {
  if (!(await checkAndLogHistory(pool, TYPES.REG_SUBMITTED, entityId, employeeId))) return;
  const tenant = tenantCtx(tenantDb);
  const { manager_id: defaultMgrId, name: employeeName } = await getEmployeeDetails(pool, employeeId);
  
  const mgrId = approverId || defaultMgrId;
  if (mgrId) {
    const mgrTpl = await getTemplate(pool, TYPES.REG_SUBMITTED, 'Regularization Request Submitted', `${employeeName} submitted an attendance regularization request for ${date}.`, { date, name: employeeName });
    await sendSystemNotification(tenant, {
      recipientId: mgrId, recipientRole: 'employee', type: TYPES.REG_SUBMITTED,
      title: mgrTpl.subject, message: mgrTpl.body, entityType: 'attendance', entityId: String(entityId), sendEmail: true, redirectUrl: '/admin/attendance/regularizations'
    });
  }
}

// A stage approved → regularization advances. Notify the NEXT approver
// ('department' → dept head, 'hr' → HR group) so it doesn't stall mid-workflow.
async function notifyRegForwarded(pool, tenantDb, { employeeId, date, entityId, nextStage }) {
  const tenant = tenantCtx(tenantDb);
  const { name: employeeName } = await getEmployeeDetails(pool, employeeId);
  const recipients = new Set();
  let stageLabel = '';
  if (nextStage === 'department') {
    const deptManagerId = await getDepartmentManagerId(pool, employeeId);
    if (deptManagerId) recipients.add(deptManagerId);
    stageLabel = 'Department Head';
  } else if (nextStage === 'hr') {
    (await getHrAuditGroup(pool)).forEach((id) => recipients.add(id));
    stageLabel = 'HR';
  }
  if (!recipients.size) return;

  const tpl = await getTemplate(
    pool, TYPES.REG_FORWARDED,
    `Regularization Awaiting ${stageLabel} Approval: ${employeeName}`,
    `${employeeName}'s attendance regularization for ${date} was approved at the previous stage and now awaits ${stageLabel} approval.`,
    { date, name: employeeName, stage: stageLabel },
  );
  for (const rid of recipients) {
    if (!(await checkAndLogHistory(pool, TYPES.REG_FORWARDED, entityId, rid))) continue;
    await sendSystemNotification(tenant, {
      recipientId: rid, recipientRole: 'employee', type: TYPES.REG_FORWARDED,
      title: tpl.subject, message: tpl.body, entityType: 'attendance', entityId: String(entityId),
      sendEmail: true, redirectUrl: '/admin/attendance/regularizations',
    });
  }
}

// 6. Regularization Approved
async function notifyRegApproved(pool, tenantDb, { employeeId, date, entityId }) {
  if (!(await checkAndLogHistory(pool, TYPES.REG_APPROVED, entityId, employeeId))) return;
  const tenant = tenantCtx(tenantDb);
  
  const empTpl = await getTemplate(pool, TYPES.REG_APPROVED, 'Regularization Approved', `Your attendance regularization for ${date} has been approved.`, { date });
  await sendSystemNotification(tenant, {
    employeeId, recipientId: employeeId, recipientRole: 'employee', type: TYPES.REG_APPROVED,
    title: empTpl.subject, message: empTpl.body, entityType: 'attendance', entityId: String(entityId), sendEmail: true
  });
}

// 7. Regularization Rejected
async function notifyRegRejected(pool, tenantDb, { employeeId, date, entityId, reason }) {
  if (!(await checkAndLogHistory(pool, TYPES.REG_REJECTED, entityId, employeeId))) return;
  const tenant = tenantCtx(tenantDb);
  
  const empTpl = await getTemplate(pool, TYPES.REG_REJECTED, 'Regularization Rejected', `Your attendance regularization for ${date} has been rejected. Reason: ${reason || 'N/A'}.`, { date, reason });
  await sendSystemNotification(tenant, {
    employeeId, recipientId: employeeId, recipientRole: 'employee', type: TYPES.REG_REJECTED,
    title: empTpl.subject, message: empTpl.body, entityType: 'attendance', entityId: String(entityId), sendEmail: true
  });
}

// 8. Regularization Auto Rejected
async function notifyRegAutoRejected(pool, tenantDb, { employeeId, date, entityId }) {
  if (!(await checkAndLogHistory(pool, TYPES.REG_AUTO_REJECTED, entityId, employeeId))) return;
  const tenant = tenantCtx(tenantDb);
  const { name: employeeName } = await getEmployeeDetails(pool, employeeId);
  
  const empTpl = await getTemplate(pool, TYPES.REG_AUTO_REJECTED, 'Regularization Auto-Rejected', `Your regularization request for ${date} was auto-rejected due to SLA expiry.`, { date });
  await sendSystemNotification(tenant, {
    employeeId, recipientId: employeeId, recipientRole: 'employee', type: TYPES.REG_AUTO_REJECTED,
    title: empTpl.subject, message: empTpl.body, entityType: 'attendance', entityId: String(entityId), sendEmail: true
  });

  const hrIds = await getHrAuditGroup(pool);
  const hrTpl = await getTemplate(pool, TYPES.REG_AUTO_REJECTED + '.hr', `Regularization Auto-Rejected: ${employeeName}`, `A regularization request by ${employeeName} for ${date} expired and was auto-rejected.`, { date, name: employeeName });
  
  for (const hrId of hrIds) {
    await sendSystemNotification(tenant, {
      recipientId: hrId, recipientRole: 'employee', type: TYPES.REG_AUTO_REJECTED,
      title: hrTpl.subject, message: hrTpl.body, entityType: 'attendance', entityId: String(entityId), sendEmail: true
    });
  }
}

// 9. Attendance Override
async function notifyOverride(pool, tenantDb, { employeeId, date, entityId, overriderName }) {
  if (!(await checkAndLogHistory(pool, TYPES.OVERRIDE, entityId + '-' + Date.now(), employeeId))) return;
  const tenant = tenantCtx(tenantDb);
  const { name: employeeName } = await getEmployeeDetails(pool, employeeId);
  
  const empTpl = await getTemplate(pool, TYPES.OVERRIDE, 'Attendance Overridden', `Your attendance record for ${date} has been overridden by ${overriderName}.`, { date, overriderName });
  await sendSystemNotification(tenant, {
    employeeId, recipientId: employeeId, recipientRole: 'employee', type: TYPES.OVERRIDE,
    title: empTpl.subject, message: empTpl.body, entityType: 'attendance', entityId: String(entityId), sendEmail: true
  });

  const hrIds = await getHrAuditGroup(pool);
  const hrTpl = await getTemplate(pool, TYPES.OVERRIDE + '.hr', 'Attendance Override Audit', `Attendance for ${employeeName} on ${date} was overridden by ${overriderName}.`, { date, name: employeeName, overriderName });
  
  for (const hrId of hrIds) {
    if (hrId !== employeeId) {
      await sendSystemNotification(tenant, {
        recipientId: hrId, recipientRole: 'employee', type: TYPES.OVERRIDE,
        title: hrTpl.subject, message: hrTpl.body, entityType: 'attendance', entityId: String(entityId), sendEmail: true
      });
    }
  }
}

// 10. Marked Absent by Cron
async function notifyAbsent(pool, tenantDb, { employeeId, date }) {
  if (!(await checkAndLogHistory(pool, TYPES.ABSENT, date, employeeId))) return;
  const tenant = tenantCtx(tenantDb);
  const { manager_id: mgrId, name: employeeName } = await getEmployeeDetails(pool, employeeId);
  
  const empTpl = await getTemplate(pool, TYPES.ABSENT, 'Marked Absent', `You have been marked absent for ${date}.`, { date });
  await sendSystemNotification(tenant, {
    employeeId, recipientId: employeeId, recipientRole: 'employee', type: TYPES.ABSENT,
    title: empTpl.subject, message: empTpl.body, entityType: 'attendance', sendEmail: true
  });

  if (mgrId) {
    const mgrTpl = await getTemplate(pool, TYPES.ABSENT + '.manager', `Absent Alert: ${employeeName}`, `${employeeName} has been marked absent for ${date}.`, { date, name: employeeName });
    await sendSystemNotification(tenant, {
      recipientId: mgrId, recipientRole: 'employee', type: TYPES.ABSENT,
      title: mgrTpl.subject, message: mgrTpl.body, entityType: 'attendance', sendEmail: true
    });
  }
}

// 11a. Overtime Approval Requested → notify the reporting manager.
async function notifyOtRequested(pool, tenantDb, { employeeId, date, entityId, hours }) {
  const tenant = tenantCtx(tenantDb);
  const { manager_id: mgrId, name: employeeName } = await getEmployeeDetails(pool, employeeId);
  if (!mgrId) return; // no manager configured — nothing to route to
  if (!(await checkAndLogHistory(pool, TYPES.OT_REQUESTED, entityId, mgrId))) return;

  const tpl = await getTemplate(
    pool, TYPES.OT_REQUESTED,
    `Overtime Approval Required: ${employeeName}`,
    `${employeeName} recorded ${hours} hour(s) of overtime on ${date} and needs your approval.`,
    { date, hours, name: employeeName },
  );
  await sendSystemNotification(tenant, {
    recipientId: mgrId, recipientRole: 'employee', type: TYPES.OT_REQUESTED,
    title: tpl.subject, message: tpl.body, entityType: 'attendance', entityId: String(entityId),
    sendEmail: true, redirectUrl: '/admin/attendance/overtime',
  });
}

// 11b. Overtime Approved → notify the employee.
async function notifyOtApproved(pool, tenantDb, { employeeId, date, entityId, hours }) {
  if (!(await checkAndLogHistory(pool, TYPES.OT_APPROVED, entityId, employeeId))) return;
  const tenant = tenantCtx(tenantDb);

  const empTpl = await getTemplate(pool, TYPES.OT_APPROVED, 'Overtime Approved', `Your overtime of ${hours} hours for ${date} has been approved.`, { date, hours });
  await sendSystemNotification(tenant, {
    employeeId, recipientId: employeeId, recipientRole: 'employee', type: TYPES.OT_APPROVED,
    title: empTpl.subject, message: empTpl.body, entityType: 'attendance', entityId: String(entityId), sendEmail: true
  });
}

// 11c. Overtime Rejected → notify the employee.
async function notifyOtRejected(pool, tenantDb, { employeeId, date, entityId, hours, reason }) {
  if (!(await checkAndLogHistory(pool, TYPES.OT_REJECTED, entityId, employeeId))) return;
  const tenant = tenantCtx(tenantDb);

  const empTpl = await getTemplate(
    pool, TYPES.OT_REJECTED, 'Overtime Rejected',
    `Your overtime of ${hours} hours for ${date} was rejected.${reason ? ` Reason: ${reason}` : ''}`,
    { date, hours, reason },
  );
  await sendSystemNotification(tenant, {
    employeeId, recipientId: employeeId, recipientRole: 'employee', type: TYPES.OT_REJECTED,
    title: empTpl.subject, message: empTpl.body, entityType: 'attendance', entityId: String(entityId), sendEmail: true
  });
}

// 11d. Overtime forwarded to the department for processing (after manager approval).
async function notifyOtForwardedToDept(pool, tenantDb, { employeeId, date, entityId, hours }) {
  const tenant = tenantCtx(tenantDb);
  const deptManagerId = await getDepartmentManagerId(pool, employeeId);
  const { name: employeeName } = await getEmployeeDetails(pool, employeeId);
  const recipients = new Set();
  if (deptManagerId) recipients.add(deptManagerId);
  // Fall back to HR/admin so approved overtime is never lost when no dept manager is set.
  if (!recipients.size) (await getHrAuditGroup(pool)).forEach(id => recipients.add(id));
  if (!recipients.size) return;

  const tpl = await getTemplate(
    pool, TYPES.OT_FORWARDED,
    `Approved Overtime for Processing: ${employeeName}`,
    `${employeeName}'s overtime of ${hours} hour(s) on ${date} was approved and is forwarded for processing.`,
    { date, hours, name: employeeName },
  );
  for (const rid of recipients) {
    if (!(await checkAndLogHistory(pool, TYPES.OT_FORWARDED, entityId, rid))) continue;
    await sendSystemNotification(tenant, {
      recipientId: rid, recipientRole: 'employee', type: TYPES.OT_FORWARDED,
      title: tpl.subject, message: tpl.body, entityType: 'attendance', entityId: String(entityId),
      sendEmail: true, redirectUrl: '/admin/attendance/overtime',
    });
  }
}

// Dept Head approved → overtime now awaits HR. Notify the HR/admin group so the
// request doesn't stall at the final stage.
async function notifyOtForwardedToHr(pool, tenantDb, { employeeId, date, entityId, hours }) {
  const tenant = tenantCtx(tenantDb);
  const { name: employeeName } = await getEmployeeDetails(pool, employeeId);
  const recipients = new Set(await getHrAuditGroup(pool));
  if (!recipients.size) return;

  const tpl = await getTemplate(
    pool, TYPES.OT_FORWARDED,
    `Overtime Awaiting HR Approval: ${employeeName}`,
    `${employeeName}'s overtime of ${hours} hour(s) on ${date} was approved by the department head and now awaits HR approval.`,
    { date, hours, name: employeeName },
  );
  for (const rid of recipients) {
    if (!(await checkAndLogHistory(pool, TYPES.OT_FORWARDED, entityId, rid))) continue;
    await sendSystemNotification(tenant, {
      recipientId: rid, recipientRole: 'employee', type: TYPES.OT_FORWARDED,
      title: tpl.subject, message: tpl.body, entityType: 'attendance', entityId: String(entityId),
      sendEmail: true, redirectUrl: '/admin/attendance/overtime',
    });
  }
}

// 12-15. Holidays
async function notifyHolidays(pool, tenantDb, type, { holidayId, name, date, affectedEmployees }) {
  const tenant = tenantCtx(tenantDb);
  let defaultSubject = 'Holiday Notification';
  let defaultBody = `Holiday: ${name} on ${date}.`;
  
  if (type === TYPES.HOLIDAY_CREATED) defaultSubject = `New Holiday Announced: ${name}`;
  if (type === TYPES.HOLIDAY_UPDATED) defaultSubject = `Holiday Updated: ${name}`;
  if (type === TYPES.HOLIDAY_DELETED) defaultSubject = `Holiday Cancelled: ${name}`;
  if (type === TYPES.HOLIDAY_REMINDER) defaultSubject = `Upcoming Holiday Reminder: ${name}`;

  for (const empId of affectedEmployees) {
    if (!(await checkAndLogHistory(pool, type, holidayId, empId))) continue;
    const empTpl = await getTemplate(pool, type, defaultSubject, defaultBody, { name, date });
    await sendSystemNotification(tenant, {
      employeeId: empId, recipientId: empId, recipientRole: 'employee', type,
      title: empTpl.subject, message: empTpl.body, entityType: 'holiday', entityId: String(holidayId), sendEmail: true
    });
  }
}

module.exports = {
  TYPES,
  notifyCheckIn,
  notifyCheckOut,
  notifyLateArrival,
  notifyMissingCheckout,
  notifyRegSubmitted,
  notifyRegForwarded,
  notifyRegApproved,
  notifyRegRejected,
  notifyRegAutoRejected,
  notifyOverride,
  notifyAbsent,
  notifyOtRequested,
  notifyOtApproved,
  notifyOtRejected,
  notifyOtForwardedToDept,
  notifyOtForwardedToHr,
  notifyHolidays
};
