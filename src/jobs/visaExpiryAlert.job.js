'use strict';

const cron = require('node-cron');
const logger = require('../utils/logger');
const { sendMail } = require('../utils/mail');
const { superAdminPool, getTenantPool } = require('../config/db');
const visaRecordsService = require('../modules/visa-records/visa-records.service');

const HR_ADMIN_EMAIL = (process.env.HR_ADMIN_EMAIL || '').trim();
const ALERT_DAYS_AHEAD = Math.min(365, Math.max(1, parseInt(process.env.ALERT_DAYS_AHEAD || '60', 10) || 60));
const PORTAL_BASE = (process.env.PORTAL_URL || process.env.FRONTEND_URL || 'http://localhost:5173').replace(
  /\/$/,
  '',
);

function daysFromToday(dateVal) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateVal);
  d.setHours(0, 0, 0, 0);
  return Math.ceil((d.getTime() - today.getTime()) / 86400000);
}

function formatDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d).slice(0, 10);
  return dt.toISOString().slice(0, 10);
}

function buildRecipients(workEmail) {
  const set = new Set();
  if (workEmail && String(workEmail).includes('@')) set.add(String(workEmail).trim());
  if (HR_ADMIN_EMAIL && HR_ADMIN_EMAIL.includes('@')) set.add(HR_ADMIN_EMAIL);
  return Array.from(set);
}

function alsoExpiringBlock(row) {
  const lines = [];
  const ppt = row.passport_expiry_date;
  if (ppt && daysFromToday(ppt) < 90) {
    lines.push(
      `<tr><td style="padding:4px 0;font-weight:600;">Passport</td><td>${formatDate(ppt)}</td></tr>`,
    );
  }
  const eid = row.emirates_id_expiry;
  if (eid && daysFromToday(eid) < 90) {
    lines.push(
      `<tr><td style="padding:4px 0;font-weight:600;">Emirates ID</td><td>${formatDate(eid)}</td></tr>`,
    );
  }
  if (!lines.length) return '';
  return `
    <p style="margin:16px 0 8px;font-weight:700;">Also expiring:</p>
    <table style="border-collapse:collapse;">${lines.join('')}</table>
  `;
}

function expiringHtml(row, daysLeft) {
  const link = `${PORTAL_BASE}/admin/visa`;
  return `
  <div style="font-family:Arial,sans-serif;max-width:560px;border:1px solid #e2e8f0;border-radius:8px;padding:20px;">
    <h2 style="margin:0 0 12px;color:#b45309;">Visa Expiry Alert</h2>
    <table style="width:100%;font-size:14px;line-height:1.6;">
      <tr><td style="color:#64748b;width:120px;">Employee</td><td><strong>${row.full_name}</strong> (${row.emp_id || '—'})</td></tr>
      <tr><td style="color:#64748b;">Visa Type</td><td>${row.visa_type_name || '—'}</td></tr>
      <tr><td style="color:#64748b;">Expiry</td><td style="color:#b91c1c;font-weight:700;">${formatDate(row.visa_expiry_date)}</td></tr>
      <tr><td style="color:#64748b;">Days Left</td><td><strong>${daysLeft}</strong> days</td></tr>
      <tr><td style="color:#64748b;">Sponsoring</td><td>${row.sponsoring_entity || '—'}</td></tr>
    </table>
    ${alsoExpiringBlock(row)}
    <p style="margin:20px 0 0;">
      <a href="${link}" style="display:inline-block;background:#0F766E;color:#fff;text-decoration:none;padding:10px 18px;border-radius:4px;font-weight:600;">View Employee Record →</a>
    </p>
    <p style="margin:16px 0 0;color:#64748b;font-size:13px;">Please take necessary renewal action.</p>
  </div>`;
}

function expiredHtml(row) {
  const daysPast = -daysFromToday(row.visa_expiry_date);
  const link = `${PORTAL_BASE}/admin/visa`;
  return `
  <div style="font-family:Arial,sans-serif;max-width:560px;border:1px solid #fecaca;border-radius:8px;padding:20px;background:#fff5f5;">
    <h2 style="margin:0 0 12px;color:#b91c1c;">VISA EXPIRED</h2>
    <table style="width:100%;font-size:14px;line-height:1.6;">
      <tr><td style="color:#64748b;width:120px;">Employee</td><td><strong>${row.full_name}</strong> (${row.emp_id || '—'})</td></tr>
      <tr><td style="color:#64748b;">Visa Type</td><td>${row.visa_type_name || '—'}</td></tr>
      <tr><td style="color:#64748b;">Expiry</td><td style="color:#b91c1c;font-weight:700;">${formatDate(row.visa_expiry_date)}</td></tr>
      <tr><td style="color:#64748b;">Days Overdue</td><td><strong>${daysPast}</strong> days</td></tr>
      <tr><td style="color:#64748b;">Sponsoring</td><td>${row.sponsoring_entity || '—'}</td></tr>
    </table>
    ${alsoExpiringBlock(row)}
    <p style="margin:20px 0 0;">
      <a href="${link}" style="display:inline-block;background:#0F766E;color:#fff;text-decoration:none;padding:10px 18px;border-radius:4px;font-weight:600;">View Employee Record →</a>
    </p>
    <p style="margin:16px 0 0;color:#64748b;font-size:13px;">Please take necessary renewal action.</p>
  </div>`;
}

async function processTenant(tenant) {
  const pool = await getTenantPool(tenant.db_name);
  const expiring = await visaRecordsService.findExpiringSoonForTenant(pool, ALERT_DAYS_AHEAD);
  for (const row of expiring) {
    const daysLeft = daysFromToday(row.visa_expiry_date);
    const to = buildRecipients(row.work_email);
    if (!to.length) {
      logger.warn(`[visaExpiryAlert] skip record ${row.id}: no recipients`);
      continue;
    }
    try {
      await sendMail({
        to: to.join(', '),
        subject: `Visa Expiry Alert — ${row.full_name} (${row.emp_id || ''})`,
        html: expiringHtml(row, daysLeft),
        text: `Visa expiring for ${row.full_name}. Days left: ${daysLeft}. Expiry: ${formatDate(row.visa_expiry_date)}.`,
      });
      await visaRecordsService.logAlert(pool, {
        employeeId: row.employee_id,
        visaRecordId: row.id,
        alertType: 'visa_expiring',
        daysRemaining: daysLeft,
      });
      logger.info(`[visaExpiryAlert] EXPIRING sent tenant=${tenant.db_name} record=${row.id}`);
    } catch (e) {
      logger.error(`[visaExpiryAlert] send fail tenant=${tenant.db_name} row=${row.id}`, e);
    }
  }

  const expired = await visaRecordsService.findExpiredForTenant(pool);
  for (const row of expired) {
    const daysLeft = daysFromToday(row.visa_expiry_date);
    const to = buildRecipients(row.work_email);
    if (!to.length) {
      logger.warn(`[visaExpiryAlert] skip expired ${row.id}: no recipients`);
      continue;
    }
    try {
      await sendMail({
        to: to.join(', '),
        subject: `VISA EXPIRED — ${row.full_name} (${row.emp_id || ''})`,
        html: expiredHtml(row),
        text: `Visa EXPIRED for ${row.full_name}. Expiry was ${formatDate(row.visa_expiry_date)}.`,
      });
      await visaRecordsService.logAlert(pool, {
        employeeId: row.employee_id,
        visaRecordId: row.id,
        alertType: 'visa_expired',
        daysRemaining: daysLeft,
      });
      logger.info(`[visaExpiryAlert] EXPIRED sent tenant=${tenant.db_name} record=${row.id}`);
    } catch (e) {
      logger.error(`[visaExpiryAlert] expired send fail tenant=${tenant.db_name} row=${row.id}`, e);
    }
  }
}

async function runVisaExpiryAlertJob() {
  logger.info('[visaExpiryAlert] Job run start');
  const { rows } = await superAdminPool.query(
    `SELECT id, name, db_name FROM public.tenants WHERE status = 'active' ORDER BY id ASC`,
  );
  for (const t of rows) {
    try {
      await processTenant(t);
    } catch (e) {
      logger.error(`[visaExpiryAlert] tenant ${t.db_name} failed`, e);
    }
  }
  logger.info('[visaExpiryAlert] Job run complete');
}

let scheduled = null;

function startVisaExpiryAlertCron() {
  if (scheduled) return scheduled;
  const opts = {};
  if (process.env.TZ) opts.timezone = process.env.TZ;
  scheduled = cron.schedule(
    '0 8 * * *',
    () => {
      runVisaExpiryAlertJob().catch((err) => logger.error('[visaExpiryAlert] cron error', err));
    },
    opts,
  );
  logger.info('[visaExpiryAlert] Cron registered (0 8 * * *)');
  return scheduled;
}

module.exports = { startVisaExpiryAlertCron, runVisaExpiryAlertJob };
