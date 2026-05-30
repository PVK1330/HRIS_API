'use strict';

async function ensureDispatchColumn(pool) {
  try {
    await pool.query(`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS dispatch_channels varchar(50) DEFAULT 'Both'`);
    await pool.query(`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ`);
  } catch {
    /* ignore */
  }
}

async function getAll(pool) {
  await ensureDispatchColumn(pool);
  const { rows } = await pool.query(
    `SELECT a.*, e.full_name AS posted_by_name
     FROM announcements a
     LEFT JOIN employees e ON a.posted_by = e.id
     ORDER BY a.created_at DESC`,
  );
  return rows;
}

async function getPublishedForAll(pool) {
  await ensureDispatchColumn(pool);
  const { rows } = await pool.query(
    `SELECT a.*, e.full_name AS posted_by_name
     FROM announcements a
     LEFT JOIN employees e ON a.posted_by = e.id
     WHERE a.status = 'Published'
     ORDER BY COALESCE(a.schedule_date, a.created_at) DESC`,
  );
  return rows;
}

async function getStats(pool) {
  await ensureDispatchColumn(pool);
  const { rows } = await pool.query(
    `SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'Published')::int AS published,
      COUNT(*) FILTER (WHERE status = 'Draft')::int AS drafts,
      COUNT(*) FILTER (WHERE status = 'Scheduled')::int AS scheduled
     FROM announcements`,
  );
  return rows[0] || { total: 0, published: 0, drafts: 0, scheduled: 0 };
}

async function create(pool, data) {
  await ensureDispatchColumn(pool);
  const { title, category, priority, content, visibility, status, posted_by } = data;
  const dispatch_channels = data.dispatch_channels || data.dispatchChannels || 'Both';
  const schedule_date = data.schedule_date || data.scheduleDate || null;
  const { rows } = await pool.query(
    `INSERT INTO announcements
      (title, category, priority, content, visibility, schedule_date, status, posted_by, dispatch_channels)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [title, category, priority, content, visibility, schedule_date || null, status || 'Draft', posted_by || null, dispatch_channels],
  );
  return rows[0];
}

async function update(pool, id, data) {
  await ensureDispatchColumn(pool);
  const { title, category, priority, content, visibility, status } = data;
  const dispatch_channels = data.dispatch_channels || data.dispatchChannels;
  const schedule_date = data.schedule_date ?? data.scheduleDate;
  const { rows } = await pool.query(
    `UPDATE announcements
     SET title = COALESCE($1, title),
         category = COALESCE($2, category),
         priority = COALESCE($3, priority),
         content = COALESCE($4, content),
         visibility = COALESCE($5, visibility),
         schedule_date = COALESCE($6, schedule_date),
         status = COALESCE($7, status),
         dispatch_channels = COALESCE($8, dispatch_channels),
         updated_at = NOW()
     WHERE id = $9
     RETURNING *`,
    [title, category, priority, content, visibility, schedule_date ?? null, status, dispatch_channels, id],
  );
  return rows[0];
}

async function resetDispatch(pool, id) {
  const { rows } = await pool.query(
    `UPDATE announcements SET dispatched_at = NULL, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id],
  );
  return rows[0];
}

async function markDispatched(pool, id) {
  const { rows } = await pool.query(
    `UPDATE announcements
     SET dispatched_at = NOW(), status = 'Published', updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id],
  );
  return rows[0];
}

async function findDueScheduled(pool) {
  await ensureDispatchColumn(pool);
  const { rows } = await pool.query(
    `SELECT * FROM announcements
     WHERE status = 'Scheduled'
       AND schedule_date IS NOT NULL
       AND schedule_date <= NOW()
       AND dispatched_at IS NULL
     ORDER BY schedule_date ASC`,
  );
  return rows;
}

async function remove(pool, id) {
  const { rowCount } = await pool.query(`DELETE FROM announcements WHERE id = $1`, [id]);
  return rowCount > 0;
}

async function getRecipients(pool, visibility) {
  const baseWhere = `deleted_at IS NULL AND work_email IS NOT NULL AND work_email <> ''`;

  if (visibility === 'All Employees' || visibility === 'all') {
    const { rows } = await pool.query(
      `SELECT id, full_name AS name, work_email AS email
       FROM employees
       WHERE ${baseWhere}
         AND COALESCE(employment_status, 'Active') NOT IN ('Terminated', 'Exited')`,
    );
    return rows;
  }

  if (visibility?.startsWith('[') && visibility.endsWith(']')) {
    try {
      const ids = JSON.parse(visibility).map((x) => parseInt(x, 10)).filter((n) => n > 0);
      if (!ids.length) return [];
      const { rows } = await pool.query(
        `SELECT id, full_name AS name, work_email AS email
         FROM employees
         WHERE ${baseWhere} AND id = ANY($1::int[])`,
        [ids],
      );
      return rows;
    } catch {
      return [];
    }
  }

  const { rows } = await pool.query(
    `SELECT id, full_name AS name, work_email AS email
     FROM employees
     WHERE ${baseWhere} AND department = $1`,
    [visibility],
  );
  return rows;
}

async function getAnnouncementById(pool, id) {
  const { rows } = await pool.query(`SELECT * FROM announcements WHERE id = $1`, [id]);
  return rows[0];
}

module.exports = {
  getAll,
  getPublishedForAll,
  getStats,
  create,
  update,
  markDispatched,
  resetDispatch,
  findDueScheduled,
  remove,
  getRecipients,
  getAnnouncementById,
};
