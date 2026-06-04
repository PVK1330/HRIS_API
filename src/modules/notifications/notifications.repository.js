'use strict';

const { ensureMessagingEmployeeId } = require('../messages/messagingIdentity');

async function create(pool, { employeeId, forAdmin, recipientId, recipientRole, title, message, type, priority, ticketId, entityType, entityId, redirectUrl }) {
  const { rows } = await pool.query(`
    INSERT INTO notifications (employee_id, for_admin, recipient_id, recipient_role, title, message, type, priority, ticket_id, entity_type, entity_id, redirect_url)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *
  `, [
    employeeId || null, Boolean(forAdmin), recipientId || null, recipientRole || null,
    title, message, type || 'info', priority || 'NORMAL',
    ticketId || null, entityType || null, entityId || null, redirectUrl || null
  ]);
  return rows[0];
}

async function normalizeRole(role) {
  return String(role || '').toLowerCase().replace(/[_\s]/g, '');
}

async function listForUser(pool, user) {
  const role = await normalizeRole(user.role || user.panel || '');
  const isSuperadmin = role === 'superadmin';
  const isAdminRole = ['admin', 'hradmin', 'supportadmin', 'billingadmin'].includes(role);

  console.log('[NOTIFICATIONS] listForUser - userId:', user.id, 'role:', role, 'isSuperadmin:', isSuperadmin, 'isAdminRole:', isAdminRole);

  let whereCondition = '';
  let params = [];

  const messagingEmpId = await ensureMessagingEmployeeId(pool, user);

  if (isSuperadmin) {
    // Superadmin should only see notifications specifically for superadmin
    // No parameters needed for this query
    whereCondition = `
      WHERE recipient_role = 'superadmin'
         OR (for_admin = true AND recipient_role IS NULL)  -- Backward compatibility
    `;
  } else if (isAdminRole) {
    // Admin should only see:
    // 1. Notifications specifically for them (recipient_id = admin.id)
    // 2. Notifications for their role (recipient_role = 'admin')
    // 3. Their own employee notifications
    whereCondition = `
      WHERE recipient_id = $1
         OR recipient_role = 'admin'
         OR employee_id = $1
         OR ($3::bigint IS NOT NULL AND employee_id = $3)
         OR ($4::bigint IS NOT NULL AND recipient_id = $4)
         OR employee_id IN (
              SELECT id
              FROM employees
              WHERE LOWER(work_email) = LOWER($2)
            )
    `;
    params = [
      user.id,
      user.email || '',
      messagingEmpId || null,
      Number(user.employeeId) || null
    ];
  } else {
    // Regular employee: only see their own notifications
    whereCondition = `
      WHERE employee_id = $1
         OR ($3::bigint IS NOT NULL AND employee_id = $3)
         OR ($4::bigint IS NOT NULL AND recipient_id = $4)
         OR employee_id IN (
              SELECT id
              FROM employees
              WHERE LOWER(work_email) = LOWER($2)
            )
    `;
    params = [
      user.id,
      user.email || '',
      messagingEmpId || null,
      Number(user.employeeId) || null
    ];
  }

  const query = `
    SELECT * FROM notifications
    ${whereCondition}
    ORDER BY created_at DESC
    LIMIT 100
  `;

  console.log('[NOTIFICATIONS] Query:', query);
  console.log('[NOTIFICATIONS] Params:', params, '(count:', params.length, ')');

  const { rows } = await pool.query(query, params);

  console.log('[NOTIFICATIONS] Returned', rows.length, 'notifications for user', user.id);

  return rows.map(r => ({
    id: r.id,
    employeeId: r.employee_id,
    forAdmin: r.for_admin,
    recipientId: r.recipient_id,
    recipientRole: r.recipient_role,
    title: r.title,
    message: r.message,
    type: r.type,
    ticketId: r.ticket_id || null,
    relatedId: r.ticket_id || null,
    entityType: r.entity_type || null,
    entityId: r.entity_id || null,
    redirectUrl: r.redirect_url || null,
    role: r.recipient_role || (r.for_admin ? 'superadmin' : 'employee'),
    read: Boolean(r.is_read),
    isRead: Boolean(r.is_read),
    createdAt: r.created_at,
    created_at: r.created_at,
    time: r.created_at ? new Date(r.created_at).toLocaleDateString() + ' ' + new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
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
  const role = String(user.role || user.panel || '').toLowerCase().replace(/[_\s]/g, '');
  const isSuperadmin = role === 'superadmin';
  const isAdminRole = ['admin', 'hradmin', 'supportadmin', 'billingadmin'].includes(role);

  let updateQuery = '';
  let params = [];

  if (isSuperadmin) {
    // Superadmin marks all superadmin notifications as read
    updateQuery = `
      UPDATE notifications
      SET is_read = true
      WHERE recipient_role = 'superadmin'
         OR (for_admin = true AND recipient_role IS NULL)
    `;
  } else if (isAdminRole) {
    // Admin marks their own notifications as read
    updateQuery = `
      UPDATE notifications
      SET is_read = true
      WHERE recipient_id = $1
         OR recipient_role = 'admin'
         OR employee_id = $1
         OR employee_id IN (SELECT id FROM employees WHERE work_email = $2)
    `;
    params = [user.id, user.email || ''];
  } else {
    // Employee marks their own notifications as read
    updateQuery = `
      UPDATE notifications
      SET is_read = true
      WHERE employee_id = $1
         OR employee_id IN (SELECT id FROM employees WHERE work_email = $2)
    `;
    params = [user.id, user.email || ''];
  }

  console.log('[NOTIFICATIONS] markAllAsRead query:', updateQuery);
  console.log('[NOTIFICATIONS] markAllAsRead params:', params, '(count:', params.length, ')');

  await pool.query(updateQuery, params);
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
