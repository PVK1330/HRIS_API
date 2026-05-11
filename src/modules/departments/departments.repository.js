'use strict';

/**
 * Find all departments for a tenant
 */
async function findAll(pool) {
  const { rows } = await pool.query(`
    SELECT 
      d.id, 
      d.name, 
      d.code, 
      d.description, 
      d.is_active,
      (SELECT COUNT(*) FROM employees WHERE department_id = d.id) as employee_count
    FROM departments d
    ORDER BY d.name ASC
  `);
  return rows.map(r => ({
    ...r,
    employeeCount: parseInt(r.employee_count, 10),
    status: r.is_active ? 'Active' : 'Inactive'
  }));
}

/**
 * Find a department by ID
 */
async function findById(pool, id) {
  const { rows } = await pool.query(`
    SELECT d.*
    FROM departments d
    WHERE d.id = $1
  `, [id]);
  return rows[0] || null;
}

/**
 * Get manager options from employees table
 */
async function findManagerOptions(pool) {
  const { rows } = await pool.query(`
    SELECT e.id, e.full_name
    FROM employees e
    WHERE e.deleted_at IS NULL
    ORDER BY e.full_name ASC
  `);

  return rows.map((r) => ({
    id: r.id,
    name: r.full_name
  }));
}

/**
 * Create a new department
 */
async function create(pool, data) {
  const { name, code, description, isActive } = data;
  const { rows } = await pool.query(`
    INSERT INTO departments (name, code, description, is_active)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `, [name, code, description, isActive !== false]);
  return rows[0];
}

/**
 * Update an existing department
 */
async function update(pool, id, data) {
  const { name, code, description, isActive } = data;
  const { rows } = await pool.query(`
    UPDATE departments
    SET 
      name = COALESCE($2, name),
      code = COALESCE($3, code),
      description = COALESCE($4, description),
      manager_id = COALESCE($5, manager_id),
      head_name = COALESCE($6, head_name),
      location = COALESCE($7, location),
      budget = COALESCE($8, budget),
      is_active = COALESCE($9, is_active),
      updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `, [id, name, code, description, isActive]);
  return rows[0] || null;
}

/**
 * Delete a department
 */
async function remove(pool, id) {
  const { rowCount } = await pool.query('DELETE FROM departments WHERE id = $1', [id]);
  return rowCount > 0;
}

module.exports = {
  findAll,
  findById,
  findManagerOptions,
  create,
  update,
  remove
};
