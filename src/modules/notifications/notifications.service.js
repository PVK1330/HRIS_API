'use strict';

const repo = require('./notifications.repository');
const { getTenantPool } = require('../../config/db');
const { runTenantMigrations } = require('../tenant/tenant.service');
const { sendMail } = require('../../utils/mail');

const _migrationCache = new Map();
async function ensureMigrated(dbName) {
  if (_migrationCache.has(dbName)) return _migrationCache.get(dbName);
  const p = runTenantMigrations(dbName).catch(() => null);
  _migrationCache.set(dbName, p);
  return p;
}

async function pushNotification(tenant, { employeeId, forAdmin, title, message, type, ticketId }) {
  if (!tenant?.dbName) return null;
  await ensureMigrated(tenant.dbName);
  const pool = await getTenantPool(tenant.dbName);
  return repo.create(pool, { employeeId, forAdmin, title, message, type, ticketId });
}

async function sendSystemNotification(tenant, { employeeId, forAdmin, title, message, emailMessage, type, sendEmail = true, emailSubject = null }) {
  // 1. Instantly deliver central in-app push notification
  let notificationRecord = null;
    try {
      notificationRecord = await pushNotification(tenant, { employeeId, forAdmin, title, message, type, ticketId: null });
  } catch (err) {
    console.error('Failed to log push notification centrally:', err);
  }

  // 2. Automated email delivery if requested
  if (sendEmail) {
    let emailTo = null;
    if (forAdmin) {
      emailTo = tenant.admin_email;
    } else if (employeeId) {
      try {
        const pool = await getTenantPool(tenant.dbName);
        const { rows } = await pool.query(
          `SELECT work_email FROM employees WHERE id = $1 AND deleted_at IS NULL`,
          [employeeId]
        );
        if (rows[0]?.work_email) {
          emailTo = rows[0].work_email;
        }
      } catch (err) {
        console.error(`Failed to query employee ${employeeId} email for notification:`, err);
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
        console.error(`Failed to send email notification to ${emailTo}:`, err);
      }
    }
  }

  return notificationRecord;
}

async function listNotifications(user) {
  if (!user?.db_name) return [];
  await ensureMigrated(user.db_name);
  const pool = await getTenantPool(user.db_name);
  return repo.listForUser(pool, user);
}

async function readNotification(user, id) {
  if (!user?.db_name) return null;
  await ensureMigrated(user.db_name);
  const pool = await getTenantPool(user.db_name);
  return repo.markAsRead(pool, id, user);
}

async function readAllNotifications(user) {
  if (!user?.db_name) return true;
  await ensureMigrated(user.db_name);
  const pool = await getTenantPool(user.db_name);
  return repo.markAllAsRead(pool, user);
}

async function deleteNotification(user, id) {
  if (!user?.db_name) return true;
  await ensureMigrated(user.db_name);
  const pool = await getTenantPool(user.db_name);
  return repo.remove(pool, id);
}

module.exports = {
  pushNotification,
  sendSystemNotification,
  listNotifications,
  readNotification,
  readAllNotifications,
  deleteNotification
};
