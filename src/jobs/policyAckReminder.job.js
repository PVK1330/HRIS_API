'use strict';

/**
 * P3 — Pending policy-acknowledgement reminders.
 *
 * Mirrors trialExpiryReminder.job.js: a daily cron that scans active tenants and,
 * per tenant, nudges employees who have been required to acknowledge a published
 * policy for longer than a threshold and haven't been reminded within the cadence
 * window. Acknowledgement status stays version-computed; policy_ack_reminders is
 * only the timing clock.
 *
 * Config (env):
 *   POLICY_ACK_REMINDER_THRESHOLD_DAYS  default 3 — pending-age before first remind
 *   POLICY_ACK_REMINDER_CADENCE_DAYS    default 3 — min gap between reminders
 *   DISABLE_POLICY_ACK_REMINDER_CRON    set 'true' to disable
 */

const nodeCron = require('node-cron');
const logger = require('../utils/logger');
const { superAdminPool, getTenantPool } = require('../config/db');
const { runTenantMigrations } = require('../modules/tenant/tenant.service');
const repo = require('../modules/policies/policies.repository');
const { pushNotification } = require('../modules/notifications/notifications.service');
const workflowAudit = require('../modules/workflow/workflowAudit.service');

const DAY_MS = 24 * 60 * 60 * 1000;

function thresholdMsFromEnv() {
  const d = Number(process.env.POLICY_ACK_REMINDER_THRESHOLD_DAYS);
  return (Number.isFinite(d) && d >= 0 ? d : 3) * DAY_MS;
}
function cadenceMsFromEnv() {
  const d = Number(process.env.POLICY_ACK_REMINDER_CADENCE_DAYS);
  return (Number.isFinite(d) && d >= 0 ? d : 3) * DAY_MS;
}
function reviewLeadDaysFromEnv() {
  const d = Number(process.env.POLICY_REVIEW_REMINDER_LEAD_DAYS);
  return Number.isFinite(d) && d >= 0 ? d : 7;
}
function reviewCadenceMsFromEnv() {
  const d = Number(process.env.POLICY_REVIEW_REMINDER_CADENCE_DAYS);
  return (Number.isFinite(d) && d >= 0 ? d : 7) * DAY_MS;
}

// Apply pending tenant migrations at most once per process per tenant.
const _migCache = new Map();
async function ensureMigrated(dbName) {
  if (_migCache.has(dbName)) return _migCache.get(dbName);
  const p = runTenantMigrations(dbName).catch(() => null);
  _migCache.set(dbName, p);
  return p;
}

async function remindForTenant(dbName, { thresholdMs, cadenceMs, policyIds }) {
  await ensureMigrated(dbName);
  const pool = await getTenantPool(dbName);
  const tenant = { dbName };

  let policies = await repo.findActivePoliciesForReminders(pool);
  // Optional narrowing (used by tests to bound blast radius to a single policy).
  if (Array.isArray(policyIds)) {
    const want = new Set(policyIds.map(Number));
    policies = policies.filter((p) => want.has(Number(p.id)));
  }
  let sent = 0;

  for (const policy of policies) {
    // Self-heal: enrol anyone currently pending who isn't tracked yet (new rows
    // start the clock at NOW(), so they are not reminded until a threshold later).
    await repo.ensureReminderRowsForPolicy(pool, policy);

    const due = await repo.findEmployeesDueForReminder(pool, policy, { thresholdMs, cadenceMs });
    for (const emp of due) {
      try {
        await pushNotification(tenant, {
          employeeId: emp.id,
          forAdmin: false,
          title: 'Reminder: policy acknowledgement pending',
          message: `Reminder — please review and acknowledge: ${policy.title}`,
          type: 'policy',
          entityType: 'policy',
          entityId: policy.id,
          redirectUrl: '/admin/my-policies',
        });
        await repo.markReminderSent(pool, policy.id, emp.id);
        await workflowAudit.log(tenant, {
          module: 'policies',
          action: 'reminder',
          entityType: 'policy',
          entityId: policy.id,
          actorEmployeeId: null,
          actorName: 'system',
          detail: { employeeId: emp.id, contentVersion: policy.contentVersion },
        });
        sent += 1;
      } catch (err) {
        logger.warn(`[policyAckReminder] notify failed (tenant=${dbName}, policy=${policy.id}, emp=${emp.id})`, { err: err.message });
      }
    }
  }

  return { policies: policies.length, sent };
}

/**
 * @param {object} [opts]
 * @param {number} [opts.thresholdMs] override pending-age threshold
 * @param {number} [opts.cadenceMs]   override reminder cadence
 * @param {string[]} [opts.dbNames]   limit to specific tenant DBs (tests); default all active
 */
async function runPolicyAckReminders(opts = {}) {
  const thresholdMs = opts.thresholdMs != null ? opts.thresholdMs : thresholdMsFromEnv();
  const cadenceMs = opts.cadenceMs != null ? opts.cadenceMs : cadenceMsFromEnv();

  let dbNames = opts.dbNames;
  if (!Array.isArray(dbNames)) {
    const { rows } = await superAdminPool.query(
      `SELECT db_name FROM public.tenants WHERE status = 'active'`,
    );
    dbNames = rows.map((r) => r.db_name);
  }

  let totalSent = 0;
  for (const dbName of dbNames) {
    try {
      const res = await remindForTenant(dbName, { thresholdMs, cadenceMs, policyIds: opts.policyIds });
      totalSent += res.sent;
    } catch (e) {
      logger.error(`[policyAckReminder] tenant=${dbName} failed`, e);
    }
  }
  logger.info(`[policyAckReminder] run complete — ${totalSent} reminder(s) across ${dbNames.length} tenant(s)`);
  return { tenants: dbNames.length, sent: totalSent };
}

/* -------------------- P4: review-date reminders -------------------- */

async function reviewRemindForTenant(dbName, { leadDays, cadenceMs, policyIds }) {
  await ensureMigrated(dbName);
  const pool = await getTenantPool(dbName);
  const tenant = { dbName };

  let policies = await repo.findPoliciesDueForReview(pool, { leadDays, cadenceMs });
  if (Array.isArray(policyIds)) {
    const want = new Set(policyIds.map(Number));
    policies = policies.filter((p) => want.has(Number(p.id)));
  }

  let sent = 0;
  for (const policy of policies) {
    const due = policy.reviewDate ? new Date(policy.reviewDate).toISOString().slice(0, 10) : '';
    try {
      // Notify org admins / policy-manage holders (single for_admin notification).
      await pushNotification(tenant, {
        forAdmin: true,
        title: 'Policy review due',
        message: `"${policy.title}" is due for review${due ? ` (review date ${due})` : ''}.`,
        type: 'policy',
        entityType: 'policy',
        entityId: policy.id,
        redirectUrl: '/admin/policies',
      });
      await repo.markReviewReminded(pool, policy.id);
      await workflowAudit.log(tenant, {
        module: 'policies',
        action: 'review_reminder',
        entityType: 'policy',
        entityId: policy.id,
        actorEmployeeId: null,
        actorName: 'system',
        detail: { reviewDate: due },
      });
      sent += 1;
    } catch (err) {
      logger.warn(`[policyReviewReminder] notify failed (tenant=${dbName}, policy=${policy.id})`, { err: err.message });
    }
  }
  return { policies: policies.length, sent };
}

/**
 * @param {object} [opts] thresholdMs/cadenceMs-style overrides: leadDays, cadenceMs,
 *   dbNames (limit tenants), policyIds (limit policies — tests).
 */
async function runPolicyReviewReminders(opts = {}) {
  const leadDays = opts.leadDays != null ? opts.leadDays : reviewLeadDaysFromEnv();
  const cadenceMs = opts.cadenceMs != null ? opts.cadenceMs : reviewCadenceMsFromEnv();

  let dbNames = opts.dbNames;
  if (!Array.isArray(dbNames)) {
    const { rows } = await superAdminPool.query(
      `SELECT db_name FROM public.tenants WHERE status = 'active'`,
    );
    dbNames = rows.map((r) => r.db_name);
  }

  let totalSent = 0;
  for (const dbName of dbNames) {
    try {
      const res = await reviewRemindForTenant(dbName, { leadDays, cadenceMs, policyIds: opts.policyIds });
      totalSent += res.sent;
    } catch (e) {
      logger.error(`[policyReviewReminder] tenant=${dbName} failed`, e);
    }
  }
  logger.info(`[policyReviewReminder] run complete — ${totalSent} review reminder(s) across ${dbNames.length} tenant(s)`);
  return { tenants: dbNames.length, sent: totalSent };
}

function startPolicyAckReminderCron() {
  if (process.env.DISABLE_POLICY_ACK_REMINDER_CRON === 'true') {
    logger.debug('Policy acknowledgement reminder cron disabled');
    return null;
  }
  const opts = {};
  if (process.env.TZ) opts.timezone = process.env.TZ;
  // 10:00 every day — pending-ack reminders (P3) + review-date reminders (P4).
  const scheduled = nodeCron.schedule('0 10 * * *', () => {
    runPolicyAckReminders().catch((e) => logger.error('[policyAckReminder] run failed', e));
    runPolicyReviewReminders().catch((e) => logger.error('[policyReviewReminder] run failed', e));
  }, opts);
  logger.info('[policyAckReminder] scheduled daily at 10:00 (ack + review reminders)');
  return scheduled;
}

module.exports = { startPolicyAckReminderCron, runPolicyAckReminders, runPolicyReviewReminders };
