'use strict';

const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SORT_COL = {
  created_at: 'er.created_at',
  updated_at: 'er.updated_at',
  last_working_day: 'er.last_working_day',
  employee_name: 'e.first_name',
};

const DEFAULT_CLEARANCE_TASKS = [
  { department: 'IT', task_name: 'Revoke system access & email', sort_order: 1 },
  { department: 'IT', task_name: 'Collect laptop & peripherals', sort_order: 2 },
  { department: 'IT', task_name: 'Revoke VPN & security tokens', sort_order: 3 },
  { department: 'HR', task_name: 'Collect ID card & access card', sort_order: 4 },
  { department: 'HR', task_name: 'Process final settlement', sort_order: 5 },
  { department: 'HR', task_name: 'Issue experience letter', sort_order: 6 },
  { department: 'HR', task_name: 'Issue No Objection Certificate', sort_order: 7 },
  { department: 'Finance', task_name: 'Clear pending reimbursements', sort_order: 8 },
  { department: 'Finance', task_name: 'Process full & final settlement', sort_order: 9 },
  { department: 'Admin', task_name: 'Return parking pass / keys', sort_order: 10 },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function buildWhereClause(query) {
  const conditions = ['1=1'];
  const params = [];
  let i = 1;

  const search = (query.search || '').trim();
  if (search) {
    params.push(`%${search}%`);
    conditions.push(
      `(e.full_name ILIKE $${i} OR e.first_name ILIKE $${i} OR e.last_name ILIKE $${i} OR COALESCE(er.exit_reason, '') ILIKE $${i})`,
    );
    i += 1;
  }

  const status = (query.status || 'all').trim();
  if (status !== 'all') {
    params.push(status);
    conditions.push(`er.status = $${i}`);
    i += 1;
  }

  const exitType = (query.exit_type || 'all').trim();
  if (exitType !== 'all') {
    params.push(exitType);
    conditions.push(`er.exit_type = $${i}`);
    i += 1;
  }

  if (query.employee_id) {
    params.push(Number(query.employee_id));
    conditions.push(`er.employee_id = $${i}`);
    i += 1;
  }

  return { where: conditions.join(' AND '), params, nextIndex: i };
}

async function assertEmployeeExists(pool, employeeId) {
  const { rows } = await pool.query(
    `SELECT id, full_name, first_name, last_name, employment_status FROM employees WHERE id = $1 AND deleted_at IS NULL`,
    [employeeId],
  );
  if (!rows.length) throw ApiError.notFound('Employee not found');
  return rows[0];
}

function empName(r) {
  return r.full_name || [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Unknown';
}

async function seedClearanceTasks(pool, exitRecordId) {
  const { rows: existing } = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM clearance_tasks WHERE exit_record_id = $1`,
    [exitRecordId],
  );
  if (existing[0].cnt > 0) return;

  let tasks = DEFAULT_CLEARANCE_TASKS;
  try {
    const { rows: templates } = await pool.query(
      `SELECT department, task_name, sort_order
       FROM clearance_task_templates
       WHERE is_active = true
       ORDER BY sort_order ASC, id ASC`,
    );
    if (templates.length > 0) tasks = templates;
  } catch {
    // table may not exist yet on older tenants; fall back to hardcoded defaults
  }

  for (const task of tasks) {
    await pool.query(
      `INSERT INTO clearance_tasks (exit_record_id, department, task_name, sort_order)
       VALUES ($1, $2, $3, $4)`,
      [exitRecordId, task.department, task.task_name, task.sort_order],
    );
  }
}

async function checkAutoReadyForClosure(pool, exitRecordId) {
  const { rows: taskRows } = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE is_completed = true)::int AS done
     FROM clearance_tasks WHERE exit_record_id = $1`,
    [exitRecordId],
  );
  const tasks = taskRows[0] || { total: 0, done: 0 };

  const { rows: assetRows } = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status IN ('Returned', 'Lost'))::int AS resolved
     FROM asset_returns WHERE exit_record_id = $1`,
    [exitRecordId],
  );
  const assets = assetRows[0] || { total: 0, resolved: 0 };

  const allClearanceDone = tasks.total === 0 || tasks.total === tasks.done;
  const allAssetsResolved = assets.total === 0 || assets.total === assets.resolved;

  return allClearanceDone && allAssetsResolved;
}

/* ------------------------------------------------------------------ */
/*  Exit Records CRUD                                                  */
/* ------------------------------------------------------------------ */

async function listExitRecords(tenant, query = {}) {
  const pool = await getTenantPool(tenant.dbName);
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 10));
  const offset = (page - 1) * limit;
  const sortBy = SORT_COL[query.sortBy] ? query.sortBy : 'created_at';
  const sortOrder = String(query.sortOrder || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const { where, params } = buildWhereClause(query);

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM exit_records er
     LEFT JOIN employees e ON e.id = er.employee_id
     WHERE ${where}`,
    [...params],
  );
  const total = countRows[0]?.total ?? 0;

  const dataParams = [...params, limit, offset];
  const lim = dataParams.length - 1;
  const off = dataParams.length;

  const { rows } = await pool.query(
    `SELECT er.id, er.employee_id, er.exit_type, er.status,
            er.last_working_day, er.notice_period_days, er.exit_reason,
            er.resignation_date, er.notice_date,
            er.termination_type_id, tt.name AS termination_type_name,
            er.approved_by, er.approved_at, er.rejection_reason, er.remarks,
            er.created_at, er.updated_at,
            e.full_name, e.first_name, e.last_name, e.work_email, e.job_title, e.department,
            (SELECT COUNT(*)::int FROM clearance_tasks ct WHERE ct.exit_record_id = er.id) AS total_tasks,
            (SELECT COUNT(*)::int FROM clearance_tasks ct WHERE ct.exit_record_id = er.id AND ct.is_completed = true) AS completed_tasks,
            (SELECT COUNT(*)::int FROM asset_returns ar WHERE ar.exit_record_id = er.id) AS total_assets,
            (SELECT COUNT(*)::int FROM asset_returns ar WHERE ar.exit_record_id = er.id AND ar.status IN ('Returned', 'Lost')) AS resolved_assets
     FROM exit_records er
     LEFT JOIN employees e ON e.id = er.employee_id
     LEFT JOIN termination_types tt ON tt.id = er.termination_type_id
     WHERE ${where}
     ORDER BY ${SORT_COL[sortBy]} ${sortOrder}, er.id DESC
     LIMIT $${lim} OFFSET $${off}`,
    dataParams,
  );

  return {
    records: rows.map((r) => ({
      ...r,
      employee_name: empName(r),
    })),
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
    filters: {
      applied: {
        page,
        limit,
        search: (query.search || '').trim(),
        status: (query.status || 'all').trim(),
        exit_type: (query.exit_type || 'all').trim(),
        sortBy,
        sortOrder: sortOrder.toLowerCase(),
      },
    },
  };
}

async function getExitStats(tenant) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status = 'Pending Approval')::int AS pending_approval,
       COUNT(*) FILTER (WHERE status = 'Approved')::int AS approved,
       COUNT(*) FILTER (WHERE status = 'In Progress')::int AS in_progress,
       COUNT(*) FILTER (WHERE status = 'clearance')::int AS in_clearance,
       COUNT(*) FILTER (WHERE status = 'interview')::int AS in_interview,
       COUNT(*) FILTER (WHERE status = 'settlement')::int AS in_settlement,
       COUNT(*) FILTER (WHERE status = 'Completed')::int AS completed,
       COUNT(*) FILTER (WHERE status = 'Rejected')::int AS rejected,
       COUNT(*) FILTER (WHERE exit_type = 'Resignation')::int AS resignations,
       COUNT(*) FILTER (WHERE exit_type = 'Termination')::int AS terminations
     FROM exit_records`,
  );
  const r = rows[0];
  return {
    total: r.total,
    pendingApproval: r.pending_approval,
    approved: r.approved,
    inProgress: r.in_progress,
    inClearance: r.in_clearance,
    inInterview: r.in_interview,
    inSettlement: r.in_settlement,
    completed: r.completed,
    rejected: r.rejected,
    resignations: r.resignations,
    terminations: r.terminations,
  };
}

async function getExitRecord(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `SELECT er.*,
            tt.name AS termination_type_name,
            e.full_name, e.first_name, e.last_name, e.work_email, e.job_title, e.department,
            e.employment_status,
            ab.full_name AS approved_by_name
     FROM exit_records er
     LEFT JOIN employees e ON e.id = er.employee_id
     LEFT JOIN termination_types tt ON tt.id = er.termination_type_id
     LEFT JOIN employees ab ON ab.id = er.approved_by
     WHERE er.id = $1`,
    [id],
  );
  const r = rows[0];
  if (!r) throw ApiError.notFound('Exit record not found');

  const [clearance, assets, documents, interviews, settlements] = await Promise.all([
    pool.query(
      `SELECT ct.*, cb.first_name AS completed_by_name
       FROM clearance_tasks ct
       LEFT JOIN employees cb ON cb.id = ct.completed_by
       WHERE ct.exit_record_id = $1
       ORDER BY ct.sort_order ASC, ct.id ASC`,
      [id],
    ),
    pool.query(
      `SELECT ar.*, rb.first_name AS returned_by_name
       FROM asset_returns ar
       LEFT JOIN employees rb ON rb.id = ar.returned_by
       WHERE ar.exit_record_id = $1
       ORDER BY ar.created_at ASC`,
      [id],
    ),
    pool.query(
      `SELECT * FROM exit_documents WHERE exit_record_id = $1 ORDER BY created_at DESC`,
      [id],
    ),
    pool.query(
      `SELECT ei.*, cb.full_name AS conducted_by_full_name
       FROM exit_interviews ei
       LEFT JOIN employees cb ON cb.id = ei.conducted_by
       WHERE ei.exit_request_id = $1
       ORDER BY ei.created_at DESC LIMIT 1`,
      [id],
    ),
    pool.query(
      `SELECT fs.*, pb.full_name AS processed_by_name
       FROM final_settlements fs
       LEFT JOIN employees pb ON pb.id = fs.processed_by
       WHERE fs.exit_request_id = $1
       ORDER BY fs.created_at DESC LIMIT 1`,
      [id],
    ),
  ]);

  return {
    ...r,
    employee_name: empName(r),
    clearance_tasks: clearance.rows,
    asset_returns: assets.rows,
    exit_documents: documents.rows,
    exit_interview: interviews.rows[0] || null,
    final_settlement: settlements.rows[0] || null,
  };
}

async function createResignation(tenant, data, userId) {
  const pool = await getTenantPool(tenant.dbName);
  await assertEmployeeExists(pool, data.employee_id);

  const { rows: existing } = await pool.query(
    `SELECT id FROM exit_records
     WHERE employee_id = $1 AND status NOT IN ('Completed', 'Rejected')`,
    [data.employee_id],
  );
  if (existing.length) {
    throw ApiError.conflict('An active exit record already exists for this employee');
  }

  const { rows } = await pool.query(
    `INSERT INTO exit_records
       (employee_id, exit_type, status, notice_date, resignation_date, last_working_day,
        notice_period_days, exit_reason, exit_interview_date, exit_interview_by,
        exit_interview_notes, remarks, initiated_by, is_voluntary)
     VALUES ($1, 'Resignation', 'Pending Approval', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)
     RETURNING id`,
    [
      data.employee_id,
      data.notice_date || null,
      data.resignation_date || null,
      data.last_working_day,
      data.notice_period_days || null,
      data.exit_reason || null,
      data.exit_interview_date || null,
      data.exit_interview_by || null,
      data.exit_interview_notes || null,
      data.remarks || null,
      userId,
    ],
  );

  await logAudit(pool, rows[0].id, userId, 'resignation_submitted', null, {
    status: 'Pending Approval', exit_type: 'Resignation', employee_id: data.employee_id,
  });

  return getExitRecord(tenant, rows[0].id);
}

async function createTermination(tenant, data, userId) {
  const pool = await getTenantPool(tenant.dbName);
  const emp = await assertEmployeeExists(pool, data.employee_id);

  const { rows: ttRows } = await pool.query(
    `SELECT id FROM termination_types WHERE id = $1 AND is_active = true`,
    [data.termination_type_id],
  );
  if (!ttRows.length) throw ApiError.badRequest('Invalid or inactive termination type');

  const { rows: existing } = await pool.query(
    `SELECT id FROM exit_records
     WHERE employee_id = $1 AND status NOT IN ('Completed', 'Rejected')`,
    [data.employee_id],
  );
  if (existing.length) {
    throw ApiError.conflict('An active exit record already exists for this employee');
  }

  const isVol = data.is_voluntary !== undefined ? data.is_voluntary : false;
  const { rows } = await pool.query(
    `INSERT INTO exit_records
       (employee_id, exit_type, status, termination_type_id, notice_date,
        last_working_day, notice_period_days, exit_reason,
        exit_interview_date, exit_interview_by, exit_interview_notes, remarks,
        initiated_by, is_voluntary)
     VALUES ($1, 'Termination', 'In Progress', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [
      data.employee_id,
      data.termination_type_id,
      data.notice_date || null,
      data.last_working_day,
      data.notice_period_days || null,
      data.exit_reason || null,
      data.exit_interview_date || null,
      data.exit_interview_by || null,
      data.exit_interview_notes || null,
      data.remarks || null,
      userId,
      isVol,
    ],
  );

  const exitId = rows[0].id;

  await pool.query(
    `UPDATE employees SET employment_status = 'Notice Period' WHERE id = $1`,
    [data.employee_id],
  );

  await seedClearanceTasks(pool, exitId);

  await logAudit(pool, exitId, userId, 'termination_initiated', null, {
    status: 'In Progress', exit_type: 'Termination', employee_id: data.employee_id,
  });

  return getExitRecord(tenant, exitId);
}

async function updateExitRecord(tenant, id, data, userId) {
  const pool = await getTenantPool(tenant.dbName);

  const { rows: existing } = await pool.query(
    `SELECT id, status FROM exit_records WHERE id = $1`, [id],
  );
  if (!existing.length) throw ApiError.notFound('Exit record not found');
  if (['Completed', 'Rejected'].includes(existing[0].status)) {
    throw ApiError.badRequest(`Cannot edit a record with status "${existing[0].status}"`);
  }

  const fields = [];
  const params = [];
  let n = 1;

  const allowedFields = [
    'last_working_day', 'notice_period_days', 'exit_reason',
    'exit_interview_date', 'exit_interview_by', 'exit_interview_notes',
    'remarks', 'termination_type_id', 'notice_date', 'resignation_date',
  ];

  const changedFields = {};
  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      params.push(data[field]);
      fields.push(`${field} = $${n++}`);
      changedFields[field] = data[field];
    }
  }

  if (!fields.length) return getExitRecord(tenant, id);

  fields.push('updated_at = NOW()');
  params.push(id);
  const { rows } = await pool.query(
    `UPDATE exit_records SET ${fields.join(', ')} WHERE id = $${n} RETURNING id`,
    params,
  );
  if (!rows.length) throw ApiError.notFound('Exit record not found');

  await logAudit(pool, id, userId, 'record_updated', null, changedFields);

  return getExitRecord(tenant, id);
}

async function approveResignation(tenant, id, userId) {
  const pool = await getTenantPool(tenant.dbName);

  const { rows } = await pool.query(
    `SELECT er.*, e.id AS emp_id FROM exit_records er
     LEFT JOIN employees e ON e.id = er.employee_id
     WHERE er.id = $1`,
    [id],
  );
  const record = rows[0];
  if (!record) throw ApiError.notFound('Exit record not found');
  if (record.exit_type !== 'Resignation') {
    throw ApiError.badRequest('Only resignations can be approved');
  }
  if (record.status !== 'Pending Approval') {
    throw ApiError.badRequest(`Cannot approve a record with status "${record.status}"`);
  }

  await pool.query(
    `UPDATE exit_records
     SET status = 'Approved', approved_by = $1, approved_at = NOW(), updated_at = NOW()
     WHERE id = $2`,
    [userId, id],
  );

  await pool.query(
    `UPDATE employees SET employment_status = 'Notice Period' WHERE id = $1`,
    [record.emp_id],
  );

  await seedClearanceTasks(pool, id);

  await logAudit(pool, id, userId, 'resignation_approved', { status: 'Pending Approval' }, { status: 'Approved' });

  return getExitRecord(tenant, id);
}

async function rejectResignation(tenant, id, rejectionReason, userId) {
  const pool = await getTenantPool(tenant.dbName);

  const { rows } = await pool.query(
    `SELECT * FROM exit_records WHERE id = $1`, [id],
  );
  const record = rows[0];
  if (!record) throw ApiError.notFound('Exit record not found');
  if (record.exit_type !== 'Resignation') {
    throw ApiError.badRequest('Only resignations can be rejected');
  }
  if (record.status !== 'Pending Approval') {
    throw ApiError.badRequest(`Cannot reject a record with status "${record.status}"`);
  }

  await pool.query(
    `UPDATE exit_records
     SET status = 'Rejected', rejection_reason = $1, approved_by = $2, approved_at = NOW(), updated_at = NOW()
     WHERE id = $3`,
    [rejectionReason, userId, id],
  );

  await logAudit(pool, id, userId, 'resignation_rejected', { status: 'Pending Approval' }, { status: 'Rejected', rejection_reason: rejectionReason });

  return getExitRecord(tenant, id);
}

async function updateExitStatus(tenant, id, newStatus, userId) {
  const pool = await getTenantPool(tenant.dbName);

  const { rows } = await pool.query(
    `SELECT er.*, e.id AS emp_id, e.full_name, e.first_name, e.last_name
     FROM exit_records er
     LEFT JOIN employees e ON e.id = er.employee_id
     WHERE er.id = $1`,
    [id],
  );
  const record = rows[0];
  if (!record) throw ApiError.notFound('Exit record not found');

  const VALID_TRANSITIONS = {
    'Approved': ['In Progress', 'clearance'],
    'In Progress': ['clearance', 'Completed'],
    'clearance': ['interview', 'Completed'],
    'interview': ['settlement', 'Completed'],
    'settlement': ['Completed'],
  };

  const allowed = VALID_TRANSITIONS[record.status] || [];
  if (!allowed.includes(newStatus)) {
    throw ApiError.badRequest(
      `Cannot transition from "${record.status}" to "${newStatus}"`,
    );
  }

  const oldStatus = record.status;
  await pool.query(
    `UPDATE exit_records SET status = $1, updated_at = NOW() WHERE id = $2`,
    [newStatus, id],
  );

  if (newStatus === 'Completed') {
    await pool.query(
      `UPDATE employees SET employment_status = 'Terminated' WHERE id = $1`,
      [record.emp_id],
    );

    const employeeName = empName(record);
    const autoDocTypes = ['Relieving Letter', 'Experience Letter'];
    for (const docType of autoDocTypes) {
      const { rows: existingDoc } = await pool.query(
        `SELECT id FROM exit_documents WHERE exit_record_id = $1 AND document_type = $2`,
        [id, docType],
      );
      if (!existingDoc.length) {
        await pool.query(
          `INSERT INTO exit_documents (exit_record_id, document_type, document_title, generated_at, generated_by)
           VALUES ($1, $2, $3, NOW(), $4)`,
          [id, docType, `${docType} - ${employeeName}`, userId || null],
        );
      }
    }

    await pool.query(
      `UPDATE exit_records SET experience_letter_issued = true, updated_at = NOW() WHERE id = $1`,
      [id],
    );
  }

  await logAudit(pool, id, userId, 'status_changed', { status: oldStatus }, { status: newStatus });

  return getExitRecord(tenant, id);
}

/* ------------------------------------------------------------------ */
/*  Clearance Tasks                                                    */
/* ------------------------------------------------------------------ */

async function listClearanceTasks(tenant, exitRecordId) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows: erCheck } = await pool.query(
    `SELECT id FROM exit_records WHERE id = $1`, [exitRecordId],
  );
  if (!erCheck.length) throw ApiError.notFound('Exit record not found');

  const { rows } = await pool.query(
    `SELECT ct.*,
            at2.first_name AS assigned_to_name,
            cb.first_name AS completed_by_name
     FROM clearance_tasks ct
     LEFT JOIN employees at2 ON at2.id = ct.assigned_to
     LEFT JOIN employees cb ON cb.id = ct.completed_by
     WHERE ct.exit_record_id = $1
     ORDER BY ct.sort_order ASC, ct.id ASC`,
    [exitRecordId],
  );
  return rows;
}

async function addClearanceTask(tenant, exitRecordId, data) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows: erCheck } = await pool.query(
    `SELECT id FROM exit_records WHERE id = $1`, [exitRecordId],
  );
  if (!erCheck.length) throw ApiError.notFound('Exit record not found');

  const { rows } = await pool.query(
    `INSERT INTO clearance_tasks (exit_record_id, department, task_name, assigned_to, notes, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      exitRecordId,
      data.department,
      data.task_name,
      data.assigned_to || null,
      data.notes || null,
      data.sort_order || 0,
    ],
  );
  return rows[0];
}

async function updateClearanceTask(tenant, exitRecordId, taskId, data, userId) {
  const pool = await getTenantPool(tenant.dbName);

  const { rows: existing } = await pool.query(
    `SELECT * FROM clearance_tasks WHERE id = $1 AND exit_record_id = $2`,
    [taskId, exitRecordId],
  );
  if (!existing.length) throw ApiError.notFound('Clearance task not found');

  const fields = [];
  const params = [];
  let n = 1;

  const simpleFields = ['task_name', 'department', 'assigned_to', 'notes', 'sort_order'];
  for (const field of simpleFields) {
    if (data[field] !== undefined) {
      params.push(data[field]);
      fields.push(`${field} = $${n++}`);
    }
  }

  if (data.is_completed !== undefined) {
    params.push(data.is_completed);
    fields.push(`is_completed = $${n++}`);
    if (data.is_completed && !existing[0].is_completed) {
      fields.push(`completed_at = NOW()`);
      params.push(userId);
      fields.push(`completed_by = $${n++}`);
    } else if (!data.is_completed) {
      fields.push(`completed_at = NULL`);
      fields.push(`completed_by = NULL`);
    }
  }

  if (!fields.length) {
    return existing[0];
  }

  fields.push('updated_at = NOW()');
  params.push(taskId);
  const { rows } = await pool.query(
    `UPDATE clearance_tasks SET ${fields.join(', ')} WHERE id = $${n} RETURNING *`,
    params,
  );

  const ready = await checkAutoReadyForClosure(pool, exitRecordId);
  if (ready) {
    await pool.query(
      `UPDATE exit_records SET status = 'In Progress', updated_at = NOW()
       WHERE id = $1 AND status IN ('Approved', 'clearance')`,
      [exitRecordId],
    );
  }

  return rows[0];
}

/* ------------------------------------------------------------------ */
/*  Asset Returns                                                      */
/* ------------------------------------------------------------------ */

async function listAssetReturns(tenant, exitRecordId) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows: erCheck } = await pool.query(
    `SELECT id FROM exit_records WHERE id = $1`, [exitRecordId],
  );
  if (!erCheck.length) throw ApiError.notFound('Exit record not found');

  const { rows } = await pool.query(
    `SELECT ar.*, rb.first_name AS returned_by_name
     FROM asset_returns ar
     LEFT JOIN employees rb ON rb.id = ar.returned_by
     WHERE ar.exit_record_id = $1
     ORDER BY ar.created_at ASC`,
    [exitRecordId],
  );
  return rows;
}

async function addAssetReturn(tenant, exitRecordId, data) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows: erCheck } = await pool.query(
    `SELECT id FROM exit_records WHERE id = $1`, [exitRecordId],
  );
  if (!erCheck.length) throw ApiError.notFound('Exit record not found');

  const { rows } = await pool.query(
    `INSERT INTO asset_returns
       (exit_record_id, asset_name, asset_code, asset_type,
        condition_on_return, return_date, returned_by, notes, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      exitRecordId,
      data.asset_name,
      data.asset_code || null,
      data.asset_type || null,
      data.condition_on_return || null,
      data.return_date || null,
      data.returned_by || null,
      data.notes || null,
      data.status || 'Pending',
    ],
  );
  return rows[0];
}

async function updateAssetReturn(tenant, exitRecordId, assetId, data, userId) {
  const pool = await getTenantPool(tenant.dbName);

  const { rows: existing } = await pool.query(
    `SELECT * FROM asset_returns WHERE id = $1 AND exit_record_id = $2`,
    [assetId, exitRecordId],
  );
  if (!existing.length) throw ApiError.notFound('Asset return not found');

  const fields = [];
  const params = [];
  let n = 1;

  const allowedFields = [
    'asset_name', 'asset_code', 'asset_type', 'condition_on_return',
    'return_date', 'returned_by', 'notes', 'status',
  ];
  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      params.push(data[field]);
      fields.push(`${field} = $${n++}`);
    }
  }

  if (!fields.length) return existing[0];

  fields.push('updated_at = NOW()');
  params.push(assetId);
  const { rows } = await pool.query(
    `UPDATE asset_returns SET ${fields.join(', ')} WHERE id = $${n} RETURNING *`,
    params,
  );

  const ready = await checkAutoReadyForClosure(pool, exitRecordId);
  if (ready) {
    await pool.query(
      `UPDATE exit_records SET status = 'In Progress', updated_at = NOW()
       WHERE id = $1 AND status IN ('Approved', 'clearance')`,
      [exitRecordId],
    );
  }

  return rows[0];
}

/* ------------------------------------------------------------------ */
/*  Exit Documents                                                     */
/* ------------------------------------------------------------------ */

async function listExitDocuments(tenant, exitRecordId) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows: erCheck } = await pool.query(
    `SELECT id FROM exit_records WHERE id = $1`, [exitRecordId],
  );
  if (!erCheck.length) throw ApiError.notFound('Exit record not found');

  const { rows } = await pool.query(
    `SELECT * FROM exit_documents WHERE exit_record_id = $1 ORDER BY created_at DESC`,
    [exitRecordId],
  );
  return rows;
}

async function generateExitDocument(tenant, exitRecordId, data, userId) {
  const pool = await getTenantPool(tenant.dbName);

  const { rows: erRows } = await pool.query(
    `SELECT er.*, e.full_name, e.first_name, e.last_name, e.work_email, e.job_title, e.department
     FROM exit_records er
     LEFT JOIN employees e ON e.id = er.employee_id
     WHERE er.id = $1`,
    [exitRecordId],
  );
  if (!erRows.length) throw ApiError.notFound('Exit record not found');

  const record = erRows[0];
  const employeeName = empName(record);
  const title = data.document_title || `${data.document_type} - ${employeeName}`;

  const { rows } = await pool.query(
    `INSERT INTO exit_documents (exit_record_id, document_type, document_title, generated_at, generated_by)
     VALUES ($1, $2, $3, NOW(), $4)
     RETURNING *`,
    [exitRecordId, data.document_type, title, userId || null],
  );

  const docTypeLower = (data.document_type || '').toLowerCase();
  if (docTypeLower.includes('experience')) {
    await pool.query(
      `UPDATE exit_records SET experience_letter_issued = true, updated_at = NOW() WHERE id = $1`,
      [exitRecordId],
    );
  } else if (docTypeLower.includes('noc') || docTypeLower.includes('no objection')) {
    await pool.query(
      `UPDATE exit_records SET noc_issued = true, updated_at = NOW() WHERE id = $1`,
      [exitRecordId],
    );
  }

  return rows[0];
}

/* ------------------------------------------------------------------ */
/*  Exit Interviews                                                    */
/* ------------------------------------------------------------------ */

async function submitExitInterview(tenant, data, userId) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows: erCheck } = await pool.query(
    `SELECT id, status FROM exit_records WHERE id = $1`, [data.exit_request_id],
  );
  if (!erCheck.length) throw ApiError.notFound('Exit record not found');

  const { rows: existing } = await pool.query(
    `SELECT id FROM exit_interviews WHERE exit_request_id = $1`, [data.exit_request_id],
  );
  if (existing.length) throw ApiError.conflict('Exit interview already submitted for this record');

  const conductedByName = await getUserName(pool, userId);
  const { rows } = await pool.query(
    `INSERT INTO exit_interviews
       (exit_request_id, conducted_by, conducted_by_name, format, feedback,
        rehire_eligible, overall_rating, conducted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     RETURNING *`,
    [
      data.exit_request_id, userId, conductedByName,
      data.format, data.feedback, data.rehire_eligible || 'maybe',
      data.overall_rating,
    ],
  );

  await logAudit(pool, data.exit_request_id, userId, 'exit_interview_submitted', null, {
    format: data.format, rating: data.overall_rating, rehire: data.rehire_eligible,
  });

  return rows[0];
}

async function getExitInterview(tenant, exitRequestId) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `SELECT ei.*, cb.full_name AS conducted_by_full_name
     FROM exit_interviews ei
     LEFT JOIN employees cb ON cb.id = ei.conducted_by
     WHERE ei.exit_request_id = $1
     ORDER BY ei.created_at DESC LIMIT 1`,
    [exitRequestId],
  );
  return rows[0] || null;
}

/* ------------------------------------------------------------------ */
/*  Final Settlements                                                  */
/* ------------------------------------------------------------------ */

async function processSettlement(tenant, data, userId) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows: erCheck } = await pool.query(
    `SELECT id, status FROM exit_records WHERE id = $1`, [data.exit_request_id],
  );
  if (!erCheck.length) throw ApiError.notFound('Exit record not found');

  const { rows: existing } = await pool.query(
    `SELECT id, payment_status FROM final_settlements WHERE exit_request_id = $1`, [data.exit_request_id],
  );
  if (existing.length && existing[0].payment_status === 'processed') {
    throw ApiError.conflict('Settlement already processed');
  }

  const netPayable = (parseFloat(data.unpaid_salary) || 0)
    + (parseFloat(data.leave_encashment) || 0)
    + (parseFloat(data.gratuity) || 0)
    - (parseFloat(data.deductions) || 0);

  let row;
  if (existing.length) {
    const { rows } = await pool.query(
      `UPDATE final_settlements
       SET unpaid_salary = $1, leave_encashment = $2, gratuity = $3,
           deductions = $4, net_payable = $5, payment_status = 'processed',
           payment_date = NOW(), processed_by = $6, notes = $7, updated_at = NOW()
       WHERE exit_request_id = $8 RETURNING *`,
      [
        data.unpaid_salary || 0, data.leave_encashment || 0, data.gratuity || 0,
        data.deductions || 0, netPayable, userId, data.notes || null, data.exit_request_id,
      ],
    );
    row = rows[0];
  } else {
    const { rows } = await pool.query(
      `INSERT INTO final_settlements
         (exit_request_id, unpaid_salary, leave_encashment, gratuity,
          deductions, net_payable, payment_status, payment_date, processed_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6, 'processed', NOW(), $7, $8)
       RETURNING *`,
      [
        data.exit_request_id, data.unpaid_salary || 0, data.leave_encashment || 0,
        data.gratuity || 0, data.deductions || 0, netPayable, userId, data.notes || null,
      ],
    );
    row = rows[0];
  }

  await logAudit(pool, data.exit_request_id, userId, 'settlement_processed', null, {
    net_payable: netPayable, payment_status: 'processed',
  });

  return row;
}

async function getSettlement(tenant, exitRequestId) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `SELECT fs.*, pb.full_name AS processed_by_name
     FROM final_settlements fs
     LEFT JOIN employees pb ON pb.id = fs.processed_by
     WHERE fs.exit_request_id = $1
     ORDER BY fs.created_at DESC LIMIT 1`,
    [exitRequestId],
  );
  return rows[0] || null;
}

/* ------------------------------------------------------------------ */
/*  Audit Logs                                                         */
/* ------------------------------------------------------------------ */

async function getUserName(pool, userId) {
  if (!userId) return 'System';
  const { rows } = await pool.query(
    `SELECT full_name, first_name, last_name FROM employees WHERE id = $1`, [userId],
  );
  return rows[0] ? empName(rows[0]) : 'Unknown';
}

async function logAudit(pool, exitRequestId, userId, action, beforeVal, afterVal) {
  const performedByName = await getUserName(pool, userId);
  await pool.query(
    `INSERT INTO exit_audit_logs
       (exit_request_id, performed_by, performed_by_name, action, before_value, after_value)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      exitRequestId, userId, performedByName, action,
      beforeVal ? JSON.stringify(beforeVal) : null,
      afterVal ? JSON.stringify(afterVal) : null,
    ],
  );
}

async function getAuditLog(tenant, exitRequestId) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows: erCheck } = await pool.query(
    `SELECT id FROM exit_records WHERE id = $1`, [exitRequestId],
  );
  if (!erCheck.length) throw ApiError.notFound('Exit record not found');

  const { rows } = await pool.query(
    `SELECT * FROM exit_audit_logs
     WHERE exit_request_id = $1
     ORDER BY created_at DESC`,
    [exitRequestId],
  );
  return rows;
}

/* ------------------------------------------------------------------ */
/*  Termination Types Dropdown                                         */
/* ------------------------------------------------------------------ */

async function getActiveTerminationTypes(tenant) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `SELECT id, name, description
     FROM termination_types
     WHERE is_active = true
     ORDER BY sort_order ASC, name ASC`,
  );
  return rows;
}

/* ------------------------------------------------------------------ */
/*  Exports                                                            */
/* ------------------------------------------------------------------ */

module.exports = {
  listExitRecords,
  getExitStats,
  getExitRecord,
  createResignation,
  createTermination,
  updateExitRecord,
  approveResignation,
  rejectResignation,
  updateExitStatus,
  listClearanceTasks,
  addClearanceTask,
  updateClearanceTask,
  listAssetReturns,
  addAssetReturn,
  updateAssetReturn,
  listExitDocuments,
  generateExitDocument,
  getActiveTerminationTypes,
  submitExitInterview,
  getExitInterview,
  processSettlement,
  getSettlement,
  getAuditLog,
};
