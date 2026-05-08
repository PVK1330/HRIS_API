'use strict';

const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const repository = require('./notificationSettings.repository');

const EVENT_KEYS = {
  leave_approval: 'Leave Approval',
  document_approval: 'Document Approval',
  visa_expiry: 'Visa Expiry',
  policy_assignment: 'Policy Assignment',
  performance_review_due: 'Performance Review Due',
  asset_issue_return: 'Asset Issue / Return',
  attendance_reminders: 'Attendance Reminders',
};

const EVENT_KEY_LIST = Object.keys(EVENT_KEYS);

function mapToResponse(row) {
  if (!row) return null;
  const ev = row.event_notifications;
  return {
    channels: {
      emailNotifications: row.email_notifications,
      smsNotifications: row.sms_notifications,
      inAppAlerts: row.in_app_alerts,
    },
    eventNotifications: typeof ev === 'string' ? JSON.parse(ev) : ev,
    updatedAt: row.updated_at,
  };
}

function assertBool(name, v) {
  if (v === undefined || v === null) return;
  if (typeof v !== 'boolean') {
    throw new ApiError(400, `${name} must be a boolean`);
  }
}

function assertChannelBooleans(fields) {
  assertBool('email_notifications', fields.email_notifications);
  assertBool('sms_notifications', fields.sms_notifications);
  assertBool('in_app_alerts', fields.in_app_alerts);
}

function isPlainObject(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

function validateEventChannelMatrix(obj) {
  if (!isPlainObject(obj)) {
    throw new ApiError(400, 'event_notifications must be an object');
  }
  for (const key of Object.keys(obj)) {
    if (!EVENT_KEY_LIST.includes(key)) {
      throw new ApiError(400, `Unknown event key: ${key}`);
    }
    const cell = obj[key];
    if (!isPlainObject(cell)) {
      throw new ApiError(400, `event_notifications.${key} must be an object`);
    }
    for (const ch of ['email', 'sms', 'in_app']) {
      if (typeof cell[ch] !== 'boolean') {
        throw new ApiError(400, `event_notifications.${key}.${ch} must be a boolean`);
      }
    }
  }
}

/**
 * Merge nested camelCase `channels` + `eventNotifications` onto snake_case patch keys.
 */
function mergeNotificationFlat(body) {
  if (!body || typeof body !== 'object') return {};

  const out = {};

  if (body.email_notifications !== undefined) out.email_notifications = body.email_notifications;
  if (body.sms_notifications !== undefined) out.sms_notifications = body.sms_notifications;
  if (body.in_app_alerts !== undefined) out.in_app_alerts = body.in_app_alerts;

  const ch = body.channels;
  if (ch && typeof ch === 'object') {
    if (ch.emailNotifications !== undefined) out.email_notifications = ch.emailNotifications;
    if (ch.smsNotifications !== undefined) out.sms_notifications = ch.smsNotifications;
    if (ch.inAppAlerts !== undefined) out.in_app_alerts = ch.inAppAlerts;
  }

  if (body.event_notifications !== undefined) {
    out.event_notifications = body.event_notifications;
  }
  if (body.eventNotifications !== undefined) {
    out.event_notifications = body.eventNotifications;
  }

  return out;
}

async function getNotificationSettings(dbName) {
  const pool = getTenantPool(dbName);
  let row = await repository.getSettings(pool);
  if (!row) {
    row = await repository.seedDefault(pool);
  }
  return mapToResponse(row);
}

async function updateNotificationSettings(dbName, body) {
  const flat = mergeNotificationFlat(body);
  assertChannelBooleans(flat);
  if (flat.event_notifications !== undefined) {
    validateEventChannelMatrix(flat.event_notifications);
  }

  const patch = {};
  if (flat.email_notifications !== undefined) patch.email_notifications = flat.email_notifications;
  if (flat.sms_notifications !== undefined) patch.sms_notifications = flat.sms_notifications;
  if (flat.in_app_alerts !== undefined) patch.in_app_alerts = flat.in_app_alerts;
  if (flat.event_notifications !== undefined) patch.event_notifications = flat.event_notifications;

  const pool = getTenantPool(dbName);
  let row = await repository.updateSettings(pool, patch);
  if (!row) {
    await repository.seedDefault(pool);
    row = await repository.updateSettings(pool, patch);
  }
  if (!row) {
    throw new ApiError(500, 'Failed to update notification settings');
  }
  return mapToResponse(row);
}

async function updateEventNotification(dbName, eventKey, body) {
  if (!EVENT_KEY_LIST.includes(eventKey)) {
    throw new ApiError(400, 'Invalid event key');
  }

  const hasEmail = Object.prototype.hasOwnProperty.call(body, 'email');
  const hasSms = Object.prototype.hasOwnProperty.call(body, 'sms');
  const hasInApp = Object.prototype.hasOwnProperty.call(body, 'in_app');

  if (!hasEmail && !hasSms && !hasInApp) {
    throw new ApiError(400, 'At least one of email, sms, in_app must be provided');
  }

  if (hasEmail && typeof body.email !== 'boolean') {
    throw new ApiError(400, 'email must be a boolean');
  }
  if (hasSms && typeof body.sms !== 'boolean') {
    throw new ApiError(400, 'sms must be a boolean');
  }
  if (hasInApp && typeof body.in_app !== 'boolean') {
    throw new ApiError(400, 'in_app must be a boolean');
  }

  const pool = getTenantPool(dbName);
  let row = await repository.getSettings(pool);
  if (!row) {
    row = await repository.seedDefault(pool);
  }

  let events = row.event_notifications;
  if (typeof events === 'string') {
    events = JSON.parse(events);
  }

  const prevCell = events[eventKey];
  const base =
    prevCell &&
    typeof prevCell === 'object' &&
    !Array.isArray(prevCell) &&
    prevCell !== null
      ? { ...prevCell }
      : { email: false, sms: false, in_app: false };

  if (hasEmail) base.email = body.email;
  if (hasSms) base.sms = body.sms;
  if (hasInApp) base.in_app = body.in_app;

  const next = { ...events, [eventKey]: base };

  row = await repository.updateSettings(pool, { event_notifications: next });
  if (!row) {
    throw new ApiError(500, 'Failed to update event notification');
  }

  const parsed = typeof row.event_notifications === 'string'
    ? JSON.parse(row.event_notifications)
    : row.event_notifications;
  return parsed;
}

module.exports = {
  EVENT_KEYS,
  EVENT_KEY_LIST,
  mergeNotificationFlat,
  getNotificationSettings,
  updateNotificationSettings,
  updateEventNotification,
};
