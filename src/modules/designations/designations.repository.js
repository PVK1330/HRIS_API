'use strict';

async function findAll(pool) {
  const { rows } = await pool.query(`
    SELECT
      ds.id,
      ds.name,
      ds.department_id,
      d.name AS department_name,
      ds.is_active
    FROM designations ds
    LEFT JOIN departments d ON d.id = ds.department_id
    ORDER BY ds.name ASC
  `);

  return rows.map((r) => ({
    ...r,
    status: r.is_active ? 'Active' : 'Inactive'
  }));
}

async function findById(pool, id) {
  const { rows } = await pool.query(`
    SELECT
      ds.id,
      ds.name,
      ds.department_id,
      d.name AS department_name,
      ds.is_active
    FROM designations ds
    LEFT JOIN departments d ON d.id = ds.department_id
    WHERE ds.id = $1
  `, [id]);
  return rows[0] || null;
}

async function create(pool, data) {
  const { name, departmentId, isActive } = data;
  const { rows } = await pool.query(`
    INSERT INTO designations (name, department_id, is_active)
    VALUES ($1, $2, $3)
    RETURNING *
  `, [name, departmentId, isActive !== false]);
  return rows[0];
}

async function update(pool, id, data) {
  const { name, departmentId, isActive } = data;
  const { rows } = await pool.query(`
    UPDATE designations
    SET
      name = COALESCE($2, name),
      department_id = COALESCE($3, department_id),
      is_active = COALESCE($4, is_active),
      updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `, [id, name, departmentId, isActive]);
  return rows[0] || null;
}

async function remove(pool, id) {
  const { rowCount } = await pool.query('DELETE FROM designations WHERE id = $1', [id]);
  return rowCount > 0;
}

module.exports = {
  findAll,
  findById,
  create,
  update,
  remove,
};
