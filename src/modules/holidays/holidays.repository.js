'use strict';

const UK_REGIONS = ['England', 'Scotland', 'Wales', 'Northern Ireland'];

async function listCalendars(pool, { year, region, activeOnly = true } = {}) {
  const conditions = [];
  const params = [];
  if (year) {
    params.push(year);
    conditions.push(`hc.year = $${params.length}`);
  }
  if (region) {
    params.push(region);
    conditions.push(`hc.region = $${params.length}`);
  }
  if (activeOnly) conditions.push('hc.is_active = true');
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT hc.*, COUNT(hd.id)::int AS holiday_count
     FROM holiday_calendars hc
     LEFT JOIN holiday_dates hd ON hd.calendar_id = hc.id
     ${where}
     GROUP BY hc.id
     ORDER BY hc.year DESC, hc.region ASC`,
    params,
  );
  return rows;
}

async function getCalendarById(pool, id) {
  const { rows } = await pool.query(`SELECT * FROM holiday_calendars WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function getCalendarByRegionYear(pool, region, year) {
  const { rows } = await pool.query(
    `SELECT * FROM holiday_calendars WHERE region = $1 AND year = $2 LIMIT 1`,
    [region, year],
  );
  return rows[0] || null;
}

async function upsertCalendar(pool, { name, region, year, isActive = true }) {
  const { rows } = await pool.query(
    `INSERT INTO holiday_calendars (name, region, year, is_active)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (region, year) DO UPDATE SET
       name = EXCLUDED.name,
       is_active = EXCLUDED.is_active
     RETURNING *`,
    [name, region, year, isActive],
  );
  return rows[0];
}

async function listDates(pool, calendarId) {
  const { rows } = await pool.query(
    `SELECT id, calendar_id,
            TO_CHAR(holiday_date, 'YYYY-MM-DD') AS holiday_date,
            name
     FROM holiday_dates
     WHERE calendar_id = $1
     ORDER BY holiday_date ASC`,
    [calendarId],
  );
  return rows;
}

async function addDate(pool, calendarId, holidayDate, name) {
  const { rows } = await pool.query(
    `INSERT INTO holiday_dates (calendar_id, holiday_date, name)
     VALUES ($1, $2::date, $3)
     ON CONFLICT (calendar_id, holiday_date) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, calendar_id,
               TO_CHAR(holiday_date, 'YYYY-MM-DD') AS holiday_date,
               name`,
    [calendarId, holidayDate, name],
  );
  return rows[0];
}

async function updateDate(pool, id, { holidayDate, name }) {
  const { rows } = await pool.query(
    `UPDATE holiday_dates
     SET holiday_date = COALESCE($2::date, holiday_date),
         name = COALESCE($3, name)
     WHERE id = $1
     RETURNING id, calendar_id,
               TO_CHAR(holiday_date, 'YYYY-MM-DD') AS holiday_date,
               name`,
    [id, holidayDate || null, name || null],
  );
  return rows[0] || null;
}

async function deleteDate(pool, id) {
  const { rows } = await pool.query(
    `DELETE FROM holiday_dates WHERE id = $1 RETURNING *`,
    [id],
  );
  return rows[0] || null;
}

async function deleteCalendar(pool, id) {
  const { rows } = await pool.query(
    `DELETE FROM holiday_calendars WHERE id = $1 RETURNING *`,
    [id],
  );
  return rows[0] || null;
}

module.exports = {
  UK_REGIONS,
  listCalendars,
  getCalendarById,
  getCalendarByRegionYear,
  upsertCalendar,
  listDates,
  addDate,
  updateDate,
  deleteDate,
  deleteCalendar,
};
