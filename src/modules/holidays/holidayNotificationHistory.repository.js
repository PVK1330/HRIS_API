'use strict';

const NOTIFICATION_TYPES = Object.freeze({
  CREATED: 'holiday.created',
  UPDATED: 'holiday.updated',
  DELETED: 'holiday.deleted',
  REMINDER: 'holiday.reminder',
});

async function wasAlreadySent(pool, { holidayId, employeeId, notificationType }) {
  const { rows } = await pool.query(
    `SELECT 1 FROM holiday_notification_history
     WHERE holiday_id = $1 AND employee_id = $2 AND notification_type = $3
     LIMIT 1`,
    [holidayId, employeeId, notificationType],
  );
  return rows.length > 0;
}

async function recordSent(pool, { holidayId, employeeId, notificationType }) {
  await pool.query(
    `INSERT INTO holiday_notification_history (holiday_id, employee_id, notification_type)
     VALUES ($1, $2, $3)
     ON CONFLICT (holiday_id, employee_id, notification_type) DO NOTHING`,
    [holidayId, employeeId, notificationType],
  );
}

async function countByType(pool) {
  const { rows } = await pool.query(
    `SELECT notification_type, COUNT(*)::int AS cnt
     FROM holiday_notification_history
     GROUP BY notification_type`,
  );
  return rows;
}

module.exports = {
  NOTIFICATION_TYPES,
  wasAlreadySent,
  recordSent,
  countByType,
};
