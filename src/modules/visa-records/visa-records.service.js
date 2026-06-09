'use strict';

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const { getTenantPool } = require('../../config/db');
const env = require('../../config/env');
const ApiError = require('../../utils/ApiError');
const {
  appendScopeToConditions,
  assertEmployeeRecordAccess,
} = require('../../utils/applyDataScope');
const notify = require('../notifications/notifications.service');

const SORT = {
  visa_expiry_date: 'evr.visa_expiry_date',
  passport_expiry_date: 'evr.passport_expiry_date',
  full_name: 'e.full_name',
  created_at: 'evr.created_at',
  emp_id: 'evr.emp_id',
};

function toDateStr(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim().slice(0, 10);
}

async function persistVisaFile(employeeId, file) {
  if (!file || !file.buffer) return null;
  const base = path.resolve(env.UPLOAD.dir);
  const dir = path.join(base, 'visa-docs', String(employeeId));
  await fs.mkdir(dir, { recursive: true });
  const ext = path.extname(file.originalname || '').toLowerCase();
  const allowed = ['.pdf', '.jpg', '.jpeg', '.png'];
  const extFinal = allowed.includes(ext) ? ext : '.pdf';
  const fname = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${extFinal}`;
  await fs.writeFile(path.join(dir, fname), file.buffer);
  return `/uploads/visa-docs/${employeeId}/${fname}`;
}

function buildListFilters(query, auth = null) {
  let cond = ['evr.is_active = true', 'e.deleted_at IS NULL'];
  let params = [];
  let i = 1;

  const empFilter = query.employeeId ?? query.employee_id;
  if (empFilter != null && `${empFilter}`.trim() !== '') {
    const empId = parseInt(String(empFilter), 10);
    if (Number.isInteger(empId) && empId > 0) {
      params.push(empId);
      cond.push(`evr.employee_id = $${i}`);
      i += 1;
    }
  }

  const search = (query.search || '').trim();
  if (search) {
    params.push(`%${search}%`);
    cond.push(
      `(evr.emp_id ILIKE $${i} OR e.full_name ILIKE $${i} OR evr.passport_number ILIKE $${i} OR COALESCE(evr.emirates_id_number, '') ILIKE $${i})`,
    );
    i += 1;
  }

  const dept = (query.department || '').trim();
  if (dept) {
    params.push(`%${dept}%`);
    cond.push(`e.department ILIKE $${i}`);
    i += 1;
  }

  const loc = (query.location || '').trim();
  if (loc) {
    params.push(`%${loc}%`);
    cond.push(`COALESCE(e.work_location, '') ILIKE $${i}`);
    i += 1;
  }

  const vt = query.visaType ?? query.visa_type ?? '';
  if (vt !== '' && vt !== null && vt !== undefined) {
    const n = parseInt(String(vt), 10);
    if (Number.isInteger(n) && n > 0) {
      params.push(n);
      cond.push(`evr.visa_type_id = $${i}`);
      i += 1;
    } else {
      params.push(`%${String(vt).trim()}%`);
      cond.push(`(evr.visa_type_name ILIKE $${i} OR vt.name ILIKE $${i})`);
      i += 1;
    }
  }

  const ew = (query.expiryWindow || 'all').toString().toLowerCase();
  if (ew === 'expired') {
    cond.push('evr.visa_expiry_date < CURRENT_DATE');
  } else if (ew === '30') {
    cond.push(
      `evr.visa_expiry_date >= CURRENT_DATE AND evr.visa_expiry_date <= CURRENT_DATE + INTERVAL '30 days'`,
    );
  } else if (ew === '60') {
    cond.push(
      `evr.visa_expiry_date >= CURRENT_DATE AND evr.visa_expiry_date <= CURRENT_DATE + INTERVAL '60 days'`,
    );
  } else if (ew === '90') {
    cond.push(
      `evr.visa_expiry_date >= CURRENT_DATE AND evr.visa_expiry_date <= CURRENT_DATE + INTERVAL '90 days'`,
    );
  }

  if (auth) {
    ({ conditions: cond, params } = appendScopeToConditions(auth, cond, params, 'e'));
  }

  return { where: cond.join(' AND '), params, nextIdx: i };
}

async function listVisaRecords(tenant, query = {}, auth = null) {
  const pool = await getTenantPool(tenant.dbName);
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 10));
  const offset = (page - 1) * limit;
  const sortBy = SORT[query.sortBy] ? query.sortBy : 'visa_expiry_date';
  const sortOrder = String(query.sortOrder || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  const { where, params } = buildListFilters(query, auth);
  const from = `
    FROM employee_visa_records evr
    INNER JOIN employees e ON e.id = evr.employee_id
    LEFT JOIN visa_types vt ON vt.id = evr.visa_type_id
    WHERE ${where}
  `;

  const countParams = [...params];
  const { rows: cr } = await pool.query(`SELECT COUNT(*)::int AS total ${from}`, countParams);
  const total = cr[0]?.total ?? 0;

  const dataParams = [...params, limit, offset];
  const lim = dataParams.length - 1;
  const off = dataParams.length;
  const { rows } = await pool.query(
    `SELECT
       evr.*,
       e.full_name,
       e.department,
       e.work_location,
       e.work_email,
       COALESCE(evr.visa_type_name, vt.name) AS visa_type_display
     ${from}
     ORDER BY ${SORT[sortBy]} ${sortOrder}, evr.id ASC
     LIMIT $${lim} OFFSET $${off}`,
    dataParams,
  );

  return {
    records: rows,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  };
}

async function listAllForExport(tenant, query, auth = null) {
  const pool = await getTenantPool(tenant.dbName);
  const sortBy = SORT[query.sortBy] ? query.sortBy : 'visa_expiry_date';
  const sortOrder = String(query.sortOrder || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const { where, params } = buildListFilters(query, auth);
  const { rows } = await pool.query(
    `SELECT
       evr.*,
       e.full_name,
       e.department,
       e.work_location,
       COALESCE(evr.visa_type_name, vt.name) AS visa_type_display,
       CASE
         WHEN evr.visa_expiry_date < CURRENT_DATE THEN 'Expired'
         WHEN evr.visa_expiry_date < CURRENT_DATE + INTERVAL '60 days' THEN 'Expiring Soon'
         ELSE 'Valid'
       END AS compliance_status
     FROM employee_visa_records evr
     INNER JOIN employees e ON e.id = evr.employee_id
     LEFT JOIN visa_types vt ON vt.id = evr.visa_type_id
     WHERE ${where}
     ORDER BY ${SORT[sortBy]} ${sortOrder}, evr.id ASC
     LIMIT 20000`,
    params,
  );
  return rows;
}

async function getStats(tenant) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE evr.visa_expiry_date > CURRENT_DATE + INTERVAL '60 days')::int AS valid,
       COUNT(*) FILTER (
         WHERE evr.visa_expiry_date >= CURRENT_DATE
           AND evr.visa_expiry_date <= CURRENT_DATE + INTERVAL '60 days'
       )::int AS expiring_soon,
       COUNT(*) FILTER (WHERE evr.visa_expiry_date < CURRENT_DATE)::int AS expired
     FROM employee_visa_records evr
     INNER JOIN employees e ON e.id = evr.employee_id AND e.deleted_at IS NULL
     WHERE evr.is_active = true`,
  );
  const r = rows[0] || {};
  return {
    total: r.total ?? 0,
    valid: r.valid ?? 0,
    expiringSoon: r.expiring_soon ?? 0,
    expired: r.expired ?? 0,
  };
}

async function getFilterOptions(tenant) {
  const pool = await getTenantPool(tenant.dbName);
  const [deptRows, locRows, typeRows] = await Promise.all([
    pool.query(
      `SELECT DISTINCT department AS name FROM employees WHERE deleted_at IS NULL AND department IS NOT NULL ORDER BY department ASC LIMIT 500`,
    ),
    pool.query(
      `SELECT DISTINCT work_location AS name FROM employees WHERE deleted_at IS NULL AND work_location IS NOT NULL AND TRIM(work_location) <> '' ORDER BY work_location ASC LIMIT 500`,
    ),
    pool.query(`SELECT id, name FROM visa_types WHERE is_active = true ORDER BY name ASC`),
  ]);
  return {
    departments: deptRows.rows.map((x) => x.name),
    locations: locRows.rows.map((x) => x.name),
    visaTypes: typeRows.rows,
    expiryWindows: [
      { value: 'all', label: 'All' },
      { value: '30', label: 'Expiring in 30 days' },
      { value: '60', label: 'Expiring in 60 days' },
      { value: '90', label: 'Expiring in 90 days' },
      { value: 'expired', label: 'Already expired' },
    ],
  };
}

async function getVisaRecord(tenant, id, auth = null) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `SELECT evr.*, e.full_name, e.department, e.work_location, e.work_email,
            e.reporting_manager_id,
            COALESCE(evr.visa_type_name, vt.name) AS visa_type_display
     FROM employee_visa_records evr
     INNER JOIN employees e ON e.id = evr.employee_id
     LEFT JOIN visa_types vt ON vt.id = evr.visa_type_id
     WHERE evr.id = $1 AND evr.is_active = true`,
    [id],
  );
  if (!rows[0]) throw new ApiError(404, 'Record not found');
  if (auth) {
    assertEmployeeRecordAccess(auth, {
      id: rows[0].employee_id,
      department: rows[0].department,
      reporting_manager_id: rows[0].reporting_manager_id,
    });
  }
  return rows[0];
}

async function resolveVisaType(pool, visaTypeId) {
  const { rows } = await pool.query(
    `SELECT id, name FROM visa_types WHERE id = $1 AND is_active = true`,
    [visaTypeId],
  );
  if (!rows[0]) throw new ApiError(400, 'visa_type_id does not exist or is inactive');
  return rows[0];
}

async function resolveEmployee(pool, employeeId) {
  const { rows } = await pool.query(
    `SELECT id, emp_id FROM employees WHERE id = $1 AND deleted_at IS NULL`,
    [employeeId],
  );
  if (!rows[0]) throw new ApiError(400, 'employee_id not found');
  return rows[0];
}

async function createVisaRecord(tenant, body, files, userId) {
  const pool = await getTenantPool(tenant.dbName);
  const emp = await resolveEmployee(pool, body.employee_id);
  const vt = await resolveVisaType(pool, body.visa_type_id);

  const ps = files?.passport_scan?.[0];
  const vc = files?.visa_copy?.[0];
  if (!ps || !ps.buffer) throw new ApiError(400, 'passport_scan file is required');
  if (!vc || !vc.buffer) throw new ApiError(400, 'visa_copy file is required');

  const passportUrl = await persistVisaFile(emp.id, ps);
  const visaUrl = await persistVisaFile(emp.id, vc);
  let frontUrl = null;
  let backUrl = null;
  if (files?.emirates_id_front?.[0]?.buffer) {
    frontUrl = await persistVisaFile(emp.id, files.emirates_id_front[0]);
  }
  if (files?.emirates_id_back?.[0]?.buffer) {
    backUrl = await persistVisaFile(emp.id, files.emirates_id_back[0]);
  }

  const emiratesExpiry = body.emirates_id_expiry ? toDateStr(body.emirates_id_expiry) : null;

  const { rows } = await pool.query(
    `INSERT INTO employee_visa_records (
       employee_id, emp_id, nationality, passport_number, passport_issue_date, passport_expiry_date,
       country_of_issue, visa_type_id, visa_type_name, visa_number, visa_issue_date, visa_expiry_date,
       issued_by, sponsoring_entity, emirates_id_number, emirates_id_expiry,
       passport_scan_url, visa_copy_url, emirates_id_front_url, emirates_id_back_url,
       created_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
     ) RETURNING *`,
    [
      emp.id,
      emp.emp_id,
      body.nationality.trim(),
      body.passport_number.trim(),
      toDateStr(body.passport_issue_date),
      toDateStr(body.passport_expiry_date),
      body.country_of_issue.trim(),
      vt.id,
      vt.name,
      body.visa_number.trim(),
      toDateStr(body.visa_issue_date),
      toDateStr(body.visa_expiry_date),
      body.issued_by?.trim() || null,
      body.sponsoring_entity?.trim() || null,
      body.emirates_id_number?.trim() || null,
      emiratesExpiry,
      passportUrl,
      visaUrl,
      frontUrl,
      backUrl,
      userId || null,
    ],
  );

  notify.pushNotification(tenant, {
    employeeId: Number(emp.id),
    title: 'Visa Record Added',
    message: `A visa record (${vt.name || 'visa'}) has been added to your profile.`,
    type: 'info',
    entityType: 'visa_record',
    entityId: rows[0].id,
    redirectUrl: '/employee/profile',
  }).catch(() => null);

  return getVisaRecord(tenant, rows[0].id);
}

async function updateVisaRecord(tenant, id, body, files, userId) {
  const pool = await getTenantPool(tenant.dbName);
  const existing = await pool.query(
    `SELECT * FROM employee_visa_records WHERE id = $1 AND is_active = true`,
    [id],
  );
  if (!existing.rows[0]) throw new ApiError(404, 'Record not found');
  const cur = existing.rows[0];
  const employeeId = cur.employee_id;

  const fields = [];
  const params = [];
  let n = 1;

  const map = [
    ['nationality', 'nationality'],
    ['passport_number', 'passport_number'],
    ['passport_issue_date', 'passport_issue_date', toDateStr],
    ['passport_expiry_date', 'passport_expiry_date', toDateStr],
    ['country_of_issue', 'country_of_issue'],
    ['visa_number', 'visa_number'],
    ['visa_issue_date', 'visa_issue_date', toDateStr],
    ['visa_expiry_date', 'visa_expiry_date', toDateStr],
    ['issued_by', 'issued_by', (v) => (v != null ? String(v).trim() : null)],
    ['sponsoring_entity', 'sponsoring_entity', (v) => (v != null ? String(v).trim() : null)],
    ['emirates_id_number', 'emirates_id_number', (v) => (v != null ? String(v).trim() : null)],
    ['emirates_id_expiry', 'emirates_id_expiry', (v) => (v ? toDateStr(v) : null)],
  ];
  for (const [key, col, fn] of map) {
    if (body[key] !== undefined) {
      const raw = fn ? fn(body[key]) : body[key];
      const val = typeof raw === 'string' ? raw.trim() : raw;
      params.push(val);
      fields.push(`${col} = $${n++}`);
    }
  }

  if (body.visa_type_id !== undefined) {
    const vt = await resolveVisaType(pool, body.visa_type_id);
    params.push(vt.id, vt.name);
    fields.push(`visa_type_id = $${n++}`, `visa_type_name = $${n++}`);
  }

  if (files?.passport_scan?.[0]?.buffer) {
    const url = await persistVisaFile(employeeId, files.passport_scan[0]);
    params.push(url);
    fields.push(`passport_scan_url = $${n++}`);
  }
  if (files?.visa_copy?.[0]?.buffer) {
    const url = await persistVisaFile(employeeId, files.visa_copy[0]);
    params.push(url);
    fields.push(`visa_copy_url = $${n++}`);
  }
  if (files?.emirates_id_front?.[0]?.buffer) {
    const url = await persistVisaFile(employeeId, files.emirates_id_front[0]);
    params.push(url);
    fields.push(`emirates_id_front_url = $${n++}`);
  }
  if (files?.emirates_id_back?.[0]?.buffer) {
    const url = await persistVisaFile(employeeId, files.emirates_id_back[0]);
    params.push(url);
    fields.push(`emirates_id_back_url = $${n++}`);
  }

  if (fields.length) {
    fields.push('updated_at = NOW()');
    params.push(id);
    const idPh = params.length;
    await pool.query(
      `UPDATE employee_visa_records SET ${fields.join(', ')} WHERE id = $${idPh}`,
      params,
    );

    if (employeeId) {
      notify.pushNotification(tenant, {
        employeeId: Number(employeeId),
        title: 'Visa Record Updated',
        message: 'Your visa record has been updated. Please review the details in your profile.',
        type: 'info',
        entityType: 'visa_record',
        entityId: id,
        redirectUrl: '/employee/profile',
      }).catch(() => null);
    }
  }

  return getVisaRecord(tenant, id);
}

async function deleteVisaRecord(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows: existingRows } = await pool.query(
    `SELECT employee_id FROM employee_visa_records WHERE id = $1 AND is_active = true`,
    [id],
  );
  const { rowCount } = await pool.query(
    `UPDATE employee_visa_records SET is_active = false, updated_at = NOW() WHERE id = $1 AND is_active = true`,
    [id],
  );
  if (!rowCount) throw new ApiError(404, 'Record not found');

  const employeeId = existingRows[0]?.employee_id;
  if (employeeId) {
    notify.pushNotification(tenant, {
      employeeId: Number(employeeId),
      title: 'Visa Record Removed',
      message: 'A visa record has been removed from your profile.',
      type: 'warning',
      entityType: 'visa_record',
      entityId: id,
      redirectUrl: '/employee/profile',
    }).catch(() => null);
  }

  return true;
}

/**
 * Rows for cron: expiring within N days (inclusive of today), still active visa records.
 */
// Records expiring within `daysAhead` that have NOT already been alerted in the
// last `resendAfterDays` days. The dedup window stops the daily cron from
// re-emailing the same employee/HR for the same visa every single day.
async function findExpiringSoonForTenant(pool, daysAhead, resendAfterDays = 7) {
  const { rows } = await pool.query(
    `SELECT evr.*, e.full_name, e.work_email, e.emp_id
     FROM employee_visa_records evr
     INNER JOIN employees e ON e.id = evr.employee_id AND e.deleted_at IS NULL
     WHERE evr.is_active = true
       AND evr.visa_expiry_date >= CURRENT_DATE
       AND evr.visa_expiry_date <= CURRENT_DATE + ($1::int * INTERVAL '1 day')
       AND NOT EXISTS (
         SELECT 1 FROM visa_alert_logs l
         WHERE l.visa_record_id = evr.id
           AND l.alert_type = 'visa_expiring'
           AND l.sent_at > NOW() - ($2::int * INTERVAL '1 day')
       )`,
    [daysAhead, resendAfterDays],
  );
  return rows;
}

async function findExpiredForTenant(pool, resendAfterDays = 7) {
  const { rows } = await pool.query(
    `SELECT evr.*, e.full_name, e.work_email, e.emp_id
     FROM employee_visa_records evr
     INNER JOIN employees e ON e.id = evr.employee_id AND e.deleted_at IS NULL
     WHERE evr.is_active = true
       AND evr.visa_expiry_date < CURRENT_DATE
       AND NOT EXISTS (
         SELECT 1 FROM visa_alert_logs l
         WHERE l.visa_record_id = evr.id
           AND l.alert_type = 'visa_expired'
           AND l.sent_at > NOW() - ($1::int * INTERVAL '1 day')
       )`,
    [resendAfterDays],
  );
  return rows;
}

async function logAlert(pool, { employeeId, visaRecordId, alertType, daysRemaining }) {
  await pool.query(
    `INSERT INTO visa_alert_logs (employee_id, visa_record_id, alert_type, days_remaining)
     VALUES ($1,$2,$3,$4)`,
    [employeeId, visaRecordId, alertType, daysRemaining],
  );
}

module.exports = {
  listVisaRecords,
  listAllForExport,
  getStats,
  getFilterOptions,
  getVisaRecord,
  createVisaRecord,
  updateVisaRecord,
  deleteVisaRecord,
  findExpiringSoonForTenant,
  findExpiredForTenant,
  logAlert,
};
