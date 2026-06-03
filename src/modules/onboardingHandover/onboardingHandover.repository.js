'use strict';

async function listActive(pool, workflowType = 'completion') {
  const { rows } = await pool.query(
    `SELECT r.id, r.department_id, r.workflow_type, r.is_active, r.created_at, r.updated_at,
            d.name AS department_name, d.manager_id
     FROM onboarding_handover_rules r
     JOIN departments d ON d.id = r.department_id
     WHERE r.is_active = true AND r.workflow_type = $1
     ORDER BY d.name`,
    [workflowType],
  );
  return rows;
}

async function listAll(pool) {
  const { rows } = await pool.query(
    `SELECT r.id, r.department_id, r.workflow_type, r.is_active, r.created_at, r.updated_at,
            d.name AS department_name, d.manager_id
     FROM onboarding_handover_rules r
     JOIN departments d ON d.id = r.department_id
     ORDER BY d.name`,
  );
  return rows;
}

async function create(pool, { departmentId, workflowType, isActive }) {
  const { rows } = await pool.query(
    `INSERT INTO onboarding_handover_rules (department_id, workflow_type, is_active)
     VALUES ($1,$2,$3)
     RETURNING *`,
    [departmentId, workflowType || 'completion', isActive !== false],
  );
  return rows[0];
}

async function update(pool, id, { departmentId, workflowType, isActive }) {
  const { rows } = await pool.query(
    `UPDATE onboarding_handover_rules
     SET department_id = COALESCE($2, department_id),
         workflow_type = COALESCE($3, workflow_type),
         is_active = COALESCE($4, is_active),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, departmentId ?? null, workflowType ?? null, isActive],
  );
  return rows[0] || null;
}

async function remove(pool, id) {
  const { rowCount } = await pool.query(
    `DELETE FROM onboarding_handover_rules WHERE id = $1`,
    [id],
  );
  return rowCount > 0;
}

async function resolveHandoverRecipients(pool, workflowType = 'completion') {
  const { rows } = await pool.query(
    `SELECT DISTINCT e.id, e.work_email, e.full_name, e.department, d.name AS department_name
     FROM onboarding_handover_rules r
     JOIN departments d ON d.id = r.department_id
     JOIN employees e ON e.id = d.manager_id AND e.deleted_at IS NULL
     WHERE r.is_active = true AND r.workflow_type = $1 AND d.manager_id IS NOT NULL
     ORDER BY e.id`,
    [workflowType],
  );
  return rows;
}

module.exports = {
  listActive,
  listAll,
  create,
  update,
  remove,
  resolveHandoverRecipients,
};
