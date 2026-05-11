'use strict';

const repo = require('./policies.repository');
const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');

async function listPolicies(tenant, filters) {
  const pool = await getTenantPool(tenant.dbName);
  return repo.findAll(pool, filters);
}

async function getPolicy(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const policy = await repo.findById(pool, id);
  if (!policy) throw new ApiError(404, 'Policy not found');
  return policy;
}

async function createPolicy(tenant, user, data) {
  const pool = await getTenantPool(tenant.dbName);
  const payload = {
    ...data,
    createdBy: user.id
  };
  return repo.create(pool, payload);
}

async function updatePolicy(tenant, id, data) {
  const pool = await getTenantPool(tenant.dbName);
  const updated = await repo.update(pool, id, data);
  if (!updated) throw new ApiError(404, 'Policy not found');
  return updated;
}

async function deletePolicy(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const deleted = await repo.remove(pool, id);
  if (!deleted) throw new ApiError(404, 'Policy not found');
  return true;
}

async function getCompliance(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  return repo.getAcknowledgements(pool, id);
}

async function acknowledgePolicy(tenant, user, policyId) {
  const pool = await getTenantPool(tenant.dbName);
  return repo.acknowledge(pool, policyId, user.id);
}

async function listCategories(tenant) {
  const pool = await getTenantPool(tenant.dbName);
  return repo.listCategories(pool);
}

async function createCategory(tenant, data) {
  const pool = await getTenantPool(tenant.dbName);
  return repo.createCategory(pool, data);
}

async function updateCategory(tenant, id, data) {
  const pool = await getTenantPool(tenant.dbName);
  return repo.updateCategory(pool, id, data);
}

async function deleteCategory(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  return repo.deleteCategory(pool, id);
}

module.exports = {
  listPolicies,
  getPolicy,
  createPolicy,
  updatePolicy,
  deletePolicy,
  getCompliance,
  acknowledgePolicy,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory
};
