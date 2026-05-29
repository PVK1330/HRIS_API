'use strict';

const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');

async function listClearanceItems(tenant, instanceId) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `SELECT * FROM exit_clearance_items WHERE instance_id = $1 ORDER BY id ASC`,
    [instanceId]
  );
  return rows;
}

async function addClearanceItem(tenant, instanceId, data) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `INSERT INTO exit_clearance_items (instance_id, department, item_name, status)
     VALUES ($1, $2, $3, 'Pending') RETURNING *`,
    [instanceId, data.department, data.item_name]
  );
  return rows[0];
}

async function updateClearanceItem(tenant, instanceId, itemId, data, userId) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `UPDATE exit_clearance_items SET status = $1, cleared_by = $2, cleared_at = NOW() 
     WHERE id = $3 AND instance_id = $4 RETURNING *`,
    [data.status, userId, itemId, instanceId]
  );
  if (!rows.length) throw ApiError.notFound('Clearance item not found');
  return rows[0];
}

module.exports = {
  listClearanceItems,
  addClearanceItem,
  updateClearanceItem
};
