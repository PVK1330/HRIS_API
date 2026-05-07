'use strict';

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const env = require('../../config/env');
const ApiError = require('../../utils/ApiError');
const repo = require('./superadmin.repository');
const { sendMail } = require('../../utils/mail');
const { renderEmail } = require('../../utils/emailTemplate');

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

  const passwordMatches = await bcrypt.compare(password, record.password_hash);
  if (!passwordMatches) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  // 2FA Challenge
  if (record.two_factor_enabled) {
    return {
      mfaRequired: true,
      userId: record.id,
      email: record.email,
    };
  }

  await repo.touchLastLogin(record.id);

  const token = jwt.sign(
    {
      id: record.id,
      email: record.email,
      role: 'superadmin',
      tenant_id: null,
    },
    env.JWT.secret,
    { expiresIn: env.JWT.expiresIn }
  );

  return {
    token,
    superadmin: {
      id: record.id,
      name: record.name,
      email: record.email,
      role: record.role || 'superadmin',
    },
  };
}

const speakeasy = require('speakeasy');

async function verify2FA({ userId, code }) {
  const record = await repo.findById(userId);
  if (!record) {
    throw ApiError.notFound('User not found');
  }

  const verified = speakeasy.totp.verify({
    secret: record.two_factor_secret,
    encoding: 'base32',
    token: code,
  });

  if (!verified) {
    throw ApiError.unauthorized('Invalid verification code');
  }

  await repo.touchLastLogin(record.id);

  const token = jwt.sign(
    {
      id: record.id,
      email: record.email,
      role: 'superadmin',
      tenant_id: null,
    },
    env.JWT.secret,
    { expiresIn: env.JWT.expiresIn }
  );

  return {
    token,
    superadmin: {
      id: record.id,
      name: record.name,
      email: record.email,
      role: record.role || 'superadmin',
    },
  };
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
    const html = await renderEmail('admin-invite', {
      name: cleanName,
      email: cleanEmail,
      password: password,
      role: role || 'Super Admin',
      adminUrl: process.env.ADMIN_URL || 'http://localhost:5173/superadmin/login'
    });

    await sendMail({
      to: cleanEmail,
      subject: 'HRIS Internal Administration - Invitation',
      html
    });
  } catch (error) {
    // We don't want to fail user creation if email fails, but we should log it
    console.error('Failed to send admin invitation email:', error);
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
  const cleanAudience = String(audience || 'All Organizations').trim();
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
      console.error(`Announcement email send failures: ${failed}/${recipients.length}`);
    }
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

module.exports = {
  login,
  verify2FA,
  getAdminUsers,
  createAdminUser,
  updateAdminUser,
  getRoles,
  createRole,
  updateRole,
  getModules,
  updateModule,
  getAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
};
