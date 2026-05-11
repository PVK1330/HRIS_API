'use strict';

const { getTenantPool } = require('../../../config/db');
const ApiError = require('../../../utils/ApiError');
const { runTenantMigrations } = require('../../tenant/tenant.service');
const empRepo = require('../employees.repository');
const repo = require('./attendance.repository');

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

async function getAttendance(user, employeeId, query = {}) {
  const p = pool(user);
  await ensureMigrated(user.db_name);
  const emp = await empRepo.findById(p, employeeId);
  if (!emp) throw ApiError.notFound('Employee not found');

  const now = new Date();
  const year  = parseInt(query.year,  10) || now.getFullYear();
  const month = parseInt(query.month, 10) || now.getMonth() + 1;

  const [records, summary] = await Promise.all([
    repo.findByEmployee(p, employeeId, { year, month }),
    repo.getSummary(p, employeeId, year, month),
  ]);
  return { records, summary, year, month };
}

module.exports = { getAttendance };
