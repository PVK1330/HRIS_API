'use strict';

async function getAll(pool) {
  const { rows } = await pool.query(
    `SELECT a.*, e.full_name AS posted_by_name 
     FROM announcements a 
     LEFT JOIN employees e ON a.posted_by = e.id 
     ORDER BY a.created_at DESC`
  );
  return rows;
}

async function getStats(pool) {
  const { rows } = await pool.query(
    `SELECT 
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'Published')::int AS published,
      COUNT(*) FILTER (WHERE status = 'Draft')::int AS drafts,
      COUNT(*) FILTER (WHERE status = 'Scheduled')::int AS scheduled
     FROM announcements`
  );
  return rows[0] || { total: 0, published: 0, drafts: 0, scheduled: 0 };
}

async function create(pool, data) {
  const { title, category, priority, content, visibility, status, posted_by } = data;
  const schedule_date = data.schedule_date || data.scheduleDate;
  const { rows } = await pool.query(
    `INSERT INTO announcements 
      (title, category, priority, content, visibility, schedule_date, status, posted_by) 
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
     RETURNING *`,
    [title, category, priority, content, visibility, schedule_date || null, status || 'Draft', posted_by || null]
  );
  return rows[0];
}

async function update(pool, id, data) {
  const { title, category, priority, content, visibility, status } = data;
  const schedule_date = data.schedule_date || data.scheduleDate;
  const { rows } = await pool.query(
    `UPDATE announcements 
     SET title = COALESCE($1, title),
         category = COALESCE($2, category),
         priority = COALESCE($3, priority),
         content = COALESCE($4, content),
         visibility = COALESCE($5, visibility),
         schedule_date = COALESCE($6, schedule_date),
         status = COALESCE($7, status),
         updated_at = NOW()
     WHERE id = $8 
     RETURNING *`,
    [title, category, priority, content, visibility, schedule_date || null, status, id]
  );
  return rows[0];
}

async function remove(pool, id) {
  const { rowCount } = await pool.query(`DELETE FROM announcements WHERE id = $1`, [id]);
  return rowCount > 0;
}

async function getRecipients(pool, visibility) {
  if (visibility === 'All Employees' || visibility === 'all') {
    const { rows } = await pool.query(
      `SELECT id, first_name AS name, work_email AS email 
       FROM employees 
       WHERE employment_status IN ('Active', 'Probation') AND work_email IS NOT NULL`
    );
    return rows;
  } else if (visibility.startsWith('[') && visibility.endsWith(']')) {
    // Treat visibility as a JSON array of employee IDs
    try {
      const ids = JSON.parse(visibility);
      if (!Array.isArray(ids) || ids.length === 0) return [];
      
      const { rows } = await pool.query(
        `SELECT id, first_name AS name, work_email AS email 
         FROM employees 
         WHERE employment_status IN ('Active', 'Probation') AND work_email IS NOT NULL 
         AND id = ANY($1::int[])`,
        [ids]
      );
      return rows;
    } catch (err) {
      console.error('Failed to parse selected employees:', err);
      return [];
    }
  } else {
    // Treat visibility as department name directly mapped on employees
    const { rows } = await pool.query(
      `SELECT id, first_name AS name, work_email AS email 
       FROM employees 
       WHERE employment_status IN ('Active', 'Probation') AND department = $1 AND work_email IS NOT NULL`,
      [visibility]
    );
    return rows;
  }
}

async function getAnnouncementById(pool, id) {
  const { rows } = await pool.query(`SELECT * FROM announcements WHERE id = $1`, [id]);
  return rows[0];
}

module.exports = { getAll, getStats, create, update, remove, getRecipients, getAnnouncementById };
