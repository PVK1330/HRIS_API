'use strict';

async function create(pool, { employeeId, forAdmin, title, message, type, ticketId }) {
  const { rows } = await pool.query(`
    INSERT INTO notifications (employee_id, for_admin, title, message, type, ticket_id)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [employeeId || null, Boolean(forAdmin), title, message, type || 'info', ticketId || null]);
  return rows[0];
}

async function listForUser(pool, user) {
  const isHrAdmin = user.role === 'hr_admin' || user.role === 'admin';
  let adminCond = '';
  if (isHrAdmin) {
    adminCond = 'OR for_admin = true';
  }
  
  const { rows } = await pool.query(`
    SELECT * FROM notifications
    WHERE employee_id = $1 
       OR employee_id IN (SELECT id FROM employees WHERE work_email = $2)
       ${adminCond}
    ORDER BY created_at DESC
    LIMIT 100
  `, [user.id, user.email || '']);
  
  return rows.map(r => ({
    id: r.id,
    employeeId: r.employee_id,
    forAdmin: r.for_admin,
    title: r.title,
    message: r.message,
    type: r.type,
    ticketId: r.ticket_id || null,
    isRead: Boolean(r.is_read),
    createdAt: r.created_at,
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
  const isHrAdmin = user.role === 'hr_admin' || user.role === 'admin';
  let adminCond = '';
  if (isHrAdmin) {
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
