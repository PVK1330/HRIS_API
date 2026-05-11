'use strict';

const repo = require('./assets.repository');
const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');

async function listAssets(tenant) {
  const pool = await getTenantPool(tenant.dbName);
  return repo.findAll(pool);
}

async function getAsset(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const asset = await repo.findById(pool, id);
  if (!asset) throw new ApiError(404, 'Asset not found');
  return asset;
}

async function createAsset(tenant, data) {
  const pool = await getTenantPool(tenant.dbName);
  // Generate asset ID if not provided (e.g. AST-00X)
  if (!data.assetId) {
    const assets = await repo.findAll(pool);
    const lastId = assets.length > 0 ? assets[0].asset_id : 'AST-000';
    const nextNum = parseInt(lastId.split('-')[1]) + 1;
    data.assetId = `AST-${String(nextNum).padStart(3, '0')}`;
  }
  return repo.create(pool, data);
}

async function updateAsset(tenant, id, data) {
  const pool = await getTenantPool(tenant.dbName);
  const updated = await repo.update(pool, id, data);
  if (!updated) throw new ApiError(404, 'Asset not found');
  return updated;
}

async function deleteAsset(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const deleted = await repo.remove(pool, id);
  if (!deleted) throw new ApiError(404, 'Asset not found');
  return true;
}

module.exports = {
  listAssets,
  getAsset,
  createAsset,
  updateAsset,
  deleteAsset
};
