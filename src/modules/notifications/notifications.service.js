'use strict';

const repo = require('./notifications.repository');
const { getTenantPool, superAdminPool } = require('../../config/db');
const { runTenantMigrations } = require('../tenant/tenant.service');
const { sendMail } = require('../../utils/mail');
const { getIo } = require('../../socket');

const _migrationCache = new Map();
async function ensureMigrated(dbName) {
  if (_migrationCache.has(dbName)) return _migrationCache.get(dbName);
  const p = runTenantMigrations(dbName).catch(() => null);
  _migrationCache.set(dbName, p);
  return p;
}

async function pushNotification(tenant, { employeeId, forAdmin, title, message, type, ticketId, entityType, entityId, redirectUrl }) {
  const dbName = tenant?.dbName || tenant?.db_name;
  if (!dbName) return null;
  await ensureMigrated(dbName);
  const pool = await getTenantPool(dbName);
  const notificationRecord = await repo.create(pool, { employeeId, forAdmin, title, message, type, ticketId, entityType, entityId, redirectUrl });
  
  try {
    const io = getIo();
    if (io && notificationRecord) {
      if (employeeId) {
        io.to(`user:${employeeId}`).emit('new_notification', notificationRecord);
      } else if (forAdmin) {
        io.to(`tenant:${dbName}`).emit('new_notification', notificationRecord); // Broadcast to admins
      }
    }
  } catch (err) {
    console.error('Failed to emit push notification centrally:', err);
  }
  
  return notificationRecord;
}

async function sendSystemNotification(tenant, { employeeId, forAdmin, title, message, emailMessage, type, sendEmail = true, emailSubject = null, entityType, entityId, redirectUrl }) {
  // 1. Instantly deliver central in-app push notification
  let notificationRecord = null;
  try {
    notificationRecord = await pushNotification(tenant, { employeeId, forAdmin, title, message, type, ticketId: null, entityType, entityId, redirectUrl });
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

async function listNotifications(user, tenant = null) {
  const dbName = user?.db_name || tenant?.dbName || tenant?.db_name;
  const isSuperadmin = user?.role === 'superadmin';
  
  
  
  // Superadmin without tenant context: fetch from ALL tenants
  if (isSuperadmin && !dbName) {
    try {
      
      
      // Get all tenant databases
      const { rows: tenants } = await superAdminPool.query(
        `SELECT id, db_name FROM public.tenants WHERE status = 'active' ORDER BY created_at DESC`
      );
      
      
      
      if (!tenants.length) {
        
        return [];
      }
      
      // Fetch notifications from all tenant databases
      let allNotifications = [];
      
      for (const tenantRecord of tenants) {
        try {
          await ensureMigrated(tenantRecord.db_name);
          const pool = await getTenantPool(tenantRecord.db_name);
          const notifications = await repo.listForUser(pool, user);
          
          
          
          // Add tenant info to each notification
          const notificationsWithTenant = notifications.map(n => ({
            ...n,
            _tenantId: tenantRecord.id,
            _tenantDbName: tenantRecord.db_name,
          }));
          
          allNotifications = allNotifications.concat(notificationsWithTenant);
        } catch (err) {
          console.error('[NOTIFICATIONS SERVICE] Error fetching from tenant:', {
            tenantId: tenantRecord.id,
            dbName: tenantRecord.db_name,
            error: err.message,
          });
          // Continue with other tenants
        }
      }
      
      // Sort by created_at descending (newest first)
      allNotifications.sort((a, b) => new Date(b.created_at || b.createdAt) - new Date(a.created_at || a.createdAt));
      
      
      
      return allNotifications;
    } catch (err) {
      console.error('[NOTIFICATIONS SERVICE] Error fetching superadmin notifications from all tenants:', err);
      return [];
    }
  }
  
  // Regular user or user with tenant context
  if (!dbName) {
    
    return [];
  }
  
  await ensureMigrated(dbName);
  const pool = await getTenantPool(dbName);
  const notifications = await repo.listForUser(pool, user);
  
  
  
  return notifications;
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
  readNotification,
  readAllNotifications,
  deleteNotification
};
