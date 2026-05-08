'use strict';

const COLUMN_KEYS = new Set([
  'salary_breakup_visibility',
  'ctc_visibility',
  'payslips_visibility',
  'revisions_visibility',
  'payroll_reports_visibility',
  'visa_nationality_visibility',
  'passport_copy_visibility',
  'visa_copy_visibility',
  'national_id_visibility',
  'medical_documents_visibility',
  'performance_issues_visibility',
  'notes_visibility',
]);

async function getSettings(pool) {
  const { rows } = await pool.query('SELECT * FROM sensitive_data_settings LIMIT 1');
  return rows[0] || null;
}

async function seedDefault(pool) {
  const inserted = await pool.query(`
    INSERT INTO sensitive_data_settings (id)
    SELECT gen_random_uuid()
    WHERE NOT EXISTS (SELECT 1 FROM sensitive_data_settings LIMIT 1)
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
    if (k === 'visa_nationality_visibility') {
      fragments.push(`visa_nationality_visibility = $${i}::jsonb`);
      values.push(fields[k]);
    } else {
      fragments.push(`${k} = $${i}`);
      values.push(fields[k]);
    }
    i += 1;
  }

  fragments.push('updated_at = NOW()');

  const sql = `
    UPDATE sensitive_data_settings
    SET ${fragments.join(', ')}
    WHERE id = (SELECT id FROM sensitive_data_settings LIMIT 1)
    RETURNING *
  `;

  const { rows } = await pool.query(sql, values);
  return rows[0] || null;
}

async function getRoles(pool) {
  try {
    const { rows } = await pool.query(
      'SELECT id, name FROM roles ORDER BY name ASC'
    );
    return rows;
  } catch {
    return [];
  }
}

module.exports = {
  getSettings,
  seedDefault,
  updateSettings,
  getRoles,
};
