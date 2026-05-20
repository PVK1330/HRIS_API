'use strict';

const DEFAULT_AUDIENCE = { type: 'all', departmentIds: [], roleIds: [], newJoinersDays: 90 };

function parseAudienceConfig(raw) {
  if (!raw) return { ...DEFAULT_AUDIENCE };
  if (typeof raw === 'object') return { ...DEFAULT_AUDIENCE, ...raw };
  try {
    return { ...DEFAULT_AUDIENCE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_AUDIENCE };
  }
}

function audienceLabel(config) {
  const c = parseAudienceConfig(config);
  switch (c.type) {
    case 'departments':
      return 'Specific departments';
    case 'roles':
      return 'Specific roles';
    case 'new_joiners':
      return 'New joiners only';
    default:
      return 'All employees';
  }
}

/**
 * Returns { clause, params } for SQL WHERE fragment on employee alias `e`.
 * @param {object} config
 * @param {number} paramStart - next $n index (1-based)
 */
function buildAudienceWhere(config, paramStart = 2) {
  const c = parseAudienceConfig(config);
  const params = [];
  let i = paramStart;

  if (c.type === 'all') {
    return { clause: 'TRUE', params };
  }

  if (c.type === 'departments') {
    const ids = (c.departmentIds || []).map(Number).filter(Boolean);
    if (!ids.length) return { clause: 'FALSE', params };
    params.push(ids);
    return { clause: `(e.department_id = ANY($${i}::int[]))`, params };
  }

  if (c.type === 'roles') {
    const ids = (c.roleIds || []).map(Number).filter(Boolean);
    if (!ids.length) return { clause: 'FALSE', params };
    params.push(ids);
    return { clause: `(e.rbac_role_id = ANY($${i}::int[]))`, params };
  }

  if (c.type === 'new_joiners') {
    const days = Math.max(1, parseInt(c.newJoinersDays, 10) || 90);
    params.push(days);
    return {
      clause: `(e.join_date IS NOT NULL AND e.join_date >= (CURRENT_DATE - ($${i}::int * INTERVAL '1 day')))`,
      params,
    };
  }

  return { clause: 'TRUE', params };
}

/**
 * Whether a single employee row matches publish audience (in-app checks).
 */
function employeeMatchesAudience(employee, config) {
  if (!employee) return false;
  const c = parseAudienceConfig(config);
  if (c.type === 'all') return true;

  if (c.type === 'departments') {
    const ids = (c.departmentIds || []).map(Number).filter(Boolean);
    if (!ids.length) return false;
    return ids.includes(Number(employee.department_id));
  }

  if (c.type === 'roles') {
    const ids = (c.roleIds || []).map(Number).filter(Boolean);
    if (!ids.length) return false;
    return ids.includes(Number(employee.rbac_role_id));
  }

  if (c.type === 'new_joiners') {
    const days = Math.max(1, parseInt(c.newJoinersDays, 10) || 90);
    if (!employee.join_date) return false;
    const join = new Date(employee.join_date);
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - days);
    join.setHours(0, 0, 0, 0);
    return join >= cutoff;
  }

  return false;
}

module.exports = {
  DEFAULT_AUDIENCE,
  parseAudienceConfig,
  audienceLabel,
  buildAudienceWhere,
  employeeMatchesAudience,
};
