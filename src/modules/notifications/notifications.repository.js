'use strict';

async function create(pool, { employeeId, forAdmin, title, message, type, ticketId, entityType, entityId, redirectUrl }) {
  const { rows } = await pool.query(`
    INSERT INTO notifications (employee_id, for_admin, title, message, type, ticket_id, entity_type, entity_id, redirect_url)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
  `, [
    employeeId || null, Boolean(forAdmin), title, message, type || 'info', 
    ticketId || null, entityType || null, entityId || null, redirectUrl || null
  ]);
  return rows[0];
}

async function normalizeRole(role) {
  return String(role || '').toLowerCase().replace(/[_\s]/g, '');
}

async function listForUser(pool, user) {
  const role = await normalizeRole(user.role || user.panel || '');
  const isAdminRole = ['admin', 'hradmin', 'superadmin', 'supportadmin', 'billingadmin'].includes(role);
  
  

  let adminCond = '';
  if (isAdminRole) {
    adminCond = 'OR for_admin = true';
  }
  
  const query = `
    SELECT * FROM notifications
    WHERE employee_id = $1 
       OR employee_id IN (SELECT id FROM employees WHERE work_email = $2)
       ${adminCond}
    ORDER BY created_at DESC
    LIMIT 100
  `;

  

  const { rows } = await pool.query(query, [user.id, user.email || '']);
  
  
  
  return rows.map(r => ({
    id: r.id,
    employeeId: r.employee_id,
    forAdmin: r.for_admin,
    title: r.title,
    message: r.message,
    type: r.type,
    ticketId: r.ticket_id || null,
    relatedId: r.ticket_id || null,
    entityType: r.entity_type || null,
    entityId: r.entity_id || null,
    redirectUrl: r.redirect_url || null,
    role: r.for_admin ? 'superadmin' : 'employee',
    read: Boolean(r.is_read),
    isRead: Boolean(r.is_read),
    createdAt: r.created_at,
    created_at: r.created_at,
    time: r.created_at ? new Date(r.created_at).toLocaleDateString() + ' ' + new Date(r.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''
  }));
}

async function markAsRead(pool, id, user) {
  const { rows } = await pool.query(`
    UPDATE notifications
    SET is_read = true
    WHERE id = $1
    RETURNING *
  `, [id]);
  return rows[0];
}

async function markAllAsRead(pool, user) {
  const role = String(user.role || user.panel || '').toLowerCase().replace(/_/g, '');
  const isAdminRole = ['admin', 'hradmin', 'superadmin', 'supportadmin', 'billingadmin'].includes(role);
  let adminCond = '';
  if (isAdminRole) {
    adminCond = 'OR for_admin = true';
  }
  await pool.query(`
    UPDATE notifications
    SET is_read = true
    WHERE (employee_id = $1 OR employee_id IN (SELECT id FROM employees WHERE work_email = $2))
       ${adminCond}
  `, [user.id, user.email || '']);
  return true;
}

async function remove(pool, id) {
  await pool.query('DELETE FROM notifications WHERE id = $1', [id]);
  return true;
}

module.exports = {
  create,
  listForUser,
  markAsRead,
  markAllAsRead,
  remove
};
