'use strict';

const { getTenantPool } = require('../../config/db');

async function log(tenant, {
  module: mod,
  action,
  entityType,
  entityId,
  actorEmployeeId,
  actorName,
  detail = {},
}) {
  const dbName = tenant?.dbName || tenant?.db_name;
  if (!dbName) return;
  try {
    const pool = await getTenantPool(dbName);
    await pool.query(
      `INSERT INTO workflow_audit_logs
         (module, action, entity_type, entity_id, actor_employee_id, actor_name, detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        mod,
        action,
        entityType,
        Number(entityId),
        actorEmployeeId || null,
        actorName || null,
        JSON.stringify(detail || {}),
      ],
    );
  } catch (_) {
    /* non-blocking */
  }
}

module.exports = { log };
