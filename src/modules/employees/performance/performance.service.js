'use strict';

const { getTenantPool } = require('../../../config/db');
const ApiError = require('../../../utils/ApiError');
const { ensureMigrated } = require('../../../utils/tenantMigration');
const empRepo = require('../employees.repository');
const { assertEmployeeRecordAccess } = require('../../../utils/applyDataScope');
const repo = require('./performance.repository');

function pool(user) {
  if (!user?.db_name) throw ApiError.unauthorized('Tenant not found');
  return getTenantPool(user.db_name);
}

async function getPerformance(user, employeeId, auth) {
  const p = pool(user);
  await ensureMigrated(user.db_name);
  const emp = await empRepo.findById(p, employeeId);
  if (!emp) throw ApiError.notFound('Employee not found');
  if (auth) assertEmployeeRecordAccess(auth, emp);

  const [reviews, latest] = await Promise.all([
    repo.findByEmployee(p, employeeId),
    repo.getLatestRating(p, employeeId),
  ]);
  return { reviews, latest };
}

module.exports = { getPerformance };
