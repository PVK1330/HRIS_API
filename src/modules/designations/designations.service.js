'use strict';

const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const notify = require('../notifications/notifications.service');

const SORT_COL = {
  created_at: 'ds.created_at',
  updated_at: 'ds.updated_at',
  name: 'ds.name',
  grade: 'ds.grade',
  department_name: 'd.name',
};

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

function mapRow(r) {
  return {
    ...r,
    employeeCount: parseInt(r.employee_count, 10) || 0,
    status: r.is_active ? 'Active' : 'Inactive',
  };
}

function empCountSql() {
  return `(
    SELECT COUNT(*)::int FROM employees e
    WHERE e.deleted_at IS NULL
      AND e.job_title = ds.name
      AND (
        e.department_id = ds.department_id
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
      `(ds.name ILIKE $${i} OR COALESCE(ds.description, '') ILIKE $${i} OR COALESCE(d.name, '') ILIKE $${i})`,
    );
    i += 1;
  }

  const status = normalizeListStatus(query.status);
  if (status === 'active') conditions.push('ds.is_active = true');
  else if (status === 'inactive') conditions.push('ds.is_active = false');

  const departmentId = query.department_id ?? query.departmentId ?? '';
  if (departmentId !== undefined && departmentId !== null && String(departmentId).trim() !== '') {
    const n = parseInt(String(departmentId), 10);
    if (Number.isInteger(n) && n > 0) {
      params.push(n);
      conditions.push(`ds.department_id = $${i}`);
      i += 1;
    }
  }

  const departmentName = (query.department_name || query.departmentName || '').trim();
  if (departmentName) {
    params.push(`%${departmentName}%`);
    conditions.push(`d.name ILIKE $${i}`);
    i += 1;
  }

  const grade = (query.grade || '').trim();
  if (grade) {
    params.push(grade);
    conditions.push(`ds.grade = $${i}`);
    i += 1;
  }

  return { where: conditions.join(' AND '), params, nextIndex: i };
}

async function listDesignations(tenant, query = {}) {
  const pool = await getTenantPool(tenant.dbName);
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 10));
  const offset = (page - 1) * limit;
  const sortBy = SORT_COL[query.sortBy] ? query.sortBy : 'created_at';
  const sortOrder = String(query.sortOrder || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const { where, params } = buildWhereClause(query);
  const countParams = [...params];
  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM designations ds
     LEFT JOIN departments d ON d.id = ds.department_id
     WHERE ${where}`,
    countParams,
  );
  const total = countRows[0]?.total ?? 0;

  const dataParams = [...params, limit, offset];
  const lim = dataParams.length - 1;
  const off = dataParams.length;
  const { rows } = await pool.query(
    `SELECT
       ds.id,
       ds.name,
       ds.description,
       ds.department_id,
       d.name AS department_name,
       ds.grade,
       ds.is_active,
       ds.status,
       ds.created_at,
       ds.updated_at,
       ${empCountSql()} AS employee_count
     FROM designations ds
     LEFT JOIN departments d ON d.id = ds.department_id
     WHERE ${where}
     ORDER BY ${SORT_COL[sortBy]} ${sortOrder}, ds.id ASC
     LIMIT $${lim} OFFSET $${off}`,
    dataParams,
  );

  const [deptRows, gradeRows] = await Promise.all([
    pool.query(`SELECT id, name FROM departments WHERE is_active = true ORDER BY name ASC LIMIT 500`),
    pool.query(
      `SELECT DISTINCT grade FROM designations WHERE grade IS NOT NULL AND TRIM(grade) <> '' ORDER BY grade ASC LIMIT 200`,
    ),
  ]);

  return {
    records: rows.map(mapRow),
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
        department_id: query.department_id ?? query.departmentId ?? null,
        department_name: (query.department_name || query.departmentName || '').trim() || null,
        grade: (query.grade || '').trim() || null,
        sortBy,
        sortOrder: sortOrder.toLowerCase(),
      },
      options: {
        departments: deptRows.rows,
        grades: gradeRows.rows.map((g) => g.grade),
        statuses: [
          { value: 'active', label: 'Active' },
          { value: 'inactive', label: 'Inactive' },
          { value: 'all', label: 'All' },
        ],
      },
    },
  };
}

async function listAllForExport(tenant, query) {
  const pool = await getTenantPool(tenant.dbName);
  const sortBy = SORT_COL[query.sortBy] ? query.sortBy : 'created_at';
  const sortOrder = String(query.sortOrder || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const { where, params } = buildWhereClause(query);
  const { rows } = await pool.query(
    `SELECT
       ds.id,
       ds.name,
       ds.description,
       ds.department_id,
       d.name AS department_name,
       ds.grade,
       ds.is_active,
       ds.status,
       ds.created_at,
       ds.updated_at,
       ${empCountSql()} AS employee_count
     FROM designations ds
     LEFT JOIN departments d ON d.id = ds.department_id
     WHERE ${where}
     ORDER BY ${SORT_COL[sortBy]} ${sortOrder}, ds.id ASC`,
    params,
  );
  return rows;
}

async function getFilterOptions(tenant) {
  const pool = await getTenantPool(tenant.dbName);
  const [deptRows, gradeRows] = await Promise.all([
    pool.query(`SELECT id, name FROM departments WHERE is_active = true ORDER BY name ASC LIMIT 500`),
    pool.query(
      `SELECT DISTINCT grade FROM designations WHERE grade IS NOT NULL AND TRIM(grade) <> '' ORDER BY grade ASC LIMIT 200`,
    ),
  ]);
  return {
    departments: deptRows.rows,
    grades: gradeRows.rows.map((g) => g.grade),
    statuses: [
      { value: 'active', label: 'Active' },
      { value: 'inactive', label: 'Inactive' },
      { value: 'all', label: 'All' },
    ],
  };
}

async function listDesignationsByDepartmentName(tenant, deptName) {
  const pool = await getTenantPool(tenant.dbName);
  const name = String(deptName || '').trim();
  if (!name) throw new ApiError(400, 'Department name is required');
  const { rows } = await pool.query(
    `SELECT ds.id, ds.name, ds.description, ds.department_id,
            d.name AS department_name,
            ds.grade, ds.is_active
     FROM designations ds
     INNER JOIN departments d ON d.id = ds.department_id
     WHERE ds.is_active = true AND d.is_active = true AND d.name = $1
     ORDER BY ds.name ASC`,
    [name],
  );
  return rows.map((r) => ({ ...r, status: 'Active' }));
}

async function listDesignationsByDepartmentId(tenant, deptId) {
  const pool = await getTenantPool(tenant.dbName);
  const id = parseInt(deptId, 10);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'Valid department id is required');
  const { rows } = await pool.query(
    `SELECT ds.id, ds.name, ds.description, ds.department_id,
            d.name AS department_name,
            ds.grade, ds.is_active
     FROM designations ds
     INNER JOIN departments d ON d.id = ds.department_id
     WHERE ds.is_active = true AND d.is_active = true AND ds.department_id = $1
     ORDER BY ds.name ASC`,
    [id],
  );
  return rows.map((r) => ({ ...r, status: 'Active' }));
}

async function getDesignation(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `SELECT ds.*, d.name AS department_join_name,
            d.name AS department_name,
            ${empCountSql()} AS employee_count
     FROM designations ds
     LEFT JOIN departments d ON d.id = ds.department_id
     WHERE ds.id = $1`,
    [id],
  );
  const r = rows[0];
  if (!r) throw new ApiError(404, 'Designation not found');
  return mapRow(r);
}

async function createDesignation(tenant, data) {
  const pool = await getTenantPool(tenant.dbName);
  const st = normalizePayloadStatus(data, true);
  const departmentId = data.department_id ?? data.departmentId;
  const { rows: drows } = await pool.query(`SELECT id FROM departments WHERE id = $1`, [departmentId]);
  if (!drows.length) throw new ApiError(400, 'department_id does not exist');

  const grade = data.grade != null && String(data.grade).trim() !== '' ? String(data.grade).trim() : null;

  const { rows } = await pool.query(
    `INSERT INTO designations (name, department_id, department_name, grade, is_active, status, description, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id`,
    [
      data.name.trim(),
      departmentId,
      null,
      grade,
      st.is_active,
      st.status,
      data.description ?? null,
      data.createdBy ?? data.created_by ?? null,
    ],
  );

  notify.pushNotification(tenant, {
    forAdmin: true,
    title: `Designation Created: ${data.name.trim()}`,
    message: `A new designation "${data.name.trim()}" has been created.`,
    type: 'info',
    entityType: 'designation',
    entityId: rows[0].id,
    redirectUrl: '/admin/designations',
  }).catch(() => null);

  return getDesignation(tenant, rows[0].id);
}

async function updateDesignation(tenant, id, data) {
  const pool = await getTenantPool(tenant.dbName);
  const fields = [];
  const params = [];
  let n = 1;

  if (data.name !== undefined) {
    params.push(data.name.trim());
    fields.push(`name = $${n++}`);
  }
  const depRaw = data.department_id ?? data.departmentId;
  if (depRaw !== undefined) {
    const departmentId = parseInt(String(depRaw), 10);
    const { rows: drows } = await pool.query(`SELECT id FROM departments WHERE id = $1`, [departmentId]);
    if (!drows.length) throw new ApiError(400, 'department_id does not exist');
    params.push(departmentId);
    fields.push(`department_id = $${n++}`);
    params.push(null);
    fields.push(`department_name = $${n++}`);
  }
  if (data.description !== undefined) {
    params.push(data.description);
    fields.push(`description = $${n++}`);
  }
  if (data.grade !== undefined) {
    const g = data.grade != null && String(data.grade).trim() !== '' ? String(data.grade).trim() : null;
    params.push(g);
    fields.push(`grade = $${n++}`);
  }
  const st = normalizePayloadStatus(data, false);
  if (st) {
    params.push(st.is_active);
    fields.push(`is_active = $${n++}`);
    params.push(st.status);
    fields.push(`status = $${n++}`);
  }

  if (!fields.length) return getDesignation(tenant, id);

  fields.push('updated_at = NOW()');
  params.push(id);
  const { rows } = await pool.query(
    `UPDATE designations SET ${fields.join(', ')} WHERE id = $${n} RETURNING id`,
    params,
  );
  if (!rows.length) throw new ApiError(404, 'Designation not found');
  const result = await getDesignation(tenant, id);

  notify.pushNotification(tenant, {
    forAdmin: true,
    title: `Designation Updated: ${result.name}`,
    message: `The "${result.name}" designation has been updated.`,
    type: 'info',
    entityType: 'designation',
    entityId: id,
    redirectUrl: '/admin/designations',
  }).catch(() => null);

  return result;
}

async function deleteDesignation(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows: existingRows } = await pool.query(`SELECT name FROM designations WHERE id = $1`, [id]);
  const { rowCount } = await pool.query(`DELETE FROM designations WHERE id = $1`, [id]);
  if (!rowCount) throw new ApiError(404, 'Designation not found');

  notify.pushNotification(tenant, {
    forAdmin: true,
    title: `Designation Deleted: ${existingRows[0]?.name || 'Designation'}`,
    message: `The "${existingRows[0]?.name || 'designation'}" designation has been removed.`,
    type: 'warning',
    entityType: 'designation',
    entityId: id,
    redirectUrl: '/admin/designations',
  }).catch(() => null);

  return true;
}

module.exports = {
  listDesignations,
  listAllForExport,
  getFilterOptions,
  listDesignationsByDepartmentName,
  listDesignationsByDepartmentId,
  getDesignation,
  createDesignation,
  updateDesignation,
  deleteDesignation,
};
