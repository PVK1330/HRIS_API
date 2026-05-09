'use strict';

const COLUMN_KEYS = ['email_notifications', 'sms_notifications', 'in_app_alerts', 'event_notifications'];

async function getSettings(pool) {
  const { rows } = await pool.query('SELECT * FROM notification_settings LIMIT 1');
  return rows[0] || null;
}

async function seedDefault(pool) {
  const inserted = await pool.query(`
    INSERT INTO notification_settings (id)
    SELECT gen_random_uuid()
    WHERE NOT EXISTS (SELECT 1 FROM notification_settings LIMIT 1)
    RETURNING *
  `);
  if (inserted.rows[0]) {
    return inserted.rows[0];
  }
  return getSettings(pool);
}

async function updateSettings(pool, fields) {
  const keys = COLUMN_KEYS.filter((k) => fields[k] !== undefined);

  if (keys.length === 0) {
    return getSettings(pool);
  }

  const fragments = [];
  const values = [];
  let i = 1;

  for (const k of keys) {
    if (k === 'event_notifications') {
      fragments.push(`event_notifications = $${i}::jsonb`);
      values.push(fields[k]);
    } else {
      fragments.push(`${k} = $${i}`);
      values.push(fields[k]);
    }
    i += 1;
  }

  fragments.push('updated_at = NOW()');

  const sql = `
    UPDATE notification_settings
    SET ${fragments.join(', ')}
    WHERE id = (SELECT id FROM notification_settings LIMIT 1)
    RETURNING *
  `;

  const { rows } = await pool.query(sql, values);
  return rows[0] || null;
}

module.exports = {
  getSettings,
  seedDefault,
  updateSettings,
};
