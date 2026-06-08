'use strict';

const { getTenantPool } = require('../../../config/db');
const ApiError = require('../../../utils/ApiError');
const { ensureMigrated } = require('../../../utils/tenantMigration');
const empRepo = require('../employees.repository');
const repo = require('./assets.repository');

function pool(user) {
  if (!user?.db_name) throw ApiError.unauthorized('Tenant not found');
  return getTenantPool(user.db_name);
}

async function getAssets(user, employeeId) {
  const p = pool(user);
  await ensureMigrated(user.db_name);
  const emp = await empRepo.findById(p, employeeId);
  if (!emp) throw ApiError.notFound('Employee not found');

  const [assets, counts] = await Promise.all([
    repo.findByEmployee(p, employeeId),
    repo.countByEmployee(p, employeeId),
  ]);
  return { assets, counts };
}

module.exports = { getAssets };
