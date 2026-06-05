'use strict';

const fs = require('fs').promises;
const path = require('path');
const repo = require('./announcements.repository');
const { pushNotification } = require('../notifications/notifications.service');
const { sendMail } = require('../../utils/mail');
const { ensureMessagingEmployeeId } = require('../messages/messagingIdentity');
const logger = require('../../utils/logger');

function stripHtml(text) {
  return String(text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function resolveStatusFromInput(data) {
  const explicit = data.status;
  const scheduleRaw = data.schedule_date || data.scheduleDate;
  const scheduleDate = scheduleRaw ? new Date(scheduleRaw) : null;

  if (explicit === 'Draft') return 'Draft';
  if (scheduleDate && !Number.isNaN(scheduleDate.getTime()) && scheduleDate.getTime() > Date.now()) {
    return 'Scheduled';
  }
  if (explicit === 'Scheduled' && scheduleDate && scheduleDate.getTime() > Date.now()) {
    return 'Scheduled';
  }
  if (explicit === 'Published' || explicit === 'Scheduled') return 'Published';
  return explicit || 'Draft';
}

function normalizeScheduleDate(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

async function resolvePostedByEmployeeId(pool, user) {
  if (!user) return null;
  try {
    return await ensureMessagingEmployeeId(pool, user);
  } catch {
    return null;
  }
}

function employeeMatchesVisibility(announcement, employee) {
  const visibility = announcement.visibility || 'All Employees';
  if (visibility === 'All Employees' || visibility === 'all') return true;

  if (visibility.startsWith('[')) {
    try {
      const ids = JSON.parse(visibility).map(Number);
      return ids.includes(Number(employee.id));
    } catch {
      return false;
    }
  }

  const dept = String(employee.department || '').trim();
  return dept && dept.toLowerCase() === String(visibility).trim().toLowerCase();
}

async function sendAnnouncementEmails(pool, announcement, recipients) {
  if (!recipients.length) return;

  let companyName = 'HRIS Platform';
  try {
    const { rows } = await pool.query(`SELECT company_name FROM tenant_admin_settings LIMIT 1`);
    if (rows[0]?.company_name) companyName = rows[0].company_name;
  } catch {
    /* optional table */
  }

  const templatePath = path.join(__dirname, '../../templates/emails/announcement.html');
  const templateHtml = await fs.readFile(templatePath, 'utf8');
  const html = templateHtml
    .replace(/{{companyName}}/g, companyName)
    .replace(/{{title}}/g, announcement.title || '')
    .replace(/{{category}}/g, announcement.category || '')
    .replace(/{{content}}/g, announcement.content || '');

  const emails = [...new Set(recipients.map((r) => r.email).filter(Boolean))];
  if (!emails.length) return;

  for (const to of emails) {
    try {
      await sendMail({
        to,
        subject: `New Announcement: ${announcement.title}`,
        html,
        text: `${announcement.title}\n\n${stripHtml(announcement.content)}`,
      });
    } catch (err) {
      logger.error(`[announcements] email failed for ${to}:`, err.message);
    }
  }
}

async function sendInAppNotifications(tenant, announcement, recipients) {
  const preview = stripHtml(announcement.content).slice(0, 200);
  const message = preview.length < stripHtml(announcement.content).length
    ? `${preview}…`
    : preview;

  for (const recipient of recipients) {
    try {
      await pushNotification(
        { dbName: tenant.dbName, admin_email: tenant.adminEmail },
        {
          employeeId: recipient.id,
          forAdmin: false,
          title: announcement.title || 'New announcement',
          message,
          type: 'announcement',
        },
      );
    } catch (err) {
      logger.error(`[announcements] in-app notify failed for employee ${recipient.id}:`, err.message);
    }
  }

  try {
    const { getIo } = require('../../socket');
    const io = getIo();
    if (io) {
      for (const recipient of recipients) {
        io.to(`user:${recipient.id}`).emit('new_notification', {
          id: `announcement-${announcement.id}`,
          type: 'announcement',
        });
      }
    }
  } catch {
    /* non-critical */
  }
}

async function dispatchAnnouncement(tenant, pool, announcement) {
  if (!announcement || announcement.dispatched_at) return announcement;

  const channels = announcement.dispatch_channels || 'Both';
  const sendInApp = channels === 'In App' || channels === 'Both';
  const sendEmail = channels === 'Email' || channels === 'Both';

  const recipients = await repo.getRecipients(pool, announcement.visibility);
  if (!recipients.length) {
    logger.warn(`[announcements] no recipients for announcement ${announcement.id}`);
  }

  if (sendInApp && recipients.length) {
    await sendInAppNotifications(tenant, announcement, recipients);
  }
  if (sendEmail && recipients.length) {
    await sendAnnouncementEmails(pool, announcement, recipients);
  }

  return repo.markDispatched(pool, announcement.id);
}

async function listAnnouncements(pool, user) {
  const isAdmin = ['admin', 'hr_admin', 'hr_executive', 'manager'].includes(user?.role);
  if (isAdmin) {
    return repo.getAll(pool);
  }

  const employeeId = await resolvePostedByEmployeeId(pool, user);
  if (!employeeId) {
    return repo.getPublishedForAll(pool);
  }

  const { rows } = await pool.query(
    `SELECT id, department FROM employees WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [employeeId],
  );
  const employee = rows[0] || { id: employeeId, department: user.department };
  const published = await repo.getPublishedForAll(pool);
  return published.filter((a) => employeeMatchesVisibility(a, employee));
}

async function createAnnouncement(tenant, pool, user, data) {
  const status = resolveStatusFromInput(data);
  const scheduleRaw = normalizeScheduleDate(data.schedule_date ?? data.scheduleDate);
  const postedBy = await resolvePostedByEmployeeId(pool, user);

  let announcement = await repo.create(pool, {
    ...data,
    status,
    schedule_date: scheduleRaw || null,
    posted_by: postedBy,
  });

  if (status === 'Published') {
    announcement = await dispatchAnnouncement(tenant, pool, announcement);
  }

  return announcement;
}

async function updateAnnouncement(tenant, pool, user, id, data) {
  const existing = await repo.getAnnouncementById(pool, id);
  if (!existing) return null;

  const status = data.status != null ? resolveStatusFromInput({ ...data, status: data.status }) : existing.status;
  const hasScheduleField = Object.prototype.hasOwnProperty.call(data, 'schedule_date')
    || Object.prototype.hasOwnProperty.call(data, 'scheduleDate');
  const scheduleRaw = hasScheduleField
    ? normalizeScheduleDate(data.schedule_date ?? data.scheduleDate)
    : existing.schedule_date;

  let announcement = await repo.update(pool, id, {
    ...data,
    status,
    schedule_date: scheduleRaw,
  });

  if (!announcement) return null;

  if (status === 'Scheduled' || status === 'Draft') {
    announcement = await repo.resetDispatch(pool, id);
  }

  if (status === 'Published' && !announcement.dispatched_at) {
    announcement = await dispatchAnnouncement(tenant, pool, announcement);
  }

  return announcement;
}

async function processScheduledForTenant(tenant, pool) {
  const due = await repo.findDueScheduled(pool);
  let count = 0;

  for (const row of due) {
    const published = await repo.update(pool, row.id, {
      status: 'Published',
      schedule_date: row.schedule_date,
    });
    if (published && !published.dispatched_at) {
      await dispatchAnnouncement(tenant, pool, published);
      count += 1;
    }
  }

  return count;
}

module.exports = {
  listAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  dispatchAnnouncement,
  processScheduledForTenant,
  resolveStatusFromInput,
  employeeMatchesVisibility,
};
