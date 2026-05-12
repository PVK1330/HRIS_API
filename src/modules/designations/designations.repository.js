'use strict';

async function findAllPaginated(
  pool,
  {
    search = '',
    status = 'all',
    departmentId = '',
    departmentName = '',
    page = 1,
    limit = 20,
  } = {},
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
      `(ds.name ILIKE $${i} OR COALESCE(ds.description, '') ILIKE $${i} OR d.name ILIKE $${i})`,
    );
    i += 1;
  }
  if (status === 'active') conditions.push('ds.is_active = true');
  else if (status === 'inactive') conditions.push('ds.is_active = false');

  if (departmentId) {
    params.push(parseInt(departmentId, 10));
    conditions.push(`ds.department_id = $${i}`);
    i += 1;
  } else if (departmentName) {
    params.push(departmentName);
    conditions.push(`d.name = $${i}`);
    i += 1;
  }

  const where = conditions.join(' AND ');

  const countParams = [...params];
  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM designations ds
     LEFT JOIN departments d ON d.id = ds.department_id
     WHERE ${where}`,
    countParams,
  );
  const total = countRows[0]?.total ?? 0;

  params.push(safeLimit, offset);
  const lim = params.length - 1;
  const off = params.length;
  const { rows } = await pool.query(
    `SELECT
       ds.id,
       ds.name,
       ds.description,
       ds.department_id,
       d.name AS department_name,
       ds.is_active
     FROM designations ds
     LEFT JOIN departments d ON d.id = ds.department_id
     WHERE ${where}
     ORDER BY ds.name ASC
     LIMIT $${lim} OFFSET $${off}`,
    params,
  );

  return {
    rows: rows.map((r) => ({
      ...r,
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
      ds.id,
      ds.name,
      ds.description,
      ds.department_id,
      d.name AS department_name,
      ds.is_active
    FROM designations ds
    LEFT JOIN departments d ON d.id = ds.department_id
    WHERE ds.id = $1
  `,
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  return { ...r, status: r.is_active ? 'Active' : 'Inactive' };
}

async function findActiveByDepartmentName(pool, deptName) {
  const { rows } = await pool.query(
    `
    SELECT ds.id, ds.name, ds.description, ds.department_id, d.name AS department_name, ds.is_active
    FROM designations ds
    INNER JOIN departments d ON d.id = ds.department_id
    WHERE ds.is_active = true AND d.is_active = true AND d.name = $1
    ORDER BY ds.name ASC
  `,
    [deptName],
  );
  return rows.map((r) => ({
    ...r,
    status: 'Active',
  }));
}

async function create(pool, data) {
  const { name, departmentId, isActive, description } = data;
  const { rows } = await pool.query(
    `
    INSERT INTO designations (name, department_id, is_active, description)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `,
    [name, departmentId, isActive !== false, description || null],
  );
  return rows[0];
}

async function update(pool, id, data) {
  const fields = [];
  const params = [];
  let n = 1;

  if (Object.prototype.hasOwnProperty.call(data, "name") && data.name !== undefined) {
    params.push(data.name);
    fields.push(`name = $${n++}`);
  }
  if (
    Object.prototype.hasOwnProperty.call(data, "departmentId") &&
    data.departmentId !== undefined
  ) {
    params.push(data.departmentId);
    fields.push(`department_id = $${n++}`);
  }
  if (
    Object.prototype.hasOwnProperty.call(data, "isActive") &&
    data.isActive !== undefined
  ) {
    params.push(data.isActive);
    fields.push(`is_active = $${n++}`);
  }
  if (Object.prototype.hasOwnProperty.call(data, "description")) {
    params.push(data.description);
    fields.push(`description = $${n++}`);
  }

  if (!fields.length) return findById(pool, id);

  fields.push("updated_at = NOW()");
  params.push(id);
  const idParam = n;
  const { rows } = await pool.query(
    `UPDATE designations SET ${fields.join(", ")} WHERE id = $${idParam} RETURNING *`,
    params,
  );
  return rows[0] || null;
}

async function softDeactivate(pool, id) {
  const { rowCount } = await pool.query(
    `UPDATE designations SET is_active = false, updated_at = NOW() WHERE id = $1`,
    [id],
  );
  return rowCount > 0;
}

module.exports = {
  findAllPaginated,
  findById,
  findActiveByDepartmentName,
  create,
  update,
  softDeactivate,
};
