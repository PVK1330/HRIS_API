'use strict';

const cron = require('node-cron');
const logger = require('../utils/logger');
const { superAdminPool } = require('../config/db');
const { sendMail } = require('../utils/mail');

const DAY_MS = 24 * 60 * 60 * 1000;

function appBaseUrl() {
  return (
    process.env.FRONTEND_URL ||
    process.env.ADMIN_URL?.replace(/\/superadmin.*$/, '') ||
    'http://localhost:5173'
  ).replace(/\/$/, '');
}

function reminderHtml({ name, daysLeft, expired, planName }) {
  const payUrl = `${appBaseUrl()}/admin/payment`;
  const heading = expired
    ? 'Your free trial has ended'
    : `Your free trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
  const body = expired
    ? 'To keep using your HRIS workspace, please upgrade to a paid plan. Until payment is completed, access to your modules is paused.'
    : 'Upgrade now to avoid any interruption to your HRIS workspace when the trial ends.';
  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
      <h2 style="margin-bottom: 8px;">${heading}</h2>
      <p>Hi ${name || 'there'},</p>
      <p>${body}</p>
      ${planName ? `<p style="color:#6b7280;">Plan: <strong>${planName}</strong></p>` : ''}
      <p style="margin: 24px 0;">
        <a href="${payUrl}" style="background:#0F766E;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">
          Upgrade / Make payment
        </a>
      </p>
      <p style="color:#9ca3af;font-size:12px;">If you have already paid, please ignore this message.</p>
    </div>
  `;
}

/**
 * Daily scan of trial tenants:
 *  - 3 days / 1 day before expiry → send a reminder.
 *  - On/after expiry → send a final "trial ended" email and flip status to 'past_due'
 *    (which keeps them gated and stops daily re-emailing).
 */
async function runTrialReminders(now = new Date()) {
  const { rows: tenants } = await superAdminPool.query(
    `SELECT t.id, t.name, t.admin_email, t.admin_name, t.trial_ends_at, t.plan_id,
            sp.plan_name
       FROM public.tenants t
       LEFT JOIN public.subscription_plans sp ON sp.id::text = t.plan_id::text
      WHERE t.status = 'active'
        AND LOWER(COALESCE(t.subscription_status, 'trial')) = 'trial'
        AND t.trial_ends_at IS NOT NULL
        AND t.admin_email IS NOT NULL`,
  );

  let sent = 0;
  for (const t of tenants) {
    try {
      const end = new Date(t.trial_ends_at).getTime();
      const daysLeft = Math.ceil((end - now.getTime()) / DAY_MS);
      const expired = now.getTime() >= end;

      if (expired) {
        await superAdminPool.query(
          `UPDATE public.tenants SET subscription_status = 'past_due' WHERE id = $1`,
          [t.id],
        );
        await sendMail({
          to: t.admin_email,
          subject: 'Your HRIS free trial has ended — upgrade to continue',
          html: reminderHtml({ name: t.admin_name, expired: true, planName: t.plan_name }),
        });
        sent += 1;
      } else if (daysLeft === 3 || daysLeft === 1) {
        await sendMail({
          to: t.admin_email,
          subject: `Your HRIS free trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
          html: reminderHtml({ name: t.admin_name, daysLeft, expired: false, planName: t.plan_name }),
        });
        sent += 1;
      }
    } catch (e) {
      logger.error(`[trialExpiryReminder] tenant=${t.id} failed`, e);
    }
  }
  logger.info(`[trialExpiryReminder] run complete — ${sent} email(s) across ${tenants.length} trial tenant(s)`);
  return { scanned: tenants.length, sent };
}

function startTrialExpiryReminderCron() {
  if (process.env.DISABLE_TRIAL_REMINDER_CRON === 'true') {
    logger.debug('Trial expiry reminder cron disabled');
    return null;
  }
  const opts = {};
  if (process.env.TZ) opts.timezone = process.env.TZ;
  // 09:00 every day.
  const scheduled = cron.schedule('0 9 * * *', () => {
    runTrialReminders().catch((e) => logger.error('[trialExpiryReminder] run failed', e));
  }, opts);
  logger.info('[trialExpiryReminder] scheduled daily at 09:00');
  return scheduled;
}

module.exports = { startTrialExpiryReminderCron, runTrialReminders };
