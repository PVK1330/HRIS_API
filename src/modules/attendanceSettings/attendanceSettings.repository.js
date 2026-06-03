'use strict';

const COLUMN_KEYS = new Set([
  'work_start_time',
  'work_end_time',
  'break_duration_minutes',
  'total_required_hours',
  'auto_calculate_hours',
  'min_hours_for_present',
  'ten_minute_buffer',
  'late_mark_auto_calculation',
  'grace_days_per_month',
  'early_departure_rule',
  'who_can_submit_request',
  'approver',
  'auto_rejection_after_days',
  'overtime_eligibility',
  'overtime_calculation_rule',
  'overtime_approval_workflow',
  'approval_workflow_type',
  'weekend_mode',
  'custom_week_off_days',
  'uk_holiday_region',
  'shift_type_default',
  'overtime_custom_multiplier',
  'attendance_location_tracking',
]);

const TIME_KEYS = new Set(['work_start_time', 'work_end_time']);
const NUMERIC_KEYS = new Set([
  'total_required_hours',
  'min_hours_for_present',
  'overtime_custom_multiplier',
]);

async function getSettings(pool) {
  const { rows } = await pool.query(
    'SELECT * FROM attendance_settings ORDER BY created_at ASC LIMIT 1'
  );
  return rows[0] || null;
}

async function seedDefault(pool) {
  await pool.query(`
    INSERT INTO attendance_settings (id)
    SELECT gen_random_uuid()
    WHERE NOT EXISTS (SELECT 1 FROM attendance_settings LIMIT 1)
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
    if (TIME_KEYS.has(k)) {
      fragments.push(`${k} = $${i}::time`);
      values.push(fields[k]);
    } else if (NUMERIC_KEYS.has(k)) {
      fragments.push(`${k} = $${i}::numeric`);
      values.push(fields[k]);
    } else {
      fragments.push(`${k} = $${i}`);
      values.push(fields[k]);
    }
    i += 1;
  }

  fragments.push('updated_at = NOW()');

  const sql = `
    UPDATE attendance_settings
    SET ${fragments.join(', ')}
    WHERE id = (SELECT id FROM attendance_settings ORDER BY created_at ASC LIMIT 1)
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
