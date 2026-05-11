'use strict';

const repo = require('./departments.repository');
const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');

/**
 * List all departments for the tenant
 */
async function listDepartments(tenant) {
  const pool = await getTenantPool(tenant.dbName);
  return repo.findAll(pool);
}

/**
 * Get a single department
 */
async function getDepartment(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const dept = await repo.findById(pool, id);
  if (!dept) throw new ApiError(404, 'Department not found');
  return dept;
}

/**
 * Create a department
 */
async function createDepartment(tenant, data) {
  const pool = await getTenantPool(tenant.dbName);
  return repo.create(pool, data);
}

/**
 * Update a department
 */
async function updateDepartment(tenant, id, data) {
  const pool = await getTenantPool(tenant.dbName);
  const updated = await repo.update(pool, id, data);
  if (!updated) throw new ApiError(404, 'Department not found');
  return updated;
}

/**
 * Delete a department
 */
async function deleteDepartment(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const deleted = await repo.remove(pool, id);
  if (!deleted) throw new ApiError(404, 'Department not found');
  return true;
}

module.exports = {
  listDepartments,
  getDepartment,
  createDepartment,
  updateDepartment,
  deleteDepartment
};
