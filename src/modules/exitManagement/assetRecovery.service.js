'use strict';

const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');

async function listAssets(tenant, instanceId) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `SELECT * FROM exit_assets WHERE instance_id = $1 ORDER BY id ASC`,
    [instanceId]
  );
  return rows;
}

async function updateAssetStatus(tenant, instanceId, assetId, status, userId) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `UPDATE exit_assets SET status = $1, handled_by = $2, handled_at = NOW() 
     WHERE id = $3 AND instance_id = $4 RETURNING *`,
    [status, userId, assetId, instanceId]
  );
  if (!rows.length) throw ApiError.notFound('Asset not found');
  return rows[0];
}

module.exports = {
  listAssets,
  updateAssetStatus
};
