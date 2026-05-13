'use strict';

/**
 * Find all assets for a tenant
 */
async function findAll(pool) {
  const { rows } = await pool.query(`
    SELECT 
      a.*,
      ac.name as category_name,
      ac.icon as category_icon,
      ac.color as category_color,
      e.full_name as assigned_to_name,
      e.emp_id as assigned_to_code
    FROM assets a
    LEFT JOIN asset_categories ac ON ac.id = a.category_id
    LEFT JOIN employees e ON e.id = a.employee_id
    ORDER BY a.created_at DESC
  `);
  return rows.map(r => ({
    ...r,
    type: r.category_name || r.type,
    categoryName: r.category_name,
    categoryIcon: r.category_icon,
    categoryColor: r.category_color,
    assignedTo: r.assigned_to_name ? `${r.assigned_to_name} (${r.assigned_to_code})` : '-',
    serial: r.serial_number
  }));
}

/**
 * Find asset by ID
 */
async function findById(pool, id) {
  const { rows } = await pool.query(`
    SELECT 
      a.*, 
      ac.name as category_name,
      ac.icon as category_icon,
      ac.color as category_color,
      e.full_name as assigned_to_name, 
      e.emp_id as assigned_to_code,
      e.work_email
    FROM assets a
    LEFT JOIN asset_categories ac ON ac.id = a.category_id
    LEFT JOIN employees e ON e.id = a.employee_id
    WHERE a.id = $1
  `, [id]);
  return rows[0] || null;
}

/**
 * Create asset
 */
async function create(pool, data) {
  const { assetId, type, categoryId, serialNumber, employeeId, condition, status, issueDate, notes } = data;
  const { rows } = await pool.query(`
    INSERT INTO assets (asset_id, type, category_id, serial_number, employee_id, condition, status, issue_date, notes)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
  `, [assetId, type, categoryId || null, serialNumber, employeeId || null, condition || 'Good', status || 'Available', issueDate || null, notes]);
  return rows[0];
}

/**
 * Update asset
 */
async function update(pool, id, data) {
  const { type, categoryId, serialNumber, employeeId, condition, status, issueDate, notes } = data;
  const { rows } = await pool.query(`
    UPDATE assets
    SET 
      type = COALESCE($2, type),
      category_id = COALESCE($3, category_id),
      serial_number = COALESCE($4, serial_number),
      employee_id = $5,
      condition = COALESCE($6, condition),
      status = COALESCE($7, status),
      issue_date = $8,
      notes = COALESCE($9, notes),
      updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `, [id, type, categoryId, serialNumber, employeeId, condition, status, issueDate, notes]);
  return rows[0] || null;
}

/**
 * Delete asset
 */
async function remove(pool, id) {
  const { rowCount } = await pool.query('DELETE FROM assets WHERE id = $1', [id]);
  return rowCount > 0;
}

module.exports = {
  findAll,
  findById,
  create,
  update,
  remove
};
