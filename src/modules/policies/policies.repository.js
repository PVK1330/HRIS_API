'use strict';

async function findAll(pool, filters = {}) {
  const { category, status } = filters;
  const conditions = [];
  const params = [];

  if (category && category !== 'All Categories') {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }

  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(`
    SELECT 
      p.*,
      (SELECT COUNT(*) FROM policy_acknowledgements WHERE policy_id = p.id) as ack_count
    FROM policies p
    ${whereClause}
    ORDER BY p.updated_at DESC
  `, params);

  return rows.map(r => ({
    ...r,
    ackCount: parseInt(r.ack_count, 10),
    name: r.title // Map title to name for frontend compatibility
  }));
}

async function findById(pool, id) {
  const { rows } = await pool.query(`
    SELECT p.*, e.full_name as created_by_name
    FROM policies p
    LEFT JOIN employees e ON e.id = p.created_by
    WHERE p.id = $1
  `, [id]);
  return rows[0] || null;
}

async function create(pool, data) {
  const { 
    title, category, version, description, effectiveDate, 
    reviewDate, ackRequired, audience, status, content, fileUrl, createdBy 
  } = data;

  const { rows } = await pool.query(`
    INSERT INTO policies (
      title, category, version, description, effective_date, 
      review_date, ack_required, audience, status, content, file_url, created_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *
  `, [
    title, category, version || '1.0', description, effectiveDate || null,
    reviewDate || null, ackRequired !== false, audience || 'All Employees',
    status || 'Draft', content || null, fileUrl || null, createdBy || null
  ]);

  return rows[0];
}

async function update(pool, id, data) {
  const fields = [];
  const params = [id];
  let i = 2;

  const map = {
    title: 'title',
    category: 'category',
    version: 'version',
    description: 'description',
    effectiveDate: 'effective_date',
    reviewDate: 'review_date',
    ackRequired: 'ack_required',
    audience: 'audience',
    status: 'status',
    content: 'content',
    fileUrl: 'file_url'
  };

  for (const [key, col] of Object.entries(map)) {
    if (data[key] !== undefined) {
      fields.push(`${col} = $${i++}`);
      params.push(data[key]);
    }
  }

  if (fields.length === 0) return null;

  fields.push(`updated_at = NOW()`);

  const { rows } = await pool.query(`
    UPDATE policies
    SET ${fields.join(', ')}
    WHERE id = $1
    RETURNING *
  `, params);

  return rows[0] || null;
}

async function remove(pool, id) {
  const { rowCount } = await pool.query('DELETE FROM policies WHERE id = $1', [id]);
  return rowCount > 0;
}

async function getAcknowledgements(pool, policyId) {
  const { rows } = await pool.query(`
    SELECT 
      e.id as employee_id,
      e.full_name,
      e.emp_id,
      e.job_title,
      e.department,
      pa.acknowledged_at,
      CASE WHEN pa.id IS NOT NULL THEN 'Acknowledged' ELSE 'Pending' END as status
    FROM employees e
    LEFT JOIN policy_acknowledgements pa ON pa.employee_id = e.id AND pa.policy_id = $1
    WHERE e.deleted_at IS NULL
    ORDER BY pa.acknowledged_at DESC NULLS LAST, e.full_name ASC
  `, [policyId]);
  return rows;
}

async function acknowledge(pool, policyId, employeeId) {
  const { rows } = await pool.query(`
    INSERT INTO policy_acknowledgements (policy_id, employee_id)
    VALUES ($1, $2)
    ON CONFLICT (policy_id, employee_id) DO UPDATE SET acknowledged_at = CURRENT_TIMESTAMP
    RETURNING *
  `, [policyId, employeeId]);
  return rows[0];
}

async function listCategories(pool) {
  const { rows } = await pool.query(`
    SELECT * FROM policy_categories 
    ORDER BY name ASC
  `);
  return rows;
}

async function createPolicy(pool, data) {
  const { title, category, version, description, effectiveDate, reviewDate, ackRequired, audience, attachments } = data;
  const { rows } = await pool.query(`
    INSERT INTO policies 
    (title, category, version, description, effective_date, review_date, ack_required, audience, status, attachments)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *
  `, [
    title, 
    category, 
    version, 
    description, 
    effectiveDate, 
    reviewDate, 
    ackRequired, 
    audience, 
    data.status || 'Draft',
    JSON.stringify(attachments || [])
  ]);
  return rows[0];
}

async function updatePolicy(pool, id, data) {
  const { title, category, version, description, effectiveDate, reviewDate, ackRequired, audience, status, attachments } = data;
  const { rows } = await pool.query(`
    UPDATE policies 
    SET title = $1, category = $2, version = $3, description = $4, 
        effective_date = $5, review_date = $6, ack_required = $7, 
        audience = $8, status = $9, attachments = $10, updated_at = NOW()
    WHERE id = $11
    RETURNING *
  `, [
    title, 
    category, 
    version, 
    description, 
    effectiveDate, 
    reviewDate, 
    ackRequired, 
    audience, 
    status,
    JSON.stringify(attachments || []),
    id
  ]);
  return rows[0];
}

async function createCategory(pool, data) {
  const { name, description, iconName } = data;
  const { rows } = await pool.query(`
    INSERT INTO policy_categories (name, description, icon_name)
    VALUES ($1, $2, $3)
    RETURNING *
  `, [name, description, iconName || 'HiDocumentText']);
  return rows[0];
}

async function updateCategory(pool, id, data) {
  const { name, description, iconName } = data;
  const { rows } = await pool.query(`
    UPDATE policy_categories 
    SET name = $1, description = $2, icon_name = $3, updated_at = NOW()
    WHERE id = $4
    RETURNING *
  `, [name, description, iconName, id]);
  return rows[0];
}

async function deleteCategory(pool, id) {
  const { rowCount } = await pool.query('DELETE FROM policy_categories WHERE id = $1', [id]);
  return rowCount > 0;
}

module.exports = {
  findAll,
  findById,
  create,
  update,
  remove,
  getAcknowledgements,
  acknowledge,
  listCategories,
  createPolicy,
  updatePolicy,
  createCategory,
  updateCategory,
  deleteCategory
};
