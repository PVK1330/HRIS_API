'use strict';

const { getTenantPool } = require('../config/db');
const ApiError = require('../utils/ApiError');
const { assertEmployeeRecordAccess } = require('../utils/applyDataScope');

/**
 * Ensure :employeeId (or custom param) is visible under req.auth data scope.
 */
function requireEmployeeScopeAccess(paramName = 'employeeId') {
  return async function employeeScopeGuard(req, _res, next) {
    try {
      const auth = req.auth;
      if (!auth || auth.scope === 'ALL' || auth.isTenantAdmin) {
        return next();
      }

      const rawId = req.params[paramName];
      const employeeId = parseInt(String(rawId), 10);
      if (!Number.isInteger(employeeId) || employeeId < 1) {
        return next(ApiError.badRequest('Invalid employee id'));
      }

      const dbName = req.user?.db_name;
      if (!dbName) {
        return next(ApiError.unauthorized('Tenant database not found in token'));
      }

      const pool = getTenantPool(dbName);
      const { rows } = await pool.query(
        `SELECT id, department, reporting_manager_id
         FROM employees
         WHERE id = $1 AND deleted_at IS NULL
         LIMIT 1`,
        [employeeId],
      );
      if (!rows.length) {
        return next(ApiError.notFound('Employee not found'));
      }

      assertEmployeeRecordAccess(auth, rows[0]);
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { requireEmployeeScopeAccess };
