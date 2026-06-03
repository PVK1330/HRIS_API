'use strict';

const { sendSystemNotification } = require('../notifications/notifications.service');
const historyRepo = require('./holidayNotificationHistory.repository');

const EVENT_TYPES = {
  CREATED: historyRepo.NOTIFICATION_TYPES.CREATED,
  UPDATED: historyRepo.NOTIFICATION_TYPES.UPDATED,
  DELETED: historyRepo.NOTIFICATION_TYPES.DELETED,
  REMINDER: historyRepo.NOTIFICATION_TYPES.REMINDER,
};

/**
 * Resolve recipients by RBAC permission buckets (no hardcoded user ids).
 */
async function resolveRecipients(pool) {
  const { rows } = await pool.query(
    `SELECT DISTINCT e.id AS employee_id, e.work_email,
            ARRAY_AGG(DISTINCT p.key) AS permission_keys
     FROM employees e
     JOIN rbac_roles r ON r.id = e.rbac_role_id
     JOIN rbac_role_permissions rp ON rp.role_id = r.id
     JOIN rbac_permissions p ON p.id = rp.permission_id
     WHERE e.deleted_at IS NULL
       AND e.employment_status IN ('Active', 'Probation')
       AND p.key IN (
         'attendance.view.own',
         'attendance.view.team',
         'attendance.view.all',
         'attendance.approve',
         'attendance.manage',
         'attendance.settings.manage',
         'attendance'
       )
     GROUP BY e.id, e.work_email`,
  );

  const buckets = {
    employee: [],
    teamLead: [],
    manager: [],
    hr: [],
    admin: [],
  };

  for (const row of rows) {
    const keys = new Set(row.permission_keys || []);
    const entry = { employeeId: row.employee_id, workEmail: row.work_email };
    buckets.employee.push(entry);
    if (keys.has('attendance.approve')) {
      buckets.teamLead.push(entry);
      buckets.manager.push(entry);
    }
    if (keys.has('attendance.view.all')) buckets.hr.push(entry);
    if (keys.has('attendance.manage') || keys.has('attendance.settings.manage')) {
      buckets.admin.push(entry);
    }
  }

  return buckets;
}

async function notifyHolidayEvent(pool, tenantDb, {
  eventType,
  title,
  message,
  entityId,
  holidayId,
}) {
  const hid = holidayId ?? entityId;
  if (!hid) {
    return { notified: 0, skipped: 0, reason: 'missing_holiday_id' };
  }

  const buckets = await resolveRecipients(pool);
  const seen = new Set();
  const all = [
    ...buckets.employee,
    ...buckets.teamLead,
    ...buckets.manager,
    ...buckets.hr,
    ...buckets.admin,
  ];

  let notified = 0;
  let skipped = 0;

  for (const r of all) {
    if (!r.employeeId || seen.has(r.employeeId)) continue;
    seen.add(r.employeeId);

    const already = await historyRepo.wasAlreadySent(pool, {
      holidayId: hid,
      employeeId: r.employeeId,
      notificationType: eventType,
    });
    if (already) {
      skipped += 1;
      continue;
    }

    await sendSystemNotification(
      { db_name: tenantDb, dbName: tenantDb },
      {
        employeeId: r.employeeId,
        recipientId: r.employeeId,
        recipientRole: 'employee',
        title,
        message,
        emailMessage: message,
        emailSubject: title,
        type: eventType,
        sendEmail: true,
        entityType: 'holiday',
        entityId: String(hid),
        redirectUrl: '/admin/settings?tab=attendance',
      },
    );

    await historyRepo.recordSent(pool, {
      holidayId: hid,
      employeeId: r.employeeId,
      notificationType: eventType,
    });
    notified += 1;
  }

  return { notified, skipped, totalRecipients: seen.size };
}

module.exports = {
  EVENT_TYPES,
  resolveRecipients,
  notifyHolidayEvent,
};
