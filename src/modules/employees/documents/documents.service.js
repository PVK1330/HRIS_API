'use strict';

const { getTenantPool } = require('../../../config/db');
const ApiError = require('../../../utils/ApiError');
const { runTenantMigrations } = require('../../tenant/tenant.service');
const empRepo = require('../employees.repository');
const repo = require('./documents.repository');

const _cache = new Map();
async function ensureMigrated(dbName) {
  if (_cache.has(dbName)) return _cache.get(dbName);
  const p = runTenantMigrations(dbName).catch((err) => {
    _cache.delete(dbName);
    throw ApiError.internal('Database setup failed.');
  });
  _cache.set(dbName, p);
  return p;
}

function pool(user) {
  if (!user?.db_name) throw ApiError.unauthorized('Tenant not found');
  return getTenantPool(user.db_name);
}

async function getDocuments(user, employeeId) {
  const p = pool(user);
  await ensureMigrated(user.db_name);
  const emp = await empRepo.findById(p, employeeId);
  if (!emp) throw ApiError.notFound('Employee not found');
  const documents = await repo.findByEmployee(p, employeeId);
  return { documents };
}

module.exports = { getDocuments };
