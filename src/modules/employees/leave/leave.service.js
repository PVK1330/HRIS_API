'use strict';

const { getTenantPool } = require('../../../config/db');
const ApiError = require('../../../utils/ApiError');
const { runTenantMigrations } = require('../../tenant/tenant.service');
const empRepo = require('../employees.repository');
const repo = require('./leave.repository');

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

async function getLeave(user, employeeId, query = {}) {
  const p = pool(user);
  await ensureMigrated(user.db_name);
  const emp = await empRepo.findById(p, employeeId);
  if (!emp) throw ApiError.notFound('Employee not found');

  const year = parseInt(query.year, 10) || new Date().getFullYear();

  const [requests, balances] = await Promise.all([
    repo.findRequests(p, employeeId, { status: query.status, year }),
    repo.getBalances(p, employeeId, year),
  ]);
  return { requests, balances, year };
}

module.exports = { getLeave };
