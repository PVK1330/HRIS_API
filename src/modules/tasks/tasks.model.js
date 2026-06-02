'use strict';

class Task {
  constructor(data = {}) {
    this.id = data.id;
    this.title = data.title;
    this.description = data.description;
    this.priority = data.priority;
    this.status = data.status;
    this.dueDate = data.due_date;
    this.assigneeId = data.assignee_id;
    this.assignerId = data.assigner_id;
    this.createdAt = data.created_at;
    this.updatedAt = data.updated_at;
    this.isDeleted = data.is_deleted;
    
    // Aggregated fields
    this.assigneeName = data.assignee_name;
    this.assignerName = data.assigner_name;
    this.commentsCount = data.comments_count ? parseInt(data.comments_count, 10) : 0;
    this.attachmentsCount = data.attachments_count ? parseInt(data.attachments_count, 10) : 0;
  }

  static async create(pool, data, assignerId) {
    const query = `
      INSERT INTO tasks (title, description, priority, status, due_date, assignee_id, assigner_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *;
    `;
    const values = [
      data.title,
      data.description,
      data.priority || 'Medium',
      data.status || 'Pending',
      data.dueDate || null,
      data.assigneeId || null,
      assignerId
    ];
    const { rows } = await pool.query(query, values);
    return new Task(rows[0]);
  }

  static async findAll(pool, options = {}) {
    let query = `
      SELECT t.*,
        e1.first_name || ' ' || e1.last_name AS assignee_name,
        e2.first_name || ' ' || e2.last_name AS assigner_name,
        (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id) AS comments_count,
        (SELECT COUNT(*) FROM task_attachments a WHERE a.task_id = t.id) AS attachments_count
      FROM tasks t
      LEFT JOIN employees e1 ON t.assignee_id = e1.id
      LEFT JOIN employees e2 ON t.assigner_id = e2.id
      WHERE t.is_deleted = false
    `;
    
    const values = [];
    let idx = 1;

    if (options.status && options.status !== 'All') {
      query += ` AND t.status = $${idx++}`;
      values.push(options.status);
    }
    
    if (options.assigneeId) {
      query += ` AND t.assignee_id = $${idx++}`;
      values.push(options.assigneeId);
    }

    query += ` ORDER BY t.created_at DESC;`;

    const { rows } = await pool.query(query, values);
    return rows.map(r => new Task(r));
  }

  static async findById(pool, id) {
    const query = `
      SELECT t.*,
        e1.first_name || ' ' || e1.last_name AS assignee_name,
        e2.first_name || ' ' || e2.last_name AS assigner_name
      FROM tasks t
      LEFT JOIN employees e1 ON t.assignee_id = e1.id
      LEFT JOIN employees e2 ON t.assigner_id = e2.id
      WHERE t.id = $1 AND t.is_deleted = false
    `;
    const { rows } = await pool.query(query, [id]);
    return rows[0] ? new Task(rows[0]) : null;
  }

  static async update(pool, id, data) {
    const fields = [];
    const values = [];
    let idx = 1;

    for (const [key, val] of Object.entries(data)) {
      if (['title', 'description', 'priority', 'status', 'due_date', 'assignee_id'].includes(key)) {
        fields.push(`${key} = $${idx++}`);
        values.push(val);
      }
    }

    if (fields.length === 0) return this.findById(pool, id);

    fields.push(`updated_at = NOW()`);
    values.push(id);
    const query = `
      UPDATE tasks SET ${fields.join(', ')}
      WHERE id = $${idx} AND is_deleted = false
      RETURNING *;
    `;
    const { rows } = await pool.query(query, values);
    return rows[0] ? new Task(rows[0]) : null;
  }

  static async delete(pool, id) {
    const query = `
      UPDATE tasks SET is_deleted = true, updated_at = NOW()
      WHERE id = $1
      RETURNING *;
    `;
    const { rows } = await pool.query(query, [id]);
    return rows[0] ? new Task(rows[0]) : null;
  }
}

class TaskComment {
  constructor(data = {}) {
    this.id = data.id;
    this.taskId = data.task_id;
    this.employeeId = data.employee_id;
    this.comment = data.comment;
    this.createdAt = data.created_at;
    this.employeeName = data.employee_name;
  }

  static async create(pool, taskId, employeeId, comment) {
    const query = `
      INSERT INTO task_comments (task_id, employee_id, comment)
      VALUES ($1, $2, $3)
      RETURNING *;
    `;
    const { rows } = await pool.query(query, [taskId, employeeId, comment]);
    
    // fetch with name
    const fetchQ = `
      SELECT c.*, e.first_name || ' ' || e.last_name AS employee_name
      FROM task_comments c
      LEFT JOIN employees e ON c.employee_id = e.id
      WHERE c.id = $1
    `;
    const res = await pool.query(fetchQ, [rows[0].id]);
    return new TaskComment(res.rows[0]);
  }

  static async findByTaskId(pool, taskId) {
    const query = `
      SELECT c.*, e.first_name || ' ' || e.last_name AS employee_name
      FROM task_comments c
      LEFT JOIN employees e ON c.employee_id = e.id
      WHERE c.task_id = $1
      ORDER BY c.created_at ASC;
    `;
    const { rows } = await pool.query(query, [taskId]);
    return rows.map(r => new TaskComment(r));
  }
}

class TaskAttachment {
  constructor(data = {}) {
    this.id = data.id;
    this.taskId = data.task_id;
    this.uploaderId = data.uploader_id;
    this.fileName = data.file_name;
    this.fileUrl = data.file_url;
    this.fileType = data.file_type;
    this.fileSize = data.file_size;
    this.createdAt = data.created_at;
    this.uploaderName = data.uploader_name;
  }

  static async create(pool, data) {
    const query = `
      INSERT INTO task_attachments (task_id, uploader_id, file_name, file_url, file_type, file_size)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *;
    `;
    const { rows } = await pool.query(query, [
      data.taskId, data.uploaderId, data.fileName, data.fileUrl, data.fileType, data.fileSize
    ]);

    const fetchQ = `
      SELECT a.*, e.first_name || ' ' || e.last_name AS uploader_name
      FROM task_attachments a
      LEFT JOIN employees e ON a.uploader_id = e.id
      WHERE a.id = $1
    `;
    const res = await pool.query(fetchQ, [rows[0].id]);
    return new TaskAttachment(res.rows[0]);
  }

  static async findByTaskId(pool, taskId) {
    const query = `
      SELECT a.*, e.first_name || ' ' || e.last_name AS uploader_name
      FROM task_attachments a
      LEFT JOIN employees e ON a.uploader_id = e.id
      WHERE a.task_id = $1
      ORDER BY a.created_at ASC;
    `;
    const { rows } = await pool.query(query, [taskId]);
    return rows.map(r => new TaskAttachment(r));
  }
}

module.exports = { Task, TaskComment, TaskAttachment };
