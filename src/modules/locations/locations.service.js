'use strict';

const { getTenantPool } = require('../../config/db');

const SELECT_COLS = `
  id, name, code, address, city, state, country,
  latitude, longitude, radius_meters, timezone, status, description,
  created_at, updated_at
`;

async function listLocations(tenant, query = {}) {
  const pool = await getTenantPool(tenant.dbName);
  const { search = '', status = 'all', page = 1, limit = 200 } = query;

  const params = [];
  const conds = [];

  if (search) {
    params.push(`%${search}%`);
    conds.push(`(name ILIKE $${params.length} OR city ILIKE $${params.length} OR code ILIKE $${params.length})`);
  }
  if (status && status !== 'all') {
    params.push(status);
    conds.push(`status = $${params.length}`);
  }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  const { rows: [{ total }] } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM locations ${where}`,
    params
  );

  const offset = (Number(page) - 1) * Number(limit);
  params.push(Number(limit), offset);

  const { rows } = await pool.query(
    `SELECT ${SELECT_COLS} FROM locations ${where}
     ORDER BY name ASC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return { data: rows, total, page: Number(page), limit: Number(limit) };
}

async function getLocation(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLS} FROM locations WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function createLocation(tenant, data) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `INSERT INTO locations
       (name, code, address, city, state, country,
        latitude, longitude, radius_meters, timezone, status, description, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING ${SELECT_COLS}`,
    [
      data.name.trim(),
      data.code?.trim()        || null,
      data.address?.trim()     || null,
      data.city?.trim()        || null,
      data.state?.trim()       || null,
      data.country?.trim()     || 'India',
      data.latitude            ?? null,
      data.longitude           ?? null,
      data.radiusMeters        ?? 200,
      data.timezone            ?? 'Asia/Kolkata',
      data.status              ?? 'active',
      data.description?.trim() || null,
      data.createdBy           ?? null,
    ]
  );
  return rows[0];
}

async function updateLocation(tenant, id, data) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `UPDATE locations SET
       name          = COALESCE($1,  name),
       code          = $2,
       address       = $3,
       city          = $4,
       state         = $5,
       country       = COALESCE($6,  country),
       latitude      = $7,
       longitude     = $8,
       radius_meters = COALESCE($9,  radius_meters),
       timezone      = COALESCE($10, timezone),
       status        = COALESCE($11, status),
       description   = $12,
       updated_at    = NOW()
     WHERE id = $13
     RETURNING ${SELECT_COLS}`,
    [
      data.name?.trim()        ?? null,
      data.code?.trim()        ?? null,
      data.address?.trim()     ?? null,
      data.city?.trim()        ?? null,
      data.state?.trim()       ?? null,
      data.country?.trim()     ?? null,
      data.latitude            ?? null,
      data.longitude           ?? null,
      data.radiusMeters        ?? null,
      data.timezone            ?? null,
      data.status              ?? null,
      data.description?.trim() ?? null,
      id,
    ]
  );
  return rows[0] || null;
}

async function deleteLocation(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const { rowCount } = await pool.query('DELETE FROM locations WHERE id = $1', [id]);
  return rowCount > 0;
}

module.exports = { listLocations, getLocation, createLocation, updateLocation, deleteLocation };
