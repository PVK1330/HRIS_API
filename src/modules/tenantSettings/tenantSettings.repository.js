'use strict';

const COLUMN_KEYS = new Set([
  'company_name',
  'logo_url',
  'address',
  'contact_details',
  'country',
  'timezone',
  'financial_year_start',
  'working_days',
  'default_work_calendar',
  'regional_holidays_enabled',
  'multiple_calendars_enabled',
  'default_probation_period',
  'default_notice_period',
  'auto_assign_policies',
  'locations',
]);

async function getSettings(pool) {
  const { rows } = await pool.query(
    'SELECT * FROM tenant_admin_settings ORDER BY created_at ASC LIMIT 1'
  );
  return rows[0] || null;
}

async function seedDefaultSettings(pool) {
  await pool.query(`
    INSERT INTO tenant_admin_settings (id)
    SELECT gen_random_uuid()
    WHERE NOT EXISTS (SELECT 1 FROM tenant_admin_settings LIMIT 1)
  `);
  return getSettings(pool);
}

async function updateSettings(pool, fields) {
  const keys = Object.keys(fields).filter(
    (k) => COLUMN_KEYS.has(k) && fields[k] !== undefined
  );

  const fragments = [];
  const values = [];
  let i = 1;

  for (const k of keys) {
    if (k === 'working_days' || k === 'locations') {
      fragments.push(`${k} = $${i}::jsonb`);
      values.push(JSON.stringify(fields[k]));
    } else {
      fragments.push(`${k} = $${i}`);
      values.push(fields[k]);
    }
    i += 1;
  }

  fragments.push('updated_at = NOW()');

  const sql = `
    UPDATE tenant_admin_settings
    SET ${fragments.join(', ')}
    WHERE id = (SELECT id FROM tenant_admin_settings ORDER BY created_at ASC LIMIT 1)
    RETURNING *
  `;

  const { rows } = await pool.query(sql, values);
  return rows[0] || null;
}

async function updateLogoUrl(pool, logoUrl) {
  const { rows } = await pool.query(
    `
      UPDATE tenant_admin_settings
      SET logo_url = $1, updated_at = NOW()
      WHERE id = (SELECT id FROM tenant_admin_settings ORDER BY created_at ASC LIMIT 1)
      RETURNING logo_url
    `,
    [logoUrl]
  );
  return rows[0] || null;
}

async function getExistingLogoUrl(pool) {
  const { rows } = await pool.query(
    'SELECT logo_url FROM tenant_admin_settings ORDER BY created_at ASC LIMIT 1'
  );
  const v = rows[0]?.logo_url;
  return v ? String(v) : '';
}

module.exports = {
  getSettings,
  seedDefaultSettings,
  updateSettings,
  updateLogoUrl,
  getExistingLogoUrl,
};
