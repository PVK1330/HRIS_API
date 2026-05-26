'use strict';

const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');

const SORT_COL = {
  created_at: 'tt.created_at',
  updated_at: 'tt.updated_at',
  name: 'tt.name',
  sort_order: 'tt.sort_order',
};

function normalizeListStatus(raw) {
  let s = (raw || 'all').toString().toLowerCase();
  if (!['all', 'active', 'inactive'].includes(s)) s = 'all';
  return s;
}

function buildWhereClause(query) {
  const conditions = ['1=1'];
  const params = [];
  let i = 1;

  const search = (query.search || '').trim();
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(tt.name ILIKE $${i} OR COALESCE(tt.description, '') ILIKE $${i})`);
    i += 1;
  }

  const status = normalizeListStatus(query.status);
  if (status === 'active') conditions.push('tt.is_active = true');
  else if (status === 'inactive') conditions.push('tt.is_active = false');

  return { where: conditions.join(' AND '), params, nextIndex: i };
}

async function listTerminationTypes(tenant, query = {}) {
  const pool = await getTenantPool(tenant.dbName);
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 10));
  const offset = (page - 1) * limit;
  const sortBy = SORT_COL[query.sortBy] ? query.sortBy : 'sort_order';
  const sortOrder = String(query.sortOrder || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  const { where, params } = buildWhereClause(query);

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM termination_types tt WHERE ${where}`,
    [...params],
  );
  const total = countRows[0]?.total ?? 0;

  const dataParams = [...params, limit, offset];
  const lim = dataParams.length - 1;
  const off = dataParams.length;
  const { rows } = await pool.query(
    `SELECT tt.id, tt.name, tt.description, tt.is_active, tt.sort_order,
            tt.created_at, tt.updated_at
     FROM termination_types tt
     WHERE ${where}
     ORDER BY ${SORT_COL[sortBy]} ${sortOrder}, tt.id ASC
     LIMIT $${lim} OFFSET $${off}`,
    dataParams,
  );

  return {
    records: rows.map((r) => ({ ...r, status: r.is_active ? 'Active' : 'Inactive' })),
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
        sortBy,
        sortOrder: sortOrder.toLowerCase(),
      },
      options: {
        statuses: [
          { value: 'active', label: 'Active' },
          { value: 'inactive', label: 'Inactive' },
          { value: 'all', label: 'All' },
        ],
      },
    },
  };
}

async function getTerminationType(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `SELECT id, name, description, is_active, sort_order, created_at, updated_at
     FROM termination_types WHERE id = $1`,
    [id],
  );
  const r = rows[0];
  if (!r) throw ApiError.notFound('Termination type not found');
  return { ...r, status: r.is_active ? 'Active' : 'Inactive' };
}

async function createTerminationType(tenant, data) {
  const pool = await getTenantPool(tenant.dbName);
  const isActive = data.is_active !== undefined ? data.is_active : data.isActive !== undefined ? data.isActive : true;
  const { rows } = await pool.query(
    `INSERT INTO termination_types (name, description, is_active, sort_order)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [
      data.name.trim(),
      data.description || null,
      isActive,
      data.sort_order || 0,
    ],
  );
  return getTerminationType(tenant, rows[0].id);
}

async function updateTerminationType(tenant, id, data) {
  const pool = await getTenantPool(tenant.dbName);
  const fields = [];
  const params = [];
  let n = 1;

  if (data.name !== undefined) {
    params.push(data.name.trim());
    fields.push(`name = $${n++}`);
  }
  if (data.description !== undefined) {
    params.push(data.description);
    fields.push(`description = $${n++}`);
  }
  const activeVal = data.is_active !== undefined ? data.is_active : data.isActive;
  if (activeVal !== undefined) {
    params.push(activeVal);
    fields.push(`is_active = $${n++}`);
  }
  if (data.sort_order !== undefined) {
    params.push(data.sort_order);
    fields.push(`sort_order = $${n++}`);
  }

  if (!fields.length) return getTerminationType(tenant, id);

  fields.push('updated_at = NOW()');
  params.push(id);
  const { rows } = await pool.query(
    `UPDATE termination_types SET ${fields.join(', ')} WHERE id = $${n} RETURNING id`,
    params,
  );
  if (!rows.length) throw ApiError.notFound('Termination type not found');
  return getTerminationType(tenant, id);
}

async function deleteTerminationType(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const { rowCount } = await pool.query(
    `UPDATE termination_types SET is_active = false, updated_at = NOW() WHERE id = $1`,
    [id],
  );
  if (!rowCount) throw ApiError.notFound('Termination type not found');
  return true;
}

/* ------------------------------------------------------------------ */
/*  Clearance Task Templates                                           */
/* ------------------------------------------------------------------ */

async function listClearanceTemplates(tenant, query = {}) {
  const pool = await getTenantPool(tenant.dbName);
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 50));
  const offset = (page - 1) * limit;

  const conditions = ['1=1'];
  const params = [];
  let i = 1;

  const search = (query.search || '').trim();
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(ct.task_name ILIKE $${i} OR ct.department ILIKE $${i})`);
    i += 1;
  }

  const status = normalizeListStatus(query.status);
  if (status === 'active') conditions.push('ct.is_active = true');
  else if (status === 'inactive') conditions.push('ct.is_active = false');

  const where = conditions.join(' AND ');

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM clearance_task_templates ct WHERE ${where}`,
    [...params],
  );
  const total = countRows[0]?.total ?? 0;

  const dataParams = [...params, limit, offset];
  const lim = dataParams.length - 1;
  const off = dataParams.length;
  const { rows } = await pool.query(
    `SELECT ct.id, ct.department, ct.task_name, ct.sort_order, ct.is_active,
            ct.created_at, ct.updated_at
     FROM clearance_task_templates ct
     WHERE ${where}
     ORDER BY ct.sort_order ASC, ct.id ASC
     LIMIT $${lim} OFFSET $${off}`,
    dataParams,
  );

  return {
    records: rows.map((r) => ({ ...r, status: r.is_active ? 'Active' : 'Inactive' })),
    pagination: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

async function getClearanceTemplate(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `SELECT * FROM clearance_task_templates WHERE id = $1`, [id],
  );
  if (!rows[0]) throw ApiError.notFound('Clearance task template not found');
  return { ...rows[0], status: rows[0].is_active ? 'Active' : 'Inactive' };
}

async function createClearanceTemplate(tenant, data) {
  const pool = await getTenantPool(tenant.dbName);
  const isActive = data.is_active !== undefined ? data.is_active : data.isActive !== undefined ? data.isActive : true;
  const { rows } = await pool.query(
    `INSERT INTO clearance_task_templates (department, task_name, sort_order, is_active)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [data.department.trim(), data.task_name.trim(), data.sort_order || 0, isActive],
  );
  return getClearanceTemplate(tenant, rows[0].id);
}

async function updateClearanceTemplate(tenant, id, data) {
  const pool = await getTenantPool(tenant.dbName);
  const fields = [];
  const params = [];
  let n = 1;

  if (data.department !== undefined) { params.push(data.department.trim()); fields.push(`department = $${n++}`); }
  if (data.task_name !== undefined) { params.push(data.task_name.trim()); fields.push(`task_name = $${n++}`); }
  if (data.sort_order !== undefined) { params.push(data.sort_order); fields.push(`sort_order = $${n++}`); }
  const activeVal = data.is_active !== undefined ? data.is_active : data.isActive;
  if (activeVal !== undefined) { params.push(activeVal); fields.push(`is_active = $${n++}`); }

  if (!fields.length) return getClearanceTemplate(tenant, id);

  fields.push('updated_at = NOW()');
  params.push(id);
  const { rows } = await pool.query(
    `UPDATE clearance_task_templates SET ${fields.join(', ')} WHERE id = $${n} RETURNING id`,
    params,
  );
  if (!rows.length) throw ApiError.notFound('Clearance task template not found');
  return getClearanceTemplate(tenant, id);
}

async function deleteClearanceTemplate(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const { rowCount } = await pool.query(
    `DELETE FROM clearance_task_templates WHERE id = $1`, [id],
  );
  if (!rowCount) throw ApiError.notFound('Clearance task template not found');
  return true;
}

async function getActiveClearanceTemplates(tenant) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `SELECT department, task_name, sort_order
     FROM clearance_task_templates
     WHERE is_active = true
     ORDER BY sort_order ASC, id ASC`,
  );
  return rows;
}

module.exports = {
  listTerminationTypes,
  getTerminationType,
  createTerminationType,
  updateTerminationType,
  deleteTerminationType,
  listClearanceTemplates,
  getClearanceTemplate,
  createClearanceTemplate,
  updateClearanceTemplate,
  deleteClearanceTemplate,
  getActiveClearanceTemplates,
};
