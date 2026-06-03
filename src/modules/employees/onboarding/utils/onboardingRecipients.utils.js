'use strict';

/**
 * Get active employees belonging to specific departments
 */
async function getDepartmentRecipients(pool, departments = []) {
  if (!departments || departments.length === 0) return [];
  
  const placeholders = departments.map((_, i) => `$${i + 1}`).join(',');
  const query = `
    SELECT id, work_email, full_name, department
    FROM employees
    WHERE deleted_at IS NULL 
      AND employment_status = 'Active'
      AND LOWER(department) IN (${placeholders})
  `;
  
  const values = departments.map(d => d.toLowerCase());
  const { rows } = await pool.query(query, values);
  return rows;
}

/**
 * Get active HR and Admin users (based on role names or permissions)
 */
async function getHROrAdminRecipients(pool) {
  const query = `
    SELECT DISTINCT e.id, e.full_name, e.work_email, e.department
    FROM employees e
    LEFT JOIN rbac_roles rr ON rr.id = e.rbac_role_id
    LEFT JOIN rbac_role_permissions rp ON rp.role_id = rr.id
    LEFT JOIN rbac_permissions p ON p.id = rp.permission_id
    WHERE e.deleted_at IS NULL
      AND e.employment_status = 'Active'
      AND (
        LOWER(COALESCE(rr.name, '')) LIKE '%hr%'
        OR LOWER(COALESCE(rr.name, '')) LIKE '%admin%'
        OR p.key IN ('onboarding', 'system-settings', 'employee.edit', 'tasks')
      )
    ORDER BY e.id
    LIMIT 50
  `;
  
  const { rows } = await pool.query(query);
  return rows;
}

module.exports = {
  getDepartmentRecipients,
  getHROrAdminRecipients,
};
