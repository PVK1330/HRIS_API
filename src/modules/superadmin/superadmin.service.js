'use strict';

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { comparePassword } = require('../../utils/password');
const jwt = require('jsonwebtoken');

const env = require('../../config/env');
const ApiError = require('../../utils/ApiError');
const repo = require('./superadmin.repository');
const { sendMail } = require('../../utils/mail');
const { renderEmail } = require('../../utils/emailTemplate');
const logger = require('../../utils/logger');
const { superAdminPool, getTenantPool } = require('../../config/db');

async function issueSuperadminRefreshToken(userId, role) {
  const jti = crypto.randomUUID();
  const expiresMs = 30 * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + expiresMs);

  await superAdminPool.query(
    `INSERT INTO public.refresh_tokens (jti, user_id, role, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [jti, String(userId), role, expiresAt],
  );

  return jwt.sign(
    { jti, sub: String(userId), role, tenant_id: null, db_name: null, userType: role, purpose: 'refresh' },
    env.JWT.refreshSecret,
    { expiresIn: env.JWT.refreshExpiresIn },
  );
}

/**
 * Authenticates a superadmin and returns a signed JWT plus public profile.
 *
 * @param {{ email: string, password: string }} input
 * @returns {Promise<{ token: string, superadmin: { id: string, name: string, email: string } }>}
 */
async function login({ email, password }) {
  const normalizedEmail = String(email).trim().toLowerCase();

  const record = await repo.findByEmail(normalizedEmail);
  if (!record) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  const passwordMatches = await comparePassword(password, record.password_hash);
  if (!passwordMatches) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  // 2FA Challenge — issue a short-lived signed step-up token instead of
  // returning the raw user id. verify-2fa must not be reachable without first
  // passing password auth; returning a bare id let an attacker brute-force a
  // 6-digit TOTP against an enumerable id and take over the account password-less.
  if (record.two_factor_enabled) {
    const mfaToken = jwt.sign(
      { purpose: 'sa_mfa_login', sub: record.id, email: record.email },
      env.JWT.secret,
      { expiresIn: '10m' }
    );
    return {
      mfaRequired: true,
      mfaToken,
      email: record.email,
    };
  }

  await repo.touchLastLogin(record.id);

  const role = record.role || 'superadmin';
  const token = jwt.sign(
    {
      id: record.id,
      email: record.email,
      role,
      tenant_id: null,
    },
    env.JWT.secret,
    { expiresIn: env.JWT.expiresIn }
  );

  const refreshToken = await issueSuperadminRefreshToken(record.id, role);

  return {
    token,
    refreshToken,
    superadmin: {
      id: record.id,
      name: record.name,
      email: record.email,
      role,
    },
  };
}

const speakeasy = require('speakeasy');

async function verify2FA({ mfaToken, code }) {
  if (!mfaToken) {
    throw ApiError.badRequest('Missing verification session token');
  }

  let payload;
  try {
    payload = jwt.verify(mfaToken, env.JWT.secret);
  } catch (err) {
    throw ApiError.unauthorized('Your verification session has expired. Please sign in again.');
  }
  if (!payload || payload.purpose !== 'sa_mfa_login') {
    throw ApiError.unauthorized('Invalid verification session');
  }

  const record = await repo.findById(payload.sub);
  if (!record) {
    throw ApiError.notFound('User not found');
  }
  if (!record.two_factor_enabled || !record.two_factor_secret) {
    throw ApiError.unauthorized('Two-factor authentication is not configured for this account.');
  }

  const verified = speakeasy.totp.verify({
    secret: record.two_factor_secret,
    encoding: 'base32',
    token: String(code || '').trim(),
    window: 1,
  });

  if (!verified) {
    throw ApiError.unauthorized('Invalid verification code');
  }

  await repo.touchLastLogin(record.id);

  const role = record.role || 'superadmin';
  const token = jwt.sign(
    {
      id: record.id,
      email: record.email,
      role,
      tenant_id: null,
    },
    env.JWT.secret,
    { expiresIn: env.JWT.expiresIn }
  );

  const refreshToken = await issueSuperadminRefreshToken(record.id, role);

  return {
    token,
    refreshToken,
    superadmin: {
      id: record.id,
      name: record.name,
      email: record.email,
      role,
    },
  };
}

const QRCode = require('qrcode');
const MFA_ISSUER = process.env.MFA_ISSUER || 'HRIS Platform';

/** Current 2FA status for a superadmin (or sub-admin) account. */
async function getMfaStatus(userId) {
  const row = await repo.getMfaState(userId);
  if (!row) throw ApiError.notFound('Account not found');
  return {
    enabled: Boolean(row.two_factor_enabled),
    pending: Boolean(row.two_factor_pending_secret) && !row.two_factor_enabled,
  };
}

/** Begin enrollment: generate + store a pending secret, return QR + manual key. */
async function beginMfaSetup(userId) {
  const row = await repo.getMfaState(userId);
  if (!row) throw ApiError.notFound('Account not found');
  if (row.two_factor_enabled) {
    throw ApiError.badRequest('Two-factor authentication is already enabled. Disable it first to re-enroll.');
  }

  const label = row.email || row.name || `superadmin-${row.id}`;
  const secret = speakeasy.generateSecret({
    name: `${MFA_ISSUER} (${label})`,
    issuer: MFA_ISSUER,
    length: 20,
  });

  await repo.setMfaPending(row.id, secret.base32);
  const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url);
  return { secret: secret.base32, otpauthUrl: secret.otpauth_url, qrDataUrl };
}

/** Confirm enrollment by verifying a code against the pending secret. */
async function enableMfa(userId, code) {
  if (!code) throw ApiError.badRequest('Verification code is required');
  const row = await repo.getMfaState(userId);
  if (!row) throw ApiError.notFound('Account not found');
  if (row.two_factor_enabled) throw ApiError.badRequest('Two-factor authentication is already enabled.');
  if (!row.two_factor_pending_secret) {
    throw ApiError.badRequest('Start the setup first, then enter the code from your authenticator app.');
  }

  const ok = speakeasy.totp.verify({
    secret: row.two_factor_pending_secret,
    encoding: 'base32',
    token: String(code).trim(),
    window: 1,
  });
  if (!ok) throw ApiError.unauthorized('Invalid verification code. Check your device time and try again.');

  await repo.enableMfa(row.id);
  return { enabled: true };
}

/** Disable 2FA after verifying a current code. */
async function disableMfa(userId, code) {
  const row = await repo.getMfaState(userId);
  if (!row) throw ApiError.notFound('Account not found');
  if (!row.two_factor_enabled) {
    await repo.disableMfa(row.id);
    return { enabled: false };
  }
  if (!code) throw ApiError.badRequest('Enter a current code from your authenticator app to disable 2FA.');

  const ok = speakeasy.totp.verify({
    secret: row.two_factor_secret,
    encoding: 'base32',
    token: String(code).trim(),
    window: 1,
  });
  if (!ok) throw ApiError.unauthorized('Invalid verification code.');

  await repo.disableMfa(row.id);
  return { enabled: false };
}

function normalizeRoleKey(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function normalizeStatus(input) {
  const status = String(input || 'active').trim().toLowerCase();
  if (!['active', 'inactive', 'pending'].includes(status)) {
    throw ApiError.badRequest('Invalid status value');
  }
  return status;
}

async function getAdminUsers() {
  const rows = await repo.listAdminUsers();
  return rows.map((row) => ({
    ...row,
    role: row.role || 'superadmin',
  }));
}

async function createAdminUser({ name, email, password, role, status }) {
  const cleanName = String(name || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanRole = normalizeRoleKey(role || 'superadmin');
  const cleanStatus = normalizeStatus(status || 'pending');

  if (!cleanName || !cleanEmail || !password) {
    throw ApiError.badRequest('name, email and password are required');
  }

  const passwordHash = await bcrypt.hash(password, env.BCRYPT_SALT_ROUNDS);
  const user = await repo.createAdminUser({
    name: cleanName,
    email: cleanEmail,
    passwordHash,
    role: cleanRole,
    status: cleanStatus,
  });

  // Send invitation email
  try {
    const { html, attachments } = await renderEmail('admin-invite', {
      name: cleanName,
      email: cleanEmail,
      password: password,
      role: role || 'Super Admin',
      adminUrl: process.env.ADMIN_URL || 'http://localhost:5173/superadmin/login'
    });

    await sendMail({
      to: cleanEmail,
      subject: 'HRIS Internal Administration - Invitation',
      html,
      attachments
    });
  } catch (error) {
    // We don't want to fail user creation if email fails, but we should log it
    logger.error('[superadmin] failed to send admin invitation email', { err: error.message });
  }

  return user;
}

async function updateAdminUser(id, input) {
  const updates = {};
  if (input.name != null) updates.name = String(input.name).trim();
  if (input.role != null) updates.role = normalizeRoleKey(input.role);
  if (input.status != null) updates.status = normalizeStatus(input.status);
  const updated = await repo.updateAdminUser(id, updates);
  if (!updated) throw ApiError.notFound('Admin user not found');
  return updated;
}

// Self-service profile for the currently authenticated superadmin / sub-admin.
async function getProfile(userId) {
  const profile = await repo.getProfileById(userId);
  if (!profile) throw ApiError.notFound('Profile not found');
  return profile;
}

async function updateProfile(userId, input = {}) {
  const updates = {};
  if (input.name != null) {
    const name = String(input.name).trim();
    if (!name) throw ApiError.badRequest('Name cannot be empty');
    updates.name = name;
  }
  const updated = await repo.updateProfile(userId, updates);
  if (!updated) throw ApiError.notFound('Profile not found');
  return updated;
}

async function getRoles() {
  return repo.listRoles();
}

async function createRole({ name, description, permissions, isActive }) {
  const roleName = String(name || '').trim();
  if (!roleName) throw ApiError.badRequest('Role name is required');
  const roleKey = normalizeRoleKey(roleName);
  return repo.createRole({ 
    roleKey, 
    roleName, 
    description, 
    permissions, 
    isActive: isActive === undefined ? true : Boolean(isActive) 
  });
}

async function updateRole(roleKey, { name, description, permissions, isActive }) {
  const normalizedRoleKey = normalizeRoleKey(roleKey);
  const updated = await repo.updateRole(normalizedRoleKey, {
    roleName: name ? String(name).trim() : undefined,
    description: description == null ? undefined : String(description),
    permissions,
    isActive: isActive === undefined ? undefined : Boolean(isActive)
  });
  if (!updated) throw ApiError.notFound('Role not found');
  return updated;
}

async function deleteRole(roleKey) {
  const normalizedRoleKey = normalizeRoleKey(roleKey);
  const deleted = await repo.deleteRole(normalizedRoleKey);
  if (!deleted) throw ApiError.notFound('Role not found or cannot be deleted (system role)');
  return true;
}

function normalizeModuleKey(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

async function getModules() {
  return repo.listModules();
}

async function updateModule(moduleKey, { isEnabled }) {
  const normalizedModuleKey = normalizeModuleKey(moduleKey);
  const updated = await repo.updateModule(normalizedModuleKey, {
    isEnabled: Boolean(isEnabled),
  });
  if (!updated) throw ApiError.notFound('Module not found');
  return updated;
}

function normalizeAnnouncementType(type) {
  const normalized = String(type || 'Info').trim();
  const valid = ['Info', 'Warning', 'Critical', 'Update'];
  if (!valid.includes(normalized)) {
    throw ApiError.badRequest('Invalid announcement type');
  }
  return normalized;
}

async function getAnnouncements() {
  return repo.listAnnouncements();
}

async function createAnnouncement({ title, message, audience, type }) {
  const cleanTitle = String(title || '').trim();
  const cleanMessage = String(message || '').trim();
  const cleanAudience = String(audience || 'All Organisations').trim();
  const cleanType = normalizeAnnouncementType(type);

  if (!cleanTitle || !cleanMessage) {
    throw ApiError.badRequest('title and message are required');
  }

  const recipients = await repo.listAnnouncementRecipients(cleanAudience);

  const announcement = await repo.createAnnouncement({
    title: cleanTitle,
    message: cleanMessage,
    audience: cleanAudience,
    type: cleanType,
    recipients: recipients.length,
  });

  if (recipients.length > 0) {
    const subject = `[HRIS Announcement] ${cleanTitle}`;
    const sendResults = await Promise.allSettled(
      recipients.map((recipient) => {
        const text = `${cleanMessage}\n\nAudience: ${cleanAudience}\nType: ${cleanType}`;
        const html = `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
            <h2 style="margin-bottom: 8px;">${cleanTitle}</h2>
            <p style="margin-top: 0; color: #6b7280;">Audience: ${cleanAudience} | Type: ${cleanType}</p>
            <div style="white-space: pre-wrap;">${cleanMessage}</div>
          </div>
        `;
        return sendMail({
          to: recipient.admin_email,
          subject,
          text,
          html,
        });
      })
    );

    const failed = sendResults.filter((result) => result.status === 'rejected').length;
    if (failed > 0) {
      logger.warn('[superadmin] announcement email send failures', { failed, total: recipients.length });
    }

    // Push announcement into each tenant's in-app feed
    await Promise.allSettled(
      recipients.map(async (recipient) => {
        if (!recipient.db_name) return;
        try {
          const pool = getTenantPool(recipient.db_name);
          await pool.query(
            `INSERT INTO announcements
               (title, category, priority, content, visibility, status, dispatch_channels, dispatched_at)
             VALUES ($1, $2, $3, $4, 'All Employees', 'Published', 'In App', NOW())`,
            [cleanTitle, 'General', 'Normal', cleanMessage],
          );
        } catch (err) {
          logger.warn(`[superadmin] failed to push announcement into tenant ${recipient.db_name}: ${err.message}`);
        }
      })
    );
  }

  return announcement;
}

async function updateAnnouncement(id, { title, message, audience, type }) {
  const updated = await repo.updateAnnouncement(id, {
    title: title == null ? undefined : String(title).trim(),
    message: message == null ? undefined : String(message).trim(),
    audience: audience == null ? undefined : String(audience).trim(),
    type: type == null ? undefined : normalizeAnnouncementType(type),
  });
  if (!updated) throw ApiError.notFound('Announcement not found');
  return updated;
}

async function deleteAnnouncement(id) {
  const deleted = await repo.deleteAnnouncement(id);
  if (!deleted) throw ApiError.notFound('Announcement not found');
}

async function getSupportTickets() {
  const rows = await repo.listSupportTickets();
  return rows.map((row) => ({
    id: row.id,
    ticketCode: row.ticket_code,
    org: row.org_name,
    subject: row.subject,
    priority: row.priority,
    assignedTo: row.assigned_to || 'Unassigned',
    status: row.status,
    description: row.description || '',
    created: row.created_at,
    messages: Array.isArray(row.messages) ? row.messages : [],
  }));
}

async function updateSupportTicket(id, { assignedTo, status }) {
  const updated = await repo.updateSupportTicket(id, {
    assignedTo: assignedTo == null ? undefined : String(assignedTo).trim(),
    status: status == null ? undefined : String(status).trim(),
  });
  if (!updated) throw ApiError.notFound('Support ticket not found');
  return updated;
}

async function addSupportTicketMessage(id, { sender, text, time }) {
  const cleanText = String(text || '').trim();
  if (!cleanText) throw ApiError.badRequest('Message text is required');

  const message = {
    sender: String(sender || 'Support').trim(),
    text: cleanText,
    time: String(time || new Date().toISOString()),
  };

  const updated = await repo.appendSupportTicketMessage(id, message);
  if (!updated) throw ApiError.notFound('Support ticket not found');
  return updated;
}

async function logAuditEvent(payload) {
  const cleanActorName = String(payload.actorName || 'System').trim();
  const cleanAction = String(payload.action || 'Unknown').trim();
  if (!cleanAction) return null;
  return repo.createAuditLog({
    actorName: cleanActorName,
    action: cleanAction,
    target: payload.target,
    ipAddress: payload.ipAddress,
    result: payload.result || 'Success',
    metadata: payload.metadata || {},
  });
}

async function getAuditLogs() {
  const rows = await repo.listAuditLogs();
  return rows.map((row) => ({
    id: row.id,
    timestamp: row.created_at,
    admin: row.actor_name,
    action: row.action,
    target: row.target,
    ip: row.ip_address,
    result: row.result,
    metadata: row.metadata || {},
  }));
}

module.exports = {
  login,
  verify2FA,
  getMfaStatus,
  beginMfaSetup,
  enableMfa,
  disableMfa,
  getAdminUsers,
  createAdminUser,
  updateAdminUser,
  getProfile,
  updateProfile,
  getRoles,
  createRole,
  updateRole,
  getModules,
  updateModule,
  getAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  getSupportTickets,
  updateSupportTicket,
  addSupportTicketMessage,
  logAuditEvent,
  getAuditLogs,
};
