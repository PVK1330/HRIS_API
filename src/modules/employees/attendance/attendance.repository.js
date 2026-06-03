'use strict';

const { appendScopeToConditions } = require('../../../utils/applyDataScope');

const SELECT_FIELDS = `
  a.id,
  TO_CHAR(a.date, 'YYYY-MM-DD') AS date,
  a.employee_id,
  a.check_in_time, a.check_out_time, a.work_mode,
  a.status, a.total_hours, a.worked_hours, a.break_hours,
  a.overtime_hours, a.late_minutes, a.early_departure_minutes,
  a.is_late, a.early_departure, a.notes, a.leave_type,
  a.holiday_region, a.paid_day,
  a.regularization_status, a.regularization_reason,
  a.regularization_remarks, a.current_approval_level,
  a.requested_by, a.approved_by,
  TO_CHAR(a.approved_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS approved_at,
  a.is_closed,
  e.full_name AS employee_name, e.emp_id, e.department, e.job_title
`;

async function findByEmployee(pool, employeeId, { year, month, limit = 31, offset = 0 } = {}) {
  const conditions = ['a.employee_id = $1', 'e.deleted_at IS NULL'];
  const params = [employeeId];

  if (year) { params.push(year); conditions.push(`EXTRACT(YEAR FROM a.date) = $${params.length}`); }
  if (month) { params.push(month); conditions.push(`EXTRACT(MONTH FROM a.date) = $${params.length}`); }

  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT ${SELECT_FIELDS}
     FROM attendance a
     JOIN employees e ON e.id = a.employee_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY a.date DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows;
}

async function findAll(pool, filters, auth) {
  const conditions = ['e.deleted_at IS NULL'];
  const params = [];
  const { date, department, status, search, limit = 50, offset = 0 } = filters;

  if (date) { params.push(date); conditions.push(`a.date = $${params.length}`); }
  if (status) { params.push(status); conditions.push(`a.status = $${params.length}`); }
  if (department) { params.push(department); conditions.push(`e.department = $${params.length}`); }
  if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    conditions.push(`(e.full_name ILIKE $${n} OR e.emp_id ILIKE $${n})`);
  }

  const scoped = appendScopeToConditions(auth, conditions, params, 'e');
  scoped.params.push(limit, offset);

  const { rows } = await pool.query(
    `SELECT ${SELECT_FIELDS}
     FROM attendance a
     JOIN employees e ON e.id = a.employee_id
     WHERE ${scoped.conditions.join(' AND ')}
     ORDER BY a.date DESC, e.full_name ASC
     LIMIT $${scoped.params.length - 1} OFFSET $${scoped.params.length}`,
    scoped.params,
  );
  return rows;
}

async function countAll(pool, filters, auth) {
  const conditions = ['e.deleted_at IS NULL'];
  const params = [];
  const { date, department, status, search } = filters;

  if (date) { params.push(date); conditions.push(`a.date = $${params.length}`); }
  if (status) { params.push(status); conditions.push(`a.status = $${params.length}`); }
  if (department) { params.push(department); conditions.push(`e.department = $${params.length}`); }
  if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    conditions.push(`(e.full_name ILIKE $${n} OR e.emp_id ILIKE $${n})`);
  }

  const scoped = appendScopeToConditions(auth, conditions, params, 'e');
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM attendance a
     JOIN employees e ON e.id = a.employee_id
     WHERE ${scoped.conditions.join(' AND ')}`,
    scoped.params,
  );
  return rows[0].total;
}

async function findById(pool, id, client = pool) {
  const { rows } = await client.query(
    `SELECT a.*,
            TO_CHAR(a.date, 'YYYY-MM-DD') AS date,
            e.full_name AS employee_name, e.emp_id, e.department, e.job_title,
            e.profile_image_url AS profile_photo_url, e.reporting_manager_id,
            cb.full_name AS created_by_name,
            ub.full_name AS updated_by_name,
            ab.full_name AS approved_by_name,
            NULL::varchar AS shift_name
     FROM attendance a
     JOIN employees e ON e.id = a.employee_id AND e.deleted_at IS NULL
     LEFT JOIN employees cb ON cb.id = a.created_by
     LEFT JOIN employees ub ON ub.id = a.updated_by
     LEFT JOIN employees ab ON ab.id = a.approved_by
     WHERE a.id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function findByEmployeeAndDate(pool, employeeId, dateStr, client = pool) {
  const { rows } = await client.query(
    `SELECT a.*, TO_CHAR(a.date, 'YYYY-MM-DD') AS date
     FROM attendance a WHERE employee_id = $1 AND date = $2::date`,
    [employeeId, dateStr],
  );
  return rows[0] || null;
}

async function getSummary(pool, employeeId, year, month) {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status IN ('Present','Late','Remote','Work From Home','Field Duty'))::int AS present,
       COUNT(*) FILTER (WHERE status = 'Absent')::int AS absent,
       COUNT(*) FILTER (WHERE status = 'Late')::int AS late,
       COUNT(*) FILTER (WHERE status = 'Half Day')::int AS half_day,
       COUNT(*) FILTER (WHERE status = 'On Leave')::int AS on_leave,
       COUNT(*) FILTER (WHERE status = 'Holiday')::int AS holidays,
       COUNT(*) FILTER (WHERE status = 'Weekend')::int AS weekends,
       COUNT(*) FILTER (WHERE paid_day = true)::int AS paid_days,
       ROUND(COALESCE(SUM(worked_hours), SUM(total_hours), 0)::numeric, 2) AS total_worked_hours,
       ROUND(COALESCE(SUM(overtime_hours), 0)::numeric, 2) AS total_overtime_hours,
       COUNT(*)::int AS total_days
     FROM attendance
     WHERE employee_id = $1
       AND EXTRACT(YEAR FROM date) = $2
       AND EXTRACT(MONTH FROM date) = $3`,
    [employeeId, year, month],
  );
  return rows[0];
}

async function getDailySummary(pool, date) {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE a.status IN ('Present','Late'))::int AS present,
       COUNT(*) FILTER (WHERE a.status = 'Absent')::int AS absent,
       COUNT(*) FILTER (WHERE a.status = 'Late')::int AS late,
       COUNT(*) FILTER (WHERE a.status = 'On Leave')::int AS on_leave,
       COUNT(*) FILTER (WHERE a.work_mode = 'Remote')::int AS remote,
       COUNT(*) FILTER (WHERE a.work_mode = 'In Office')::int AS in_office,
       COUNT(*) FILTER (WHERE a.regularization_status = 'Pending')::int AS pending_regularization,
       COUNT(*) FILTER (WHERE a.check_out_time IS NULL AND a.check_in_time IS NOT NULL)::int AS missing_checkout
     FROM attendance a
     JOIN employees e ON e.id = a.employee_id AND e.deleted_at IS NULL
     WHERE a.date = $1`,
    [date],
  );
  return rows[0];
}

async function upsert(pool, data, client = pool) {
  const {
    employeeId, date, checkInTime, checkOutTime, workMode,
    status, totalHours, workedHours, breakHours, overtimeHours,
    lateMinutes, earlyDepartureMinutes,
    isLate, earlyDeparture, notes, leaveType, holidayRegion, paidDay,
    regularizationStatus, regularizationReason, requestedBy,
    currentApprovalLevel,
    punchTimezone, checkInIp, checkOutIp, checkInDevice, checkOutDevice,
    checkInLatitude, checkInLongitude, checkInAddress,
    checkOutLatitude, checkOutLongitude, checkOutAddress,
    createdBy, updatedBy,
    forceCheckIn, forceCheckOut,
  } = data;

  const { rows } = await client.query(
    `INSERT INTO attendance
       (employee_id, date, check_in_time, check_out_time, work_mode,
        status, total_hours, worked_hours, break_hours, overtime_hours,
        late_minutes, early_departure_minutes,
        is_late, early_departure, notes, leave_type, holiday_region, paid_day,
        regularization_status, regularization_reason, requested_by,
        current_approval_level,
        punch_timezone, check_in_ip, check_out_ip, check_in_device, check_out_device,
        check_in_latitude, check_in_longitude, check_in_address,
        check_out_latitude, check_out_longitude, check_out_address,
        created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
             $23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35)
     ON CONFLICT (employee_id, date) DO UPDATE SET
       check_in_time = CASE WHEN $36 THEN EXCLUDED.check_in_time
         ELSE COALESCE(EXCLUDED.check_in_time, attendance.check_in_time) END,
       check_out_time = CASE WHEN $37 THEN EXCLUDED.check_out_time
         ELSE COALESCE(EXCLUDED.check_out_time, attendance.check_out_time) END,
       work_mode = COALESCE(EXCLUDED.work_mode, attendance.work_mode),
       status = COALESCE(EXCLUDED.status, attendance.status),
       total_hours = COALESCE(EXCLUDED.total_hours, attendance.total_hours),
       worked_hours = COALESCE(EXCLUDED.worked_hours, attendance.worked_hours),
       break_hours = COALESCE(EXCLUDED.break_hours, attendance.break_hours),
       overtime_hours = COALESCE(EXCLUDED.overtime_hours, attendance.overtime_hours),
       late_minutes = COALESCE(EXCLUDED.late_minutes, attendance.late_minutes),
       early_departure_minutes = COALESCE(EXCLUDED.early_departure_minutes, attendance.early_departure_minutes),
       is_late = COALESCE(EXCLUDED.is_late, attendance.is_late),
       early_departure = COALESCE(EXCLUDED.early_departure, attendance.early_departure),
       notes = COALESCE(EXCLUDED.notes, attendance.notes),
       leave_type = COALESCE(EXCLUDED.leave_type, attendance.leave_type),
       holiday_region = COALESCE(EXCLUDED.holiday_region, attendance.holiday_region),
       paid_day = COALESCE(EXCLUDED.paid_day, attendance.paid_day),
       regularization_status = COALESCE(EXCLUDED.regularization_status, attendance.regularization_status),
       regularization_reason = COALESCE(EXCLUDED.regularization_reason, attendance.regularization_reason),
       requested_by = COALESCE(EXCLUDED.requested_by, attendance.requested_by),
       current_approval_level = COALESCE(EXCLUDED.current_approval_level, attendance.current_approval_level),
       punch_timezone = COALESCE(EXCLUDED.punch_timezone, attendance.punch_timezone),
       check_in_ip = COALESCE(EXCLUDED.check_in_ip, attendance.check_in_ip),
       check_out_ip = COALESCE(EXCLUDED.check_out_ip, attendance.check_out_ip),
       check_in_device = COALESCE(EXCLUDED.check_in_device, attendance.check_in_device),
       check_out_device = COALESCE(EXCLUDED.check_out_device, attendance.check_out_device),
       check_in_latitude = COALESCE(EXCLUDED.check_in_latitude, attendance.check_in_latitude),
       check_in_longitude = COALESCE(EXCLUDED.check_in_longitude, attendance.check_in_longitude),
       check_in_address = COALESCE(EXCLUDED.check_in_address, attendance.check_in_address),
       check_out_latitude = COALESCE(EXCLUDED.check_out_latitude, attendance.check_out_latitude),
       check_out_longitude = COALESCE(EXCLUDED.check_out_longitude, attendance.check_out_longitude),
       check_out_address = COALESCE(EXCLUDED.check_out_address, attendance.check_out_address),
       updated_by = COALESCE(EXCLUDED.updated_by, attendance.updated_by),
       updated_at = NOW()
     RETURNING *`,
    [
      employeeId, date,
      checkInTime ?? null,
      checkOutTime ?? null,
      workMode || 'In Office',
      status || 'Absent',
      totalHours ?? null,
      workedHours ?? null,
      breakHours ?? 0,
      overtimeHours ?? 0,
      lateMinutes ?? 0,
      earlyDepartureMinutes ?? 0,
      isLate ?? false,
      earlyDeparture ?? false,
      notes ?? null,
      leaveType ?? null,
      holidayRegion ?? null,
      paidDay ?? true,
      regularizationStatus || 'N/A',
      regularizationReason ?? null,
      requestedBy ?? null,
      currentApprovalLevel ?? 0,
      punchTimezone ?? null,
      checkInIp ?? null,
      checkOutIp ?? null,
      checkInDevice ?? null,
      checkOutDevice ?? null,
      checkInLatitude ?? null,
      checkInLongitude ?? null,
      checkInAddress ?? null,
      checkOutLatitude ?? null,
      checkOutLongitude ?? null,
      checkOutAddress ?? null,
      createdBy ?? null,
      updatedBy ?? null,
      Boolean(forceCheckIn),
      Boolean(forceCheckOut),
    ],
  );
  const row = rows[0];
  if (row) {
    row.date = row.date instanceof Date
      ? row.date.toISOString().split('T')[0]
      : String(row.date).slice(0, 10);
  }
  return row;
}

async function updateRegularization(client, id, patch) {
  const {
    status, approvedBy, remarks, attendanceStatus, currentApprovalLevel,
  } = patch;
  const { rows } = await client.query(
    `UPDATE attendance
     SET regularization_status = $1,
         approved_by = $2,
         approved_at = CASE WHEN $1 IN ('Approved','Rejected') THEN NOW() ELSE approved_at END,
         regularization_remarks = COALESCE($3, regularization_remarks),
         regularized_by = $2,
         regularized_at = NOW(),
         status = COALESCE($4, status),
         current_approval_level = COALESCE($5, current_approval_level),
         updated_at = NOW()
     WHERE id = $6
     RETURNING *`,
    [
      status,
      approvedBy || null,
      remarks || null,
      attendanceStatus || null,
      currentApprovalLevel ?? null,
      id,
    ],
  );
  return rows[0] || null;
}

async function getPendingRegularizations(pool, { limit = 50, offset = 0 }, auth) {
  const conditions = [`a.regularization_status = 'Pending'`, 'e.deleted_at IS NULL'];
  const params = [];
  const scoped = appendScopeToConditions(auth, conditions, params, 'e');
  scoped.params.push(limit, offset);

  const { rows } = await pool.query(
    `SELECT ${SELECT_FIELDS},
            a.regularization_reason,
            rs.level AS pending_level, rs.approver_role AS pending_approver_role
     FROM attendance a
     JOIN employees e ON e.id = a.employee_id
     LEFT JOIN attendance_regularization_steps rs
       ON rs.attendance_id = a.id AND rs.status = 'Pending'
     WHERE ${scoped.conditions.join(' AND ')}
     ORDER BY a.date DESC
     LIMIT $${scoped.params.length - 1} OFFSET $${scoped.params.length}`,
    scoped.params,
  );
  return rows;
}

async function getPayrollSummary(pool, employeeId, year, month) {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*)::int AS working_days,
       COUNT(*) FILTER (WHERE status IN ('Present','Late','Remote','Work From Home','Field Duty')
         AND check_in_time IS NOT NULL)::int AS present_days,
       COUNT(*) FILTER (WHERE status = 'Absent')::int AS absent_days,
       COUNT(*) FILTER (WHERE status = 'Half Day')::int AS half_days,
       COUNT(*) FILTER (WHERE paid_day = true)::int AS paid_days,
       ROUND(COALESCE(SUM(overtime_hours), 0)::numeric, 2) AS overtime_hours,
       COUNT(*) FILTER (WHERE is_late = true)::int AS late_count,
       COUNT(*) FILTER (WHERE status = 'On Leave')::int AS leave_days,
       COUNT(*) FILTER (WHERE paid_day = true OR status IN ('Present','Late','Half Day','On Leave','Holiday'))::int AS payable_days
     FROM attendance
     WHERE employee_id = $1
       AND EXTRACT(YEAR FROM date) = $2
       AND EXTRACT(MONTH FROM date) = $3`,
    [employeeId, year, month],
  );
  return rows[0];
}

async function markAbsentForDate(pool, dateStr) {
  const { rows } = await pool.query(
    `INSERT INTO attendance (employee_id, date, status, paid_day)
     SELECT e.id, $1::date, 'Absent', false
     FROM employees e
     WHERE e.deleted_at IS NULL
       AND e.employment_status IN ('Active', 'Probation')
       AND NOT EXISTS (
         SELECT 1 FROM attendance a
         WHERE a.employee_id = e.id AND a.date = $1::date
       )
       AND NOT EXISTS (
         SELECT 1 FROM leave_requests lr
         WHERE lr.employee_id = e.id
           AND lr.status = 'Approved'
           AND lr.from_date <= $1::date AND lr.to_date >= $1::date
       )
     ON CONFLICT (employee_id, date) DO NOTHING
     RETURNING id`,
    [dateStr],
  );
  return rows.length;
}

module.exports = {
  findByEmployee,
  findAll,
  countAll,
  findById,
  findByEmployeeAndDate,
  getSummary,
  getDailySummary,
  upsert,
  updateRegularization,
  getPendingRegularizations,
  getPayrollSummary,
  markAbsentForDate,
};
