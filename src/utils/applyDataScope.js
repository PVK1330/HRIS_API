'use strict';

const ApiError = require('./ApiError');

/**
 * Build SQL fragments for employee row scope (alias configurable).
 * @returns {{ parts: string[], params: unknown[] }}
 */
function buildEmployeeScopeConditions(auth, alias = 'e') {
  if (!auth || auth.scope === 'ALL' || auth.isTenantAdmin) {
    return { parts: [], params: [] };
  }

  const parts = [];
  const params = [];
  const scope = String(auth.scope || 'SELF').toUpperCase();
  const a = alias;

  switch (scope) {
    case 'SELF':
      if (!auth.employeeId) parts.push('1 = 0');
      else {
        params.push(auth.employeeId);
        parts.push(`${a}.id = $${params.length}`);
      }
      break;
    case 'TEAM':
      if (!auth.employeeId) parts.push('1 = 0');
      else {
        params.push(auth.employeeId);
        parts.push(`${a}.reporting_manager_id = $${params.length}`);
      }
      break;
    case 'DEPARTMENT':
      if (!auth.department) parts.push('1 = 0');
      else {
        params.push(auth.department);
        parts.push(`${a}.department = $${params.length}`);
      }
      break;
    default:
      break;
  }

  return { parts, params };
}

/** Append scope AND-clauses to a condition list (reindexes placeholders). */
function appendScopeToConditions(auth, conditions, params, alias = 'e') {
  const { parts, params: scopeParams } = buildEmployeeScopeConditions(auth, alias);
  if (!parts.length) return { conditions, params };
  const offset = params.length;
  const remapped = parts.map((p) => {
    let s = p;
    for (let n = scopeParams.length; n >= 1; n -= 1) {
      s = s.replace(new RegExp(`\\$${n}\\b`, 'g'), `$${offset + n}`);
    }
    return s;
  });
  return {
    conditions: [...conditions, ...remapped],
    params: [...params, ...scopeParams],
  };
}

/**
 * Append employee row-level scope filters for list queries (alias `e`).
 */
function applyEmployeeListScope(auth, base) {
  const { parts, params: scopeParams } = buildEmployeeScopeConditions(auth, 'e');
  if (!parts.length) return base;

  const params = [...base.params, ...scopeParams];
  const offset = base.params.length;
  const remapped = parts.map((p) => {
    let s = p;
    for (let n = scopeParams.length; n >= 1; n -= 1) {
      s = s.replace(new RegExp(`\\$${n}\\b`, 'g'), `$${offset + n}`);
    }
    return s;
  });
  const extra = remapped.join(' AND ');
  const where = base.where.replace(/^WHERE /i, `WHERE ${extra} AND `);
  return { where, params };
}
/**
 * Ensure a single employee record is visible under the user's data scope.
 */
function assertEmployeeRecordAccess(auth, employeeRow) {
  if (!auth || auth.scope === 'ALL' || auth.isTenantAdmin) return;
  if (!employeeRow) throw ApiError.notFound('Employee not found');

  const scope = String(auth.scope || 'SELF').toUpperCase();
  const id = Number(employeeRow.id);

  switch (scope) {
    case 'SELF':
      if (Number(auth.employeeId) !== id) {
        throw ApiError.forbidden('You can only access your own employee record');
      }
      return;
    case 'TEAM':
      if (Number(employeeRow.reporting_manager_id) !== Number(auth.employeeId)) {
        throw ApiError.forbidden('You can only access your team members');
      }
      return;
    case 'DEPARTMENT':
      if (
        auth.department &&
        String(employeeRow.department || '').trim() !== String(auth.department).trim()
      ) {
        throw ApiError.forbidden('You can only access employees in your department');
      }
      return;
    default:
      return;
  }
}

module.exports = {
  buildEmployeeScopeConditions,
  appendScopeToConditions,
  applyEmployeeListScope,
  assertEmployeeRecordAccess,
};
