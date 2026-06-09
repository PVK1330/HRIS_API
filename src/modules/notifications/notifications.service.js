'use strict';
// Merge conflicts resolved — push + sendSystemNotification with recipientId support

const repo = require('./notifications.repository');
const { getTenantPool, superAdminPool } = require('../../config/db');
const { runTenantMigrations } = require('../tenant/tenant.service');
const { sendMail } = require('../../utils/mail');
const { getIo } = require('../../socket');
const logger = require('../../utils/logger');

const _migrationCache = new Map();
async function ensureMigrated(dbName) {
  if (_migrationCache.has(dbName)) return _migrationCache.get(dbName);
  const p = runTenantMigrations(dbName).catch(() => null);
  _migrationCache.set(dbName, p);
  return p;
}

async function pushNotification(tenant, {
  employeeId,
  forAdmin,
  recipientId,
  recipientRole,
  title,
  message,
  type,
  priority,
  ticketId,
  entityType,
  entityId,
  redirectUrl,
}) {
  const dbName = tenant?.dbName || tenant?.db_name;
  if (!dbName) return null;
  await ensureMigrated(dbName);
  const pool = await getTenantPool(dbName);

  const notificationRecord = await repo.create(pool, {
    employeeId,
    forAdmin,
    recipientId,
    recipientRole,
    title,
    message,
    type,
    priority,
    ticketId,
    entityType,
    entityId,
    redirectUrl,
  });

  logger.info('[notifications] notification created', { id: notificationRecord?.id });

  try {
    const io = getIo();
    if (io && notificationRecord) {
      if (employeeId) {
        logger.debug('[notifications] socket emit to employee', { employeeId });
        io.to(`user:${employeeId}`).emit('new_notification', notificationRecord);
      } else if (forAdmin) {
        logger.debug('[notifications] socket emit to admin tenant');
        io.to(`tenant:${dbName}`).emit('new_notification', notificationRecord);
      }
    }
  } catch (err) {
    logger.error('[notifications] failed to emit push notification', { err: err.message });
  }

  return notificationRecord;
}

async function sendSystemNotification(tenant, {
  employeeId,
  forAdmin,
  recipientId,
  recipientRole,
  title,
  message,
  emailMessage,
  type,
  priority,
  sendEmail = true,
  emailSubject = null,
  entityType,
  entityId,
  redirectUrl,
}) {
  let notificationRecord = null;
  try {
    notificationRecord = await pushNotification(tenant, {
      employeeId,
      forAdmin,
      recipientId,
      recipientRole,
      title,
      message,
      type,
      priority,
      ticketId: null,
      entityType,
      entityId,
      redirectUrl,
    });
  } catch (err) {
    logger.error('[notifications] failed to log push notification', { err: err.message });
  }

  if (sendEmail) {
    let emailTo = null;
    const dbName = tenant?.dbName || tenant?.db_name;
    if (forAdmin) {
      emailTo = tenant?.admin_email || null;
    } else {
      const targetEmployeeId = employeeId || recipientId;
      if (targetEmployeeId && dbName) {
        try {
          const pool = await getTenantPool(dbName);
          const { rows } = await pool.query(
            `SELECT work_email, personal_email FROM employees WHERE id = $1 AND deleted_at IS NULL`,
            [targetEmployeeId],
          );
          emailTo =
            String(rows[0]?.work_email || '').trim() ||
            String(rows[0]?.personal_email || '').trim() ||
            null;
        } catch (err) {
          logger.error('[notifications] failed to query employee email', { targetEmployeeId, err: err.message });
        }
      }
    }

    if (emailTo) {
      try {
        const subject = emailSubject || `HRIS - ${title}`;
        const bodyContent = emailMessage || message;
        const html = `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 12px; background-color: #ffffff;">
            <div style="text-align: center; margin-bottom: 24px;">
              <div style="display: inline-block; padding: 12px; background-color: #0F766E; border-radius: 8px; color: #ffffff; font-weight: bold; font-size: 20px;">HRIS</div>
            </div>
            <h2 style="color: #111827; font-size: 20px; font-weight: bold; margin-bottom: 16px;">${title}</h2>
            <p style="color: #4b5563; font-size: 16px; line-height: 1.5; margin-bottom: 24px;">${bodyContent}</p>
            <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
            <p style="color: #9ca3af; font-size: 12px; text-align: center;">This is an automated notification from your HRIS Portal. Please do not reply directly to this email.</p>
          </div>
        `;

        await sendMail({
          to: emailTo,
          subject,
          text: `${title}\n\n${bodyContent}`,
          html,
        });
      } catch (err) {
        logger.error('[notifications] failed to send email notification', { err: err.message });
      }
    }
  }

  return notificationRecord;
}

async function listNotifications(user, tenant = null) {
  const dbName = user?.db_name || tenant?.dbName || tenant?.db_name;
  const isSuperadmin = user?.role === 'superadmin';

  if (isSuperadmin && !dbName) {
    try {
      const { rows: tenants } = await superAdminPool.query(
        `SELECT id, db_name FROM public.tenants WHERE status = 'active' ORDER BY created_at DESC`,
      );

      if (!tenants.length) return [];

      let allNotifications = [];

      for (const tenantRecord of tenants) {
        try {
          await ensureMigrated(tenantRecord.db_name);
          const pool = await getTenantPool(tenantRecord.db_name);
          const notifications = await repo.listForUser(pool, user);

          const notificationsWithTenant = notifications.map((n) => ({
            ...n,
            _tenantId: tenantRecord.id,
            _tenantDbName: tenantRecord.db_name,
          }));

          allNotifications = allNotifications.concat(notificationsWithTenant);
        } catch (err) {
          logger.error('[notifications] error fetching tenant notifications', { tenantDbName: tenantRecord.db_name, err: err.message });
        }
      }

      allNotifications.sort(
        (a, b) => new Date(b.created_at || b.createdAt) - new Date(a.created_at || a.createdAt),
      );

      return allNotifications;
    } catch (err) {
      logger.error('[notifications] error fetching superadmin notifications', { err: err.message });
      return [];
    }
  }

  if (!dbName) return [];

  await ensureMigrated(dbName);
  const pool = await getTenantPool(dbName);
  return repo.listForUser(pool, user);
}

async function countUnread(user, tenant = null) {
  const list = await listNotifications(user, tenant);
  if (!Array.isArray(list)) return 0;
  return list.filter((n) => !(n.read || n.isRead)).length;
}

async function readNotification(user, id, tenant = null) {
  const dbName = user?.db_name || tenant?.dbName || tenant?.db_name;
  if (!dbName) return null;
  await ensureMigrated(dbName);
  const pool = await getTenantPool(dbName);
  return repo.markAsRead(pool, id, user);
}

async function readAllNotifications(user, tenant = null) {
  const dbName = user?.db_name || tenant?.dbName || tenant?.db_name;
  if (!dbName) return true;
  await ensureMigrated(dbName);
  const pool = await getTenantPool(dbName);
  return repo.markAllAsRead(pool, user);
}

async function deleteNotification(user, id, tenant = null) {
  const dbName = user?.db_name || tenant?.dbName || tenant?.db_name;
  if (!dbName) return true;
  await ensureMigrated(dbName);
  const pool = await getTenantPool(dbName);
  return repo.remove(pool, id);
}

module.exports = {
  pushNotification,
  sendSystemNotification,
  listNotifications,
  countUnread,
  readNotification,
  readAllNotifications,
  deleteNotification,
};
