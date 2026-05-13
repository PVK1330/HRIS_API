'use strict';

const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');

const SORT = {
  name: 'vt.name',
  created_at: 'vt.created_at',
  status: 'vt.status',
};

function normalizeStatusQuery(raw) {
  const s = (raw || 'all').toString().toLowerCase();
  if (['active', 'inactive', 'all'].includes(s)) return s;
  return 'all';
}

function payloadStatus(data) {
  const c = data.status ?? data.is_active;
  if (c === undefined || c === null) return { is_active: true, status: 'active' };
  if (typeof c === 'boolean') return { is_active: c, status: c ? 'active' : 'inactive' };
  const n = String(c).toLowerCase();
  if (n === 'active' || n === 'true') return { is_active: true, status: 'active' };
  if (n === 'inactive' || n === 'false') return { is_active: false, status: 'inactive' };
  throw new ApiError(400, 'status must be active or inactive');
}

async function assertUniqueName(pool, name, excludeId = null) {
  const params = [name.trim().toLowerCase()];
  let sql = `SELECT id FROM visa_types WHERE LOWER(name) = $1`;
  if (excludeId) {
    sql += ` AND id <> $2`;
    params.push(excludeId);
  }
  const { rows } = await pool.query(sql, params);
  if (rows.length) throw new ApiError(409, 'Visa type name already exists');
}

async function listVisaTypes(tenant, query = {}) {
  const pool = await getTenantPool(tenant.dbName);
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(query.limit, 10) || 50));
  const offset = (page - 1) * limit;
  const st = normalizeStatusQuery(query.status);
  const search = (query.search || '').trim();
  const sortBy = SORT[query.sortBy] ? query.sortBy : 'name';
  const sortOrder = String(query.sortOrder || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  const cond = ['1=1'];
  const params = [];
  let i = 1;
  if (st === 'active') cond.push('vt.is_active = true');
  else if (st === 'inactive') cond.push('vt.is_active = false');
  if (search) {
    params.push(`%${search}%`);
    cond.push(`(vt.name ILIKE $${i} OR COALESCE(vt.description, '') ILIKE $${i})`);
    i += 1;
  }
  const where = cond.join(' AND ');
  const countParams = [...params];
  const { rows: c } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM visa_types vt WHERE ${where}`,
    countParams,
  );
  const total = c[0]?.total ?? 0;
  params.push(limit, offset);
  const lim = params.length - 1;
  const off = params.length;
  const { rows } = await pool.query(
    `SELECT vt.* FROM visa_types vt
     WHERE ${where}
     ORDER BY ${SORT[sortBy]} ${sortOrder}, vt.id ASC
     LIMIT $${lim} OFFSET $${off}`,
    params,
  );
  return {
    records: rows.map((r) => ({
      ...r,
      statusLabel: r.is_active ? 'Active' : 'Inactive',
    })),
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

async function getVisaType(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(`SELECT * FROM visa_types WHERE id = $1`, [id]);
  if (!rows[0]) throw new ApiError(404, 'Visa type not found');
  return rows[0];
}

async function createVisaType(tenant, data, userId) {
  const pool = await getTenantPool(tenant.dbName);
  await assertUniqueName(pool, data.name);
  const { is_active, status } = payloadStatus(data);
  const { rows } = await pool.query(
    `INSERT INTO visa_types (name, description, is_active, status, created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [data.name.trim(), data.description ?? null, is_active, status, userId || null],
  );
  return rows[0];
}

async function updateVisaType(tenant, id, data) {
  const pool = await getTenantPool(tenant.dbName);
  if (data.name) await assertUniqueName(pool, data.name, id);
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
  if (data.status !== undefined || data.is_active !== undefined) {
    const { is_active, status } = payloadStatus(data);
    params.push(is_active, status);
    fields.push(`is_active = $${n++}`, `status = $${n++}`);
  }
  if (!fields.length) return getVisaType(tenant, id);
  fields.push('updated_at = NOW()');
  params.push(id);
  const idPh = params.length;
  const { rows } = await pool.query(
    `UPDATE visa_types SET ${fields.join(', ')} WHERE id = $${idPh} RETURNING *`,
    params,
  );
  if (!rows[0]) throw new ApiError(404, 'Visa type not found');
  return rows[0];
}

async function deleteVisaType(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const { rowCount } = await pool.query(
    `UPDATE visa_types SET is_active = false, status = 'inactive', updated_at = NOW() WHERE id = $1`,
    [id],
  );
  if (!rowCount) throw new ApiError(404, 'Visa type not found');
  return true;
}

module.exports = {
  listVisaTypes,
  getVisaType,
  createVisaType,
  updateVisaType,
  deleteVisaType,
};
