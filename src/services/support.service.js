'use strict';

const { getTenantPool } = require('../config/db');
const ApiError = require('../utils/ApiError');
const { runTenantMigrations } = require('../modules/tenant/tenant.service');

const _migrationCache = new Map();

async function ensureMigrated(dbName) {
  if (_migrationCache.has(dbName)) return _migrationCache.get(dbName);
  const p = runTenantMigrations(dbName).catch((err) => {
    _migrationCache.delete(dbName);
    throw ApiError.internal('Database setup failed.');
  });
  _migrationCache.set(dbName, p);
  return p;
}

function getPool(user) {
  if (!user || !user.db_name) {
    throw ApiError.unauthorized('Tenant context missing');
  }
  return getTenantPool(user.db_name);
}

async function createTicket(user, tenant, ticketData) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);

  const query = `
    INSERT INTO support_tickets (
      admin_id,
      admin_name,
      tenant_id,
      tenant_name,
      subject,
      category,
      priority,
      description,
      attachment_url,
      status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *
  `;
  const values = [
    user.id,
    ticketData.adminName || '',
    tenant.id,
    ticketData.tenantName || tenant.name,
    ticketData.subject,
    ticketData.category,
    ticketData.priority,
    ticketData.description,
    ticketData.attachmentUrl || null,
    ticketData.status || 'Open',
  ];

  const { rows } = await pool.query(query, values);
  return rows[0];
}

async function listTickets(user) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);

  const { rows } = await pool.query(
    `SELECT id, admin_name, tenant_name, subject, category, priority, description, attachment_url, status, created_at, updated_at
     FROM support_tickets
     ORDER BY created_at DESC`
  );

  return rows;
}

async function getTicketById(user, ticketId) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);

  const { rows } = await pool.query(
    `SELECT id, admin_name, tenant_name, subject, category, priority, description, attachment_url, status, created_at, updated_at
     FROM support_tickets
     WHERE id = $1`,
    [ticketId],
  );

  if (!rows.length) throw ApiError.notFound('Support ticket not found');

  const ticket = rows[0];

  const repliesResult = await pool.query(
    `SELECT id, ticket_id, superadmin_id, message, internal_notes, created_at
     FROM support_ticket_replies
     WHERE ticket_id = $1
     ORDER BY created_at ASC`,
    [ticketId],
  );

  return {
    ...ticket,
    replies: repliesResult.rows || [],
  };
}

async function updateTicket(user, ticketId, ticketData) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);

  const allowedFields = [];
  const values = [];
  let idx = 1;

  if (ticketData.subject != null) {
    allowedFields.push(`subject = $${idx++}`);
    values.push(ticketData.subject);
  }
  if (ticketData.category != null) {
    allowedFields.push(`category = $${idx++}`);
    values.push(ticketData.category);
  }
  if (ticketData.priority != null) {
    allowedFields.push(`priority = $${idx++}`);
    values.push(ticketData.priority);
  }
  if (ticketData.description != null) {
    allowedFields.push(`description = $${idx++}`);
    values.push(ticketData.description);
  }
  if (ticketData.status != null) {
    allowedFields.push(`status = $${idx++}`);
    values.push(ticketData.status);
  }
  if (ticketData.attachmentUrl !== undefined) {
    allowedFields.push(`attachment_url = $${idx++}`);
    values.push(ticketData.attachmentUrl);
  }

  if (!allowedFields.length) {
    throw ApiError.badRequest('No updates were provided');
  }

  const query = `
    UPDATE support_tickets
    SET ${allowedFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
    WHERE id = $${idx}
    RETURNING id, admin_name, tenant_name, subject, category, priority, description, attachment_url, status, created_at, updated_at
  `;
  values.push(ticketId);

  const { rows } = await pool.query(query, values);
  if (!rows.length) throw ApiError.notFound('Support ticket not found');
  return rows[0];
}

async function deleteTicket(user, ticketId) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);

  const { rowCount } = await pool.query(
    `DELETE FROM support_tickets WHERE id = $1`,
    [ticketId],
  );
  if (!rowCount) throw ApiError.notFound('Support ticket not found');
  return true;
}

module.exports = {
  createTicket,
  listTickets,
  getTicketById,
  updateTicket,
  deleteTicket,
};
