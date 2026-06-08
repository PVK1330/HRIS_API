'use strict';

const { getTenantPool, superAdminPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const logger   = require('../../utils/logger');
const repo     = require('./letters.repository');
const { ensureMigrated } = require('../../utils/tenantMigration');
const notify   = require('../notifications/notifications.service');

/**
 * Resolve the tenant pool from the authenticated user's JWT payload.
 * The JWT includes db_name when the user is a tenant admin.
 */
function resolvePool(user) {
  if (!user || !user.db_name) {
    throw ApiError.unauthorized('Tenant database not found in token');
  }
  return getTenantPool(user.db_name);
}

// ─── Templates ────────────────────────────────────────────────────────────────

async function listTemplates(user, query = {}) {
  const pool = resolvePool(user);
  await ensureMigrated(user.db_name);
  const page   = Math.max(1, parseInt(query.page,  10) || 1);
  const limit  = Math.min(100, parseInt(query.limit, 10) || 50);
  const offset = (page - 1) * limit;

  const [templates, total] = await Promise.all([
    repo.findAllTemplates(pool, { ...query, limit, offset }),
    repo.countTemplates(pool, query),
  ]);

  return { templates, total, page, limit };
}

async function getTemplate(user, id) {
  const pool = resolvePool(user);
  await ensureMigrated(user.db_name);
  const template = await repo.findTemplateById(pool, id);
  if (!template) throw ApiError.notFound('Template not found');
  return template;
}

async function createTemplate(user, data) {
  const pool = resolvePool(user);
  await ensureMigrated(user.db_name);
  return repo.insertTemplate(pool, { ...data, createdBy: user.id });
}

async function updateTemplate(user, id, data) {
  const pool = resolvePool(user);
  await ensureMigrated(user.db_name);
  const existing = await repo.findTemplateById(pool, id);
  if (!existing) throw ApiError.notFound('Template not found');
  return repo.updateTemplate(pool, id, data);
}
async function deleteTemplate(user, id) {
  const pool = resolvePool(user);
  await ensureMigrated(user.db_name);
  const existing = await repo.findTemplateById(pool, id);
  if (!existing) throw ApiError.notFound('Template not found');
  const deleted = await repo.deleteTemplate(pool, id);
  if (!deleted) throw ApiError.notFound('Template not found');
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

async function dispatchLetter(user, { templateId, employeeId, sentBy }) {
  const pool = resolvePool(user);
  await ensureMigrated(user.db_name);

  const template = await repo.findTemplateById(pool, templateId);
  if (!template) throw ApiError.notFound('Template not found');

  // Resolve employee name from tenant DB
  let employeeName = 'Unknown';
  if (employeeId) {
    const { rows } = await pool.query(
      `SELECT CONCAT(first_name, ' ', last_name) AS full_name FROM employees WHERE id = $1`,
      [employeeId]
    );
    if (rows[0]) employeeName = rows[0].full_name;
  }

  const dispatch = await repo.insertDispatch(pool, {
    templateId,
    employeeId: employeeId || null,
    employee: employeeName,
    template: template.name,
    sentBy: sentBy || (user.name || user.email || 'Admin'),
    bodySnapshot: template.body,
    status: 'Delivered',
  });

  // Increment usage counter on the template
  await repo.incrementUsageCount(pool, templateId);

  // Notify the recipient employee that a letter was issued to them.
  if (employeeId) {
    notify.sendSystemNotification({ db_name: user.db_name }, {
      employeeId: Number(employeeId),
      title: `New Letter: ${template.name}`,
      message: `A document "${template.name}" has been issued to you. You can view it in your letters inbox.`,
      type: 'info',
      entityType: 'letter',
      entityId: dispatch.id,
      redirectUrl: '/employee/letters',
      sendEmail: true,
    }).catch(() => null);
  }

  return dispatch;
}

// ─── History ──────────────────────────────────────────────────────────────────

async function listHistory(user, query = {}) {
  const pool = resolvePool(user);
  await ensureMigrated(user.db_name);
  const page   = Math.max(1, parseInt(query.page,  10) || 1);
  const limit  = Math.min(100, parseInt(query.limit, 10) || 50);
  const offset = (page - 1) * limit;

  const [history, total] = await Promise.all([
    repo.findAllHistory(pool, { limit, offset }),
    repo.countHistory(pool),
  ]);

  return { history, total, page, limit };
}

// ─── KPIs ─────────────────────────────────────────────────────────────────────

async function getKpis(user) {
  const pool = resolvePool(user);
  await ensureMigrated(user.db_name);
  return repo.getKpis(pool);
}

// ─── Tags ─────────────────────────────────────────────────────────────────────

async function listTags(user) {
  const pool = resolvePool(user);
  await ensureMigrated(user.db_name);
  return repo.findAllTags(pool);
}

async function createTag(user, data) {
  const pool = resolvePool(user);
  await ensureMigrated(user.db_name);
  // Normalise: wrap in {{ }} if user didn't include them
  let tag = (data.tag || '').trim();
  if (!tag.startsWith('{{')) tag = `{{${tag}`;
  if (!tag.endsWith('}}'))   tag = `${tag}}}`;
  // Validate format: only letters, digits, underscores inside braces
  if (!/^\{\{[a-z0-9_]+\}\}$/.test(tag)) {
    throw ApiError.badRequest('Tag must be lowercase letters, digits and underscores only, e.g. {{my_field}}');
  }
  return repo.insertTag(pool, { tag, description: data.description, createdBy: user.id });
}

async function updateTag(user, id, data) {
  const pool = resolvePool(user);
  await ensureMigrated(user.db_name);
  const existing = await repo.findTagById(pool, id);
  if (!existing)          throw ApiError.notFound('Tag not found');
  if (existing.isSystem)  throw ApiError.forbidden('System tags cannot be modified');
  let tag = data.tag !== undefined ? (data.tag || '').trim() : undefined;
  if (tag !== undefined) {
    if (!tag.startsWith('{{')) tag = `{{${tag}`;
    if (!tag.endsWith('}}'))   tag = `${tag}}}`;
    if (!/^\{\{[a-z0-9_]+\}\}$/.test(tag)) {
      throw ApiError.badRequest('Tag must be lowercase letters, digits and underscores only');
    }
  }
  const updated = await repo.updateTag(pool, id, { tag, description: data.description });
  if (!updated) throw ApiError.notFound('Tag not found');
  return updated;
}

async function deleteTag(user, id) {
  const pool = resolvePool(user);
  await ensureMigrated(user.db_name);
  const existing = await repo.findTagById(pool, id);
  if (!existing)         throw ApiError.notFound('Tag not found');
  if (existing.isSystem) throw ApiError.forbidden('System tags cannot be deleted');
  const deleted = await repo.deleteTag(pool, id);
  if (!deleted) throw ApiError.notFound('Tag not found');
}

module.exports = {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  dispatchLetter,
  listHistory,
  getKpis,
  listTags,
  createTag,
  updateTag,
  deleteTag,
};
