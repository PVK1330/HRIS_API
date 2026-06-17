'use strict';

const { getTenantPool } = require('../../config/db');

/**
 * Insert a single audit log entry.
 * Errors are swallowed so they never break the caller's main flow.
 *
 * @param {string} dbName  - Tenant database name
 * @param {object} logData
 * @returns {object|null} Inserted row or null on error
 */
async function logAction(dbName, logData = {}) {
  try {
    const pool = getTenantPool(dbName);
    const {
      actorEmployeeId = null,
      actorUserId = null,
      actorName = null,
      actorRole = null,
      action = null,
      module = null,
      entityType = null,
      entityId = null,
      oldValue = null,
      newValue = null,
      ipAddress = null,
      userAgent = null,
      status = 'SUCCESS',
      errorMessage = null,
    } = logData;

    const { rows } = await pool.query(
      `INSERT INTO audit_logs
         (actor_employee_id, actor_user_id, actor_name, actor_role,
          action, module, entity_type, entity_id,
          old_value, new_value, ip_address, user_agent,
          status, error_message, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
       RETURNING *`,
      [
        actorEmployeeId,
        actorUserId,
        actorName,
        actorRole,
        action,
        module,
        entityType,
        entityId,
        oldValue ? JSON.stringify(oldValue) : null,
        newValue ? JSON.stringify(newValue) : null,
        ipAddress,
        userAgent,
        status,
        errorMessage,
      ]
    );
    return rows[0] || null;
  } catch (err) {
    // Never break the main flow
    console.error('[AuditLog] Failed to write audit log:', err.message);
    return null;
  }
}

/**
 * Retrieve paginated audit logs with optional filters.
 *
 * @param {string} dbName
 * @param {object} filters - { module, action, status, actorEmployeeId, fromDate, toDate, search, page, limit }
 * @returns {{ data, total, page, limit, totalPages }}
 */
async function getLogs(dbName, filters = {}) {
  const pool = getTenantPool(dbName);

  const {
    module,
    action,
    status,
    actorEmployeeId,
    fromDate,
    toDate,
    search,
    page = 1,
    limit = 20,
  } = filters;

  const parsedPage = Math.max(1, parseInt(page, 10) || 1);
  const parsedLimit = Math.min(200, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (parsedPage - 1) * parsedLimit;

  const conditions = [];
  const values = [];
  let idx = 1;

  if (module) {
    conditions.push(`al.module = $${idx++}`);
    values.push(module);
  }
  if (action) {
    conditions.push(`al.action = $${idx++}`);
    values.push(action);
  }
  if (status) {
    conditions.push(`al.status = $${idx++}`);
    values.push(status);
  }
  if (actorEmployeeId) {
    conditions.push(`al.actor_employee_id = $${idx++}`);
    values.push(actorEmployeeId);
  }
  if (fromDate) {
    conditions.push(`al.created_at >= $${idx++}`);
    values.push(fromDate);
  }
  if (toDate) {
    // Include the full day of toDate
    conditions.push(`al.created_at < ($${idx++}::date + INTERVAL '1 day')`);
    values.push(toDate);
  }
  if (search) {
    conditions.push(
      `(al.action ILIKE $${idx} OR al.actor_name ILIKE $${idx} OR al.module ILIKE $${idx})`
    );
    values.push(`%${search}%`);
    idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const baseQuery = `
    FROM audit_logs al
    LEFT JOIN employees e ON al.actor_employee_id = e.id
    ${where}
  `;

  const countResult = await pool.query(
    `SELECT COUNT(*) AS total ${baseQuery}`,
    values
  );
  const total = parseInt(countResult.rows[0].total, 10);

  const dataValues = [...values, parsedLimit, offset];
  const dataResult = await pool.query(
    `SELECT
       al.*,
       e.first_name AS actor_first_name,
       e.last_name  AS actor_last_name
     ${baseQuery}
     ORDER BY al.created_at DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    dataValues
  );

  return {
    data: dataResult.rows,
    total,
    page: parsedPage,
    limit: parsedLimit,
    totalPages: Math.ceil(total / parsedLimit),
  };
}

/**
 * Return distinct module names recorded in audit_logs.
 *
 * @param {string} dbName
 * @returns {string[]}
 */
async function getModules(dbName) {
  const pool = getTenantPool(dbName);
  const { rows } = await pool.query(
    `SELECT DISTINCT module FROM audit_logs WHERE module IS NOT NULL ORDER BY module`
  );
  return rows.map((r) => r.module);
}

/**
 * Return distinct action names, optionally filtered by module.
 *
 * @param {string} dbName
 * @param {string|null} module
 * @returns {string[]}
 */
async function getActions(dbName, module = null) {
  const pool = getTenantPool(dbName);
  const { rows } = await pool.query(
    `SELECT DISTINCT action FROM audit_logs
     WHERE ($1::text IS NULL OR module = $1) AND action IS NOT NULL
     ORDER BY action`,
    [module || null]
  );
  return rows.map((r) => r.action);
}

module.exports = { logAction, getLogs, getModules, getActions };
