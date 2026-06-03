'use strict';

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
        OR p.key IN ('onboarding', 'onboarding.manage', 'onboarding.view', 'system-settings', 'tasks')
      )
    ORDER BY e.id
    LIMIT 50
  `;
  
  const { rows } = await pool.query(query);
  return rows;
}

module.exports = {
  getHROrAdminRecipients,
};
