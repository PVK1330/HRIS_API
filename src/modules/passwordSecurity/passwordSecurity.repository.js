'use strict';

const COLUMN_KEYS = new Set([
  'minimum_length',
  'must_include_special_chars',
  'password_expiry_days',
  'two_factor_auth',
  'auto_logout_minutes',
  'max_login_attempt_limit',
  'blocked_account_recovery',
]);

async function getSettings(pool) {
  const { rows } = await pool.query('SELECT * FROM password_security_settings LIMIT 1');
  return rows[0] || null;
}

async function seedDefault(pool) {
  const inserted = await pool.query(`
    INSERT INTO password_security_settings (id)
    SELECT gen_random_uuid()
    WHERE NOT EXISTS (SELECT 1 FROM password_security_settings LIMIT 1)
    RETURNING *
  `);
  if (inserted.rows[0]) {
    return inserted.rows[0];
  }
  return getSettings(pool);
}

async function updateSettings(pool, fields) {
  const keys = Object.keys(fields).filter((k) => COLUMN_KEYS.has(k) && fields[k] !== undefined);

  if (keys.length === 0) {
    return getSettings(pool);
  }

  const fragments = [];
  const values = [];
  let i = 1;

  for (const k of keys) {
    fragments.push(`${k} = $${i}`);
    values.push(fields[k]);
    i += 1;
  }

  fragments.push('updated_at = NOW()');

  const sql = `
    UPDATE password_security_settings
    SET ${fragments.join(', ')}
    WHERE id = (SELECT id FROM password_security_settings LIMIT 1)
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
