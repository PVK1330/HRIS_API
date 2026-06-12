'use strict';

const crypto = require('crypto');
const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const notify = require('../notifications/notifications.service');

const SORT_COL = {
  created_at: 'd.created_at',
  updated_at: 'd.updated_at',
  name: 'd.name',
  code: 'd.code',
  status: 'd.status',
};

// Upper bound on page size, kept in sync with the Joi listingQuery limit (max 1000).
const MAX_LIMIT = 1000;

function normalizeListStatus(raw) {
  let s = (raw || 'all').toString().toLowerCase();
  if (!['all', 'active', 'inactive'].includes(s)) s = 'all';
  return s;
}

function normalizePayloadStatus(data, required = false) {
  const cand = data.status ?? data.isActive ?? data.is_active;
  if (cand === undefined || cand === null || cand === '') {
    if (required) throw new ApiError(400, 'Status is required');
    return undefined;
  }
  if (typeof cand === 'boolean') {
    return { is_active: cand, status: cand ? 'active' : 'inactive' };
  }
  const n = String(cand).toLowerCase();
  if (n === 'active' || n === 'true') return { is_active: true, status: 'active' };
  if (n === 'inactive' || n === 'false') return { is_active: false, status: 'inactive' };
  throw new ApiError(400, 'Status must be active or inactive');
}

function buildDepartmentCode(name, suffix) {
  const prefix = String(name || '')
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');
  return `${prefix || 'DEP'}${suffix}`.slice(0, 20);
}

/**
 * Collision-resistant auto code: PREFIX + 6 random hex chars (~16.7M space),
 * re-rolled and DB-checked until unique. Replaces the old last-4-timestamp-digits
 * scheme (only 10k values, collided within the same ~10s window).
 */
async function generateUniqueDepartmentCode(pool, name) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const suffix = crypto.randomBytes(3).toString('hex').toUpperCase(); // 6 hex chars
    const code = buildDepartmentCode(name, suffix);
    const { rows } = await pool.query('SELECT 1 FROM departments WHERE code = $1', [code]);
    if (!rows.length) return code;
  }
  // Practically unreachable (8 random collisions): timestamp + random tail.
  const suffix = `${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`.toUpperCase();
  return buildDepartmentCode(name, suffix);
}

function mapRow(r) {
  return {
    ...r,
    employeeCount: parseInt(r.employee_count, 10) || 0,
    status: r.is_active ? 'Active' : 'Inactive',
  };
}

// Employees are linked to a department by department_id (FK). Counting on the
// department NAME (e.department = d.name) silently drops to 0 the moment a
// department is renamed — the FK still holds, but the string no longer matches.
// Count by id, falling back to the legacy name match only for rows that have not
// been backfilled with a department_id yet. Mirrors empCountSql() in
// designations.service.js so both stay consistent.
function deptEmpCountSql() {
  return `(
    SELECT COUNT(*)::int FROM employees e
    WHERE e.deleted_at IS NULL
      AND (
        e.department_id = d.id
        OR (e.department_id IS NULL AND e.department IS NOT DISTINCT FROM d.name)
      )
  )`;
}

function buildWhereClause(query) {
  const conditions = ['1=1'];
  const params = [];
  let i = 1;

  const search = (query.search || '').trim();
  if (search) {
    params.push(`%${search}%`);
    conditions.push(
      `(d.name ILIKE $${i} OR d.code ILIKE $${i} OR COALESCE(d.description, '') ILIKE $${i})`,
    );
    i += 1;
  }

  const status = normalizeListStatus(query.status);
  if (status === 'active') conditions.push('d.is_active = true');
  else if (status === 'inactive') conditions.push('d.is_active = false');

  const pid = query.parent_id;
  if (pid !== undefined && pid !== null && String(pid).trim() !== '') {
    const n = parseInt(String(pid), 10);
    if (Number.isInteger(n) && n > 0) {
      params.push(n);
      conditions.push(`d.parent_id = $${i}`);
      i += 1;
    }
  }

  return { where: conditions.join(' AND '), params, nextIndex: i };
}

async function assertUniqueDepartmentName(pool, name, excludeId = null) {
  const params = [name.trim()];
  let sql = `SELECT id FROM departments WHERE LOWER(name) = LOWER($1)`;
  if (excludeId) {
    sql += ` AND id <> $2`;
    params.push(excludeId);
  }
  const { rows } = await pool.query(sql, params);
  if (rows.length) throw new ApiError(409, 'Department name already exists');
}

async function assertUniqueDepartmentCode(pool, code, excludeId = null) {
  const c = String(code || '').trim();
  if (!c) return;
  const params = [c];
  let sql = `SELECT id FROM departments WHERE code = $1`;
  if (excludeId) {
    sql += ` AND id <> $2`;
    params.push(excludeId);
  }
  const { rows } = await pool.query(sql, params);
  if (rows.length) throw new ApiError(409, `Department code "${c}" already exists`);
}

async function assertParentExists(pool, parentId, selfId = null) {
  if (!parentId) return;
  const { rows } = await pool.query(`SELECT id FROM departments WHERE id = $1`, [parentId]);
  if (!rows.length) throw new ApiError(400, 'parent_id does not exist');
  if (selfId && parentId === selfId) throw new ApiError(400, 'Department cannot be its own parent');
}

// Same existence guarantee parent_id/department_id already get: a manager_id must
// point at a real, non-soft-deleted employee. Without this a phantom head could be
// stored and a non-existent employee notified. NaN/0/null short-circuit as "not set".
async function assertManagerExists(pool, managerId) {
  if (!managerId) return;
  const { rows } = await pool.query(
    `SELECT id FROM employees WHERE id = $1 AND deleted_at IS NULL`,
    [managerId],
  );
  if (!rows.length) throw new ApiError(400, 'manager_id does not exist or has been deleted');
}

async function listDepartments(tenant, query = {}) {
  const pool = await getTenantPool(tenant.dbName);
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  // Honour the requested limit up to a sane ceiling. The old Math.min(100, …)
  // silently clipped the client's limit=500 dropdown request to 100, so
  // designations could not be mapped to department #101+. MAX_LIMIT matches the
  // Joi listingQuery cap (max 1000) so a validated request is never re-clipped here.
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit, 10) || 10));
  const offset = (page - 1) * limit;
  const sortBy = SORT_COL[query.sortBy] ? query.sortBy : 'created_at';
  const sortOrder = String(query.sortOrder || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const { where, params } = buildWhereClause(query);
  const countParams = [...params];
  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM departments d WHERE ${where}`,
    countParams,
  );
  const total = countRows[0]?.total ?? 0;

  // KPI totals for the cards. Computed over the whole filtered set (not the current
  // page) and WITHOUT the status filter (status === 'all'), since the Active/Inactive
  // cards double as status filters and must always show the full breakdown.
  const statsScope = buildWhereClause({ ...query, status: 'all' });
  const { rows: statsRows } = await pool.query(
    `SELECT
       COUNT(*)::int                                            AS total,
       COUNT(*) FILTER (WHERE d.is_active = true)::int          AS active,
       COUNT(*) FILTER (WHERE d.is_active = false)::int         AS inactive,
       COUNT(*) FILTER (WHERE d.manager_id IS NOT NULL)::int    AS with_head
     FROM departments d
     WHERE ${statsScope.where}`,
    statsScope.params,
  );
  const s = statsRows[0] ?? {};
  const stats = {
    total: s.total ?? 0,
    active: s.active ?? 0,
    inactive: s.inactive ?? 0,
    assignedHeads: s.with_head ?? 0,
  };

  const dataParams = [...params, limit, offset];
  const lim = dataParams.length - 1;
  const off = dataParams.length;
  const { rows } = await pool.query(
    `SELECT
       d.id,
       d.name,
       d.code,
       d.description,
       d.parent_id,
       p.name AS parent_name,
       d.manager_id,
       d.manager_emp_id,
       d.is_active,
       d.status,
       d.created_at,
       d.updated_at,
       mgr.full_name AS head,
       ${deptEmpCountSql()} AS employee_count
     FROM departments d
     LEFT JOIN departments p ON p.id = d.parent_id
     LEFT JOIN employees mgr ON mgr.id = d.manager_id AND mgr.deleted_at IS NULL
     WHERE ${where}
     ORDER BY ${SORT_COL[sortBy]} ${sortOrder}, d.id ASC
     LIMIT $${lim} OFFSET $${off}`,
    dataParams,
  );

  const parentDepts = await pool.query(
    `SELECT id, name FROM departments WHERE is_active = true ORDER BY name ASC LIMIT 500`,
  );

  const statusOptions = [
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' },
    { value: 'all', label: 'All' },
  ];

  return {
    records: rows.map(mapRow),
    stats,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
    filters: {
      applied: {
        page,
        limit,
        search: (query.search || '').trim(),
        status: normalizeListStatus(query.status),
        parent_id: query.parent_id || null,
        sortBy,
        sortOrder: sortOrder.toLowerCase(),
      },
      options: {
        statuses: statusOptions,
        parentDepts: parentDepts.rows,
      },
    },
  };
}

async function listAllForExport(tenant, query) {
  const pool = await getTenantPool(tenant.dbName);
  const sortBy = SORT_COL[query.sortBy] ? query.sortBy : 'created_at';
  const sortOrder = String(query.sortOrder || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const orderSql = `${SORT_COL[sortBy]} ${sortOrder}, d.id ASC`;
  const { where, params } = buildWhereClause(query);
  const { rows } = await pool.query(
    `SELECT
       d.id,
       d.name,
       d.code,
       d.description,
       d.parent_id,
       p.name AS parent_name,
       d.manager_id,
       d.manager_emp_id,
       d.is_active,
       d.status,
       d.created_at,
       d.updated_at,
       mgr.full_name AS head,
       ${deptEmpCountSql()} AS employee_count
     FROM departments d
     LEFT JOIN departments p ON p.id = d.parent_id
     LEFT JOIN employees mgr ON mgr.id = d.manager_id AND mgr.deleted_at IS NULL
     WHERE ${where}
     ORDER BY ${SORT_COL[sortBy]} ${sortOrder}, d.id ASC`,
    params,
  );
  return rows;
}

async function getFilterOptions(tenant) {
  const pool = await getTenantPool(tenant.dbName);
  const [parentDepts] = await Promise.all([
    pool.query(`SELECT id, name FROM departments WHERE is_active = true ORDER BY name ASC LIMIT 500`),
  ]);
  return {
    statuses: [
      { value: 'active', label: 'Active' },
      { value: 'inactive', label: 'Inactive' },
      { value: 'all', label: 'All' },
    ],
    parentDepts: parentDepts.rows,
  };
}

// Head-of-Department picker. The old version returned every employee capped at a
// flat 500 with no search/paging/role filter, so in large tenants anyone past the
// first 500 (alphabetically) was simply unselectable. Now searchable + paginated,
// with an optional role filter, so any employee is reachable.
async function listDepartmentManagers(tenant, query = {}) {
  const pool = await getTenantPool(tenant.dbName);
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit, 10) || 50));
  const offset = (page - 1) * limit;

  const conditions = ['e.deleted_at IS NULL'];
  const params = [];
  let i = 1;

  const search = (query.search || query.q || '').trim();
  if (search) {
    params.push(`%${search}%`);
    conditions.push(
      `(e.full_name ILIKE $${i} OR e.emp_id ILIKE $${i} OR COALESCE(e.work_email, '') ILIKE $${i})`,
    );
    i += 1;
  }

  // Optional role filter: numeric → rbac_role_id, otherwise case-insensitive role name.
  const roleId = parseInt(String(query.roleId ?? query.role_id ?? ''), 10);
  if (Number.isInteger(roleId) && roleId > 0) {
    params.push(roleId);
    conditions.push(`e.rbac_role_id = $${i}`);
    i += 1;
  } else {
    const role = (query.role || '').trim();
    if (role) {
      params.push(role);
      conditions.push(`rr.name ILIKE $${i}`);
      i += 1;
    }
  }

  const where = conditions.join(' AND ');
  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM employees e
     LEFT JOIN rbac_roles rr ON rr.id = e.rbac_role_id
     WHERE ${where}`,
    params,
  );
  const total = countRows[0]?.total ?? 0;

  const dataParams = [...params, limit, offset];
  const { rows } = await pool.query(
    `SELECT e.id, e.full_name AS name, e.emp_id, rr.name AS role
     FROM employees e
     LEFT JOIN rbac_roles rr ON rr.id = e.rbac_role_id
     WHERE ${where}
     ORDER BY e.full_name ASC, e.id ASC
     LIMIT $${i} OFFSET $${i + 1}`,
    dataParams,
  );

  return {
    records: rows,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  };
}

async function getDepartment(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `SELECT
      d.*,
      p.name AS parent_name,
      mgr.full_name AS head,
      ${deptEmpCountSql()} AS employee_count
    FROM departments d
    LEFT JOIN departments p ON p.id = d.parent_id
    LEFT JOIN employees mgr ON mgr.id = d.manager_id AND mgr.deleted_at IS NULL
    WHERE d.id = $1`,
    [id],
  );
  const r = rows[0];
  if (!r) throw new ApiError(404, 'Department not found');
  return mapRow(r);
}

async function createDepartment(tenant, data) {
  const pool = await getTenantPool(tenant.dbName);
  const st = normalizePayloadStatus(data, true);
  const managerRaw = data.managerId ?? data.manager_id;
  const managerId =
    managerRaw !== undefined && managerRaw !== null && String(managerRaw).trim() !== ''
      ? parseInt(String(managerRaw), 10)
      : null;
  const parentId =
    data.parent_id !== undefined && data.parent_id !== null && String(data.parent_id).trim() !== ''
      ? parseInt(String(data.parent_id), 10)
      : null;

  await assertUniqueDepartmentName(pool, data.name);
  await assertParentExists(pool, parentId, null);
  await assertManagerExists(pool, Number.isInteger(managerId) && managerId > 0 ? managerId : null);

  // User-supplied code → validate uniqueness (409 on dup); else auto-generate a
  // collision-resistant unique one.
  let code = data.code && String(data.code).trim() ? String(data.code).trim() : null;
  if (code) {
    await assertUniqueDepartmentCode(pool, code);
  } else {
    code = await generateUniqueDepartmentCode(pool, data.name);
  }
  const managerEmpId =
    data.manager_emp_id != null && String(data.manager_emp_id).trim() !== ''
      ? String(data.manager_emp_id).trim().slice(0, 50)
      : null;

  const { rows } = await pool.query(
    `INSERT INTO departments (name, code, description, is_active, status, parent_id, manager_id, manager_emp_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      data.name.trim(),
      code,
      data.description ?? null,
      st.is_active,
      st.status,
      parentId,
      Number.isInteger(managerId) && managerId > 0 ? managerId : null,
      managerEmpId,
      data.createdBy ?? data.created_by ?? null,
    ],
  );

  notify.pushNotification(tenant, {
    forAdmin: true,
    title: `Department Created: ${data.name.trim()}`,
    message: `A new department "${data.name.trim()}" has been created.`,
    type: 'info',
    entityType: 'department',
    entityId: rows[0].id,
    redirectUrl: '/admin/departments',
  }).catch(() => null);

  if (Number.isInteger(managerId) && managerId > 0) {
    notify.sendSystemNotification(tenant, {
      employeeId: managerId,
      title: `You are now Manager of ${data.name.trim()}`,
      message: `You have been assigned as the manager of the "${data.name.trim()}" department.`,
      type: 'info',
      entityType: 'department',
      entityId: rows[0].id,
      redirectUrl: '/admin/departments',
      sendEmail: true,
    }).catch(() => null);
  }

  return getDepartment(tenant, rows[0].id);
}

async function updateDepartment(tenant, id, data) {
  const pool = await getTenantPool(tenant.dbName);
  if (data.name) await assertUniqueDepartmentName(pool, data.name, id);
  if (data.code !== undefined && String(data.code).trim() !== '') {
    await assertUniqueDepartmentCode(pool, data.code, id);
  }

  const parentId =
    data.parent_id !== undefined
      ? data.parent_id !== null && String(data.parent_id).trim() !== ''
        ? parseInt(String(data.parent_id), 10)
        : null
      : undefined;
  if (parentId !== undefined) await assertParentExists(pool, parentId, parseInt(id, 10));

  const fields = [];
  const params = [];
  let n = 1;

  if (data.name !== undefined) {
    params.push(data.name.trim());
    fields.push(`name = $${n++}`);
  }
  if (data.code !== undefined) {
    params.push(data.code);
    fields.push(`code = $${n++}`);
  }
  if (data.description !== undefined) {
    params.push(data.description);
    fields.push(`description = $${n++}`);
  }
  if (data.parent_id !== undefined) {
    params.push(parentId);
    fields.push(`parent_id = $${n++}`);
  }
  const st = normalizePayloadStatus(data, false);
  if (st) {
    params.push(st.is_active);
    fields.push(`is_active = $${n++}`);
    params.push(st.status);
    fields.push(`status = $${n++}`);
  }
  const managerRaw = data.managerId ?? data.manager_id;
  if (managerRaw !== undefined) {
    const managerId =
      managerRaw !== null && String(managerRaw).trim() !== ''
        ? parseInt(String(managerRaw), 10)
        : null;
    const normalizedManagerId = Number.isInteger(managerId) && managerId > 0 ? managerId : null;
    await assertManagerExists(pool, normalizedManagerId);
    params.push(normalizedManagerId);
    fields.push(`manager_id = $${n++}`);
  }
  if (data.manager_emp_id !== undefined) {
    const v =
      data.manager_emp_id != null && String(data.manager_emp_id).trim() !== ''
        ? String(data.manager_emp_id).trim().slice(0, 50)
        : null;
    params.push(v);
    fields.push(`manager_emp_id = $${n++}`);
  }

  if (!fields.length) return getDepartment(tenant, id);

  fields.push('updated_at = NOW()');
  params.push(id);
  const { rows } = await pool.query(
    `UPDATE departments SET ${fields.join(', ')} WHERE id = $${n} RETURNING id`,
    params,
  );
  if (!rows.length) throw new ApiError(404, 'Department not found');
  const result = await getDepartment(tenant, id);

  notify.pushNotification(tenant, {
    forAdmin: true,
    title: `Department Updated: ${result.name}`,
    message: `The "${result.name}" department has been updated.`,
    type: 'info',
    entityType: 'department',
    entityId: id,
    redirectUrl: '/admin/departments',
  }).catch(() => null);

  // Manager (re)assigned in this update → tell the new manager.
  if (managerRaw !== undefined && managerRaw !== null && String(managerRaw).trim() !== '') {
    const newManagerId = parseInt(String(managerRaw), 10);
    if (Number.isInteger(newManagerId) && newManagerId > 0) {
      notify.sendSystemNotification(tenant, {
        employeeId: newManagerId,
        title: `You are now Manager of ${result.name}`,
        message: `You have been assigned as the manager of the "${result.name}" department.`,
        type: 'info',
        entityType: 'department',
        entityId: id,
        redirectUrl: '/admin/departments',
        sendEmail: true,
      }).catch(() => null);
    }
  }

  return result;
}

async function deleteDepartment(tenant, id, opts = {}) {
  const pool = await getTenantPool(tenant.dbName);
  const force = opts.force === true || String(opts.force).toLowerCase() === 'true';

  const { rows: existingRows } = await pool.query(
    `SELECT name FROM departments WHERE id = $1`,
    [id],
  );
  if (!existingRows.length) throw new ApiError(404, 'Department not found');
  const deptName = existingRows[0].name;

  // Guard: this is a SOFT delete (is_active=false). The employees → departments FK
  // is ON DELETE SET NULL and the designations FK is ON DELETE CASCADE, but neither
  // fires on a soft UPDATE — so without a guard we'd silently archive a department
  // that still has live employees attached. Count by department_id (with the legacy
  // name fallback for un-backfilled rows) and block unless the caller confirms.
  const { rows: cntRows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM employees e
      WHERE e.deleted_at IS NULL
        AND (
          e.department_id = $1
          OR (e.department_id IS NULL AND e.department IS NOT DISTINCT FROM $2)
        )`,
    [id, deptName],
  );
  const assigned = cntRows[0]?.n ?? 0;
  if (assigned > 0 && !force) {
    throw new ApiError(
      409,
      `${assigned} employee${assigned === 1 ? ' is' : 's are'} still assigned to "${deptName}". ` +
        `Reassign them first, or confirm to archive the department anyway.`,
    );
  }

  // Soft-delete the department itself.
  await pool.query(
    `UPDATE departments SET is_active = false, status = 'inactive', updated_at = NOW() WHERE id = $1`,
    [id],
  );

  // Cascade the soft delete to designations. The designations.department_id FK is
  // ON DELETE CASCADE, but that only fires on a hard DELETE; on a soft UPDATE it
  // never runs, leaving designations active under an archived department. Deactivate
  // them here so state stays consistent. Only touch currently-active rows.
  const { rowCount: deactivatedDesignations } = await pool.query(
    `UPDATE designations
        SET is_active = false, status = 'inactive', updated_at = NOW()
      WHERE department_id = $1 AND is_active = true`,
    [id],
  );

  notify.pushNotification(tenant, {
    forAdmin: true,
    title: `Department Deleted: ${deptName || 'Department'}`,
    message:
      `The "${deptName || 'department'}" department has been deactivated` +
      (deactivatedDesignations
        ? ` along with ${deactivatedDesignations} designation${deactivatedDesignations === 1 ? '' : 's'}.`
        : '.'),
    type: 'warning',
    entityType: 'department',
    entityId: id,
    redirectUrl: '/admin/departments',
  }).catch(() => null);

  return { archived: true, employeesAssigned: assigned, deactivatedDesignations };
}

module.exports = {
  listDepartments,
  listAllForExport,
  getFilterOptions,
  listDepartmentManagers,
  getDepartment,
  createDepartment,
  updateDepartment,
  deleteDepartment,
};
