'use strict';

async function findAllPaginated(
  pool,
  { search = '', status = 'all', page = 1, limit = 20 } = {},
) {
  const safeLimit = Math.min(2000, Math.max(1, parseInt(limit, 10) || 20));
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const offset = (safePage - 1) * safeLimit;

  const conditions = ['1=1'];
  const params = [];
  let i = 1;

  if (search) {
    params.push(`%${search}%`);
    conditions.push(
      `(d.name ILIKE $${i} OR d.code ILIKE $${i} OR COALESCE(d.description, '') ILIKE $${i})`,
    );
    i += 1;
  }
  if (status === 'active') conditions.push('d.is_active = true');
  else if (status === 'inactive') conditions.push('d.is_active = false');

  const where = conditions.join(' AND ');

  const countParams = [...params];
  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM departments d WHERE ${where}`,
    countParams,
  );
  const total = countRows[0]?.total ?? 0;

  params.push(safeLimit, offset);
  const lim = params.length - 1;
  const off = params.length;
  const { rows } = await pool.query(
    `SELECT
       d.id,
       d.name,
       d.code,
       d.description,
       d.parent_id,
       d.manager_id,
       d.is_active,
       mgr.full_name AS head,
       (SELECT COUNT(*)::int FROM employees e WHERE e.deleted_at IS NULL AND e.department = d.name) AS employee_count
     FROM departments d
     LEFT JOIN employees mgr ON mgr.id = d.manager_id AND mgr.deleted_at IS NULL
     WHERE ${where}
     ORDER BY d.name ASC
     LIMIT $${lim} OFFSET $${off}`,
    params,
  );

  return {
    rows: rows.map((r) => ({
      ...r,
      employeeCount: parseInt(r.employee_count, 10) || 0,
      status: r.is_active ? 'Active' : 'Inactive',
    })),
    total,
    page: safePage,
    limit: safeLimit,
    pages: Math.max(1, Math.ceil(total / safeLimit)),
  };
}

async function findById(pool, id) {
  const { rows } = await pool.query(
    `
    SELECT
      d.*,
      mgr.full_name AS head,
      (SELECT COUNT(*)::int FROM employees e WHERE e.deleted_at IS NULL AND e.department = d.name) AS employee_count
    FROM departments d
    LEFT JOIN employees mgr ON mgr.id = d.manager_id AND mgr.deleted_at IS NULL
    WHERE d.id = $1
  `,
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    ...r,
    employeeCount: parseInt(r.employee_count, 10) || 0,
    status: r.is_active ? 'Active' : 'Inactive',
  };
}

async function create(pool, data) {
  const { name, code, description, isActive, managerId } = data;
  const { rows } = await pool.query(
    `
    INSERT INTO departments (name, code, description, is_active, manager_id)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `,
    [name, code, description, isActive !== false, managerId || null],
  );
  return rows[0];
}

async function update(pool, id, data) {
  const fields = [];
  const params = [];
  let n = 1;

  if (Object.prototype.hasOwnProperty.call(data, "name")) {
    params.push(data.name);
    fields.push(`name = $${n++}`);
  }
  if (Object.prototype.hasOwnProperty.call(data, "code")) {
    params.push(data.code);
    fields.push(`code = $${n++}`);
  }
  if (Object.prototype.hasOwnProperty.call(data, "description")) {
    params.push(data.description);
    fields.push(`description = $${n++}`);
  }
  if (Object.prototype.hasOwnProperty.call(data, "isActive")) {
    params.push(data.isActive);
    fields.push(`is_active = $${n++}`);
  }
  if (Object.prototype.hasOwnProperty.call(data, "managerId")) {
    params.push(data.managerId);
    fields.push(`manager_id = $${n++}`);
  }

  if (!fields.length) return findById(pool, id);

  fields.push("updated_at = NOW()");
  params.push(id);
  const idParam = n;
  const { rows } = await pool.query(
    `UPDATE departments SET ${fields.join(", ")} WHERE id = $${idParam} RETURNING *`,
    params,
  );
  return rows[0] || null;
}

async function softDeactivate(pool, id) {
  const { rowCount } = await pool.query(
    `UPDATE departments SET is_active = false, updated_at = NOW() WHERE id = $1 AND is_active = true`,
    [id],
  );
  if (rowCount > 0) return true;
  const { rowCount: rc2 } = await pool.query(
    `UPDATE departments SET is_active = false, updated_at = NOW() WHERE id = $1`,
    [id],
  );
  return rc2 > 0;
}

module.exports = {
  findAllPaginated,
  findById,
  create,
  update,
  softDeactivate,
};
