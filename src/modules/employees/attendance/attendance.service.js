'use strict';

const { getTenantPool } = require('../../../config/db');
const ApiError = require('../../../utils/ApiError');
const { ensureMigrated } = require('../../../utils/tenantMigration');
const empRepo = require('../employees.repository');
const repo = require('./attendance.repository');
const authz = require('./attendanceAuth.service');
const calc = require('./attendanceCalculation.service');
const graceEngine = require('./attendanceGrace.service');
const audit = require('./attendanceAudit.service');
const workflow = require('./attendanceWorkflow.service');
const notify = require('./attendanceNotifications.service');
const reportsEngine = require('./attendanceReports.service');
const exportEngine = require('./attendanceExport.service');
const tenantSettingsService = require('../../tenantSettings/tenantSettings.service');
const integrity = require('./attendanceIntegrity.service');
const { hasPermission } = require('../../../services/authz.service');
const { P } = require('../../../constants/permissions');
const logger = require('../../../utils/logger');

function getPool(user) {
  if (!user?.db_name) throw ApiError.unauthorized('Tenant not found');
  return getTenantPool(user.db_name);
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function nowTimeStr() {
  const n = new Date();
  return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
}

function actorEmployeeId(user) {
  return user?.employeeId || null;
}

/**
 * Resolve the acting employee's id. Prefers an explicit body id, then the JWT's
 * employeeId, and finally falls back to matching the user's account email against
 * employees.work_email. This covers tokens issued before the employee profile was
 * linked, so check-in/out works without forcing the user to log out and back in.
 */
async function resolveEmployeeId(pool, user, explicitId) {
  let employeeId = explicitId || actorEmployeeId(user);
  if (!employeeId && user?.email) {
    try {
      const { rows } = await pool.query(
        `SELECT id FROM employees
         WHERE LOWER(work_email) = LOWER($1) AND deleted_at IS NULL
         LIMIT 1`,
        [user.email],
      );
      if (rows[0]) employeeId = rows[0].id;
    } catch (err) {
      logger.debug('[attendance] employee id lookup by email failed', { email: user.email, err: err.message });
    }
  }
  return employeeId;
}

function canManageOverride(auth) {
  return auth?.isTenantAdmin || hasPermission(auth, P.ATTENDANCE_MANAGE);
}

function normalizeNotes(notes) {
  if (notes === undefined) return null;
  if (notes === null) return null;
  const s = String(notes).trim();
  return s.length ? s : null;
}

async function punchContext(pool, dbName, req) {
  const attSettings = await calc.loadSettings(pool);
  let timezone = 'UTC';
  try {
    const tenant = await tenantSettingsService.getAdminSettings(dbName, '');
    timezone = tenant?.timezone || timezone;
  } catch {
    /* tenant settings optional */
  }
  return {
    timezone,
    locationTracking: attSettings?.attendance_location_tracking === true,
    ip: req?.ip || req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || null,
    device: req?.headers?.['user-agent'] || null,
  };
}

function locationFromBody(body, settings) {
  if (!settings?.attendance_location_tracking) return {};
  return {
    latitude: body.latitude ?? null,
    longitude: body.longitude ?? null,
    address: body.address ?? null,
  };
}

function mapRows(records) {
  return (records || []).map((r) => integrity.mapRecordForResponse(r));
}

async function persistAttendance(pool, user, data, req, { isOverride = false } = {}) {
  const settings = await calc.loadSettings(pool);
  const computed = await buildComputedRecord(pool, data.employeeId, data.date, {
    checkInTime: data.checkInTime,
    checkOutTime: data.checkOutTime,
    workMode: data.workMode,
  }, data.workMode);

  const sanitized = integrity.sanitizeMetrics(
    {
      ...computed,
      status: isOverride && data.status ? data.status : computed.status,
      overtime_hours: data.overtimeHours ?? computed.overtime_hours,
    },
    data.checkInTime,
    data.checkOutTime,
    data.regularizationStatus || 'N/A',
  );

  if (isOverride && data.status && integrity.PRESENT_LIKE.has(data.status)) {
    if (!data.checkInTime && data.regularizationStatus !== 'Approved') {
      throw ApiError.badRequest('Present status requires check-in time or approved regularization');
    }
  }

  const actor = actorEmployeeId(user);
  const meta = req?._punchCtx || { timezone: 'UTC', ip: null, device: null };

  const record = await repo.upsert(pool, {
    employeeId: data.employeeId,
    date: data.date,
    checkInTime: data.checkInTime,
    checkOutTime: data.checkOutTime,
    workMode: data.workMode || 'In Office',
    status: sanitized.status,
    totalHours: sanitized.total_hours,
    workedHours: sanitized.worked_hours,
    breakHours: sanitized.break_hours,
    overtimeHours: sanitized.overtime_hours,
    lateMinutes: sanitized.late_minutes,
    earlyDepartureMinutes: sanitized.early_departure_minutes,
    isLate: sanitized.is_late,
    earlyDeparture: sanitized.early_departure,
    notes: normalizeNotes(data.notes),
    leaveType: sanitized.leave_type,
    holidayRegion: sanitized.holiday_region,
    paidDay: sanitized.paid_day,
    regularizationStatus: data.regularizationStatus,
    regularizationReason: data.regularizationReason,
    requestedBy: data.requestedBy,
    currentApprovalLevel: data.currentApprovalLevel,
    punchTimezone: meta.timezone,
    checkInIp: data.checkInIp,
    checkOutIp: data.checkOutIp,
    checkInDevice: data.checkInDevice,
    checkOutDevice: data.checkOutDevice,
    checkInLatitude: data.checkInLatitude,
    checkInLongitude: data.checkInLongitude,
    checkInAddress: data.checkInAddress,
    checkOutLatitude: data.checkOutLatitude,
    checkOutLongitude: data.checkOutLongitude,
    checkOutAddress: data.checkOutAddress,
    createdBy: data.createdBy ?? actor,
    updatedBy: actor,
    forceCheckIn: data.forceCheckIn,
    forceCheckOut: data.forceCheckOut,
  });

  return integrity.mapRecordForResponse(record);
}

async function buildComputedRecord(pool, employeeId, dateStr, punch, workMode) {
  const settings = await calc.loadSettings(pool);
  const shift = await calc.getEmployeeShift(pool, employeeId, dateStr);
  const leave = await calc.findLeaveForDate(pool, employeeId, dateStr);
  const holiday = await calc.findHolidayForDate(
    pool,
    dateStr,
    settings?.uk_holiday_region,
  );
  const monthlyLateCountBefore = await graceEngine.countMonthlyLateArrivalsBeforeDate(
    pool,
    employeeId,
    dateStr,
  );
  return calc.computeFromPunch({
    settings,
    shift,
    checkInTime: punch.checkInTime,
    checkOutTime: punch.checkOutTime,
    workMode: punch.workMode || workMode,
    dateStr,
    leaveRecord: leave,
    holidayRecord: holiday,
    monthlyLateCountBefore,
  });
}

async function getAttendance(auth, user, employeeId, query = {}) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);
  await authz.assertCanViewEmployee(auth, pool, Number(employeeId));

  const emp = await empRepo.findById(pool, employeeId);
  if (!emp) throw ApiError.notFound('Employee not found');

  const now = new Date();
  const year = parseInt(query.year, 10) || now.getFullYear();
  const month = parseInt(query.month, 10) || now.getMonth() + 1;

  const [records, summary] = await Promise.all([
    repo.findByEmployee(pool, employeeId, { year, month }),
    repo.getSummary(pool, employeeId, year, month),
  ]);
  return { records: mapRows(records), summary, year, month };
}

async function listAttendance(auth, user, query = {}) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);

  const date = query.date || todayStr();
  const limit = Math.min(100, parseInt(query.limit, 10) || 50);
  const offset = (Math.max(1, parseInt(query.page, 10) || 1) - 1) * limit;

  const filters = {
    date,
    department: query.department || '',
    status: query.status || '',
    search: query.search || '',
    limit,
    offset,
  };

  const [records, total, summary] = await Promise.all([
    repo.findAll(pool, filters, auth),
    repo.countAll(pool, filters, auth),
    repo.getDailySummary(pool, date),
  ]);

  return {
    records: mapRows(records),
    total,
    summary,
    date,
    limit,
    page: Math.max(1, parseInt(query.page, 10) || 1),
  };
}

async function getRecordDetail(auth, user, id) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);
  const row = await repo.findById(pool, id);
  if (!row) throw ApiError.notFound('Attendance record not found');
  await authz.assertCanViewEmployee(auth, pool, row.employee_id);
  const shift = await calc.getEmployeeShift(pool, row.employee_id, row.date);
  const mapped = integrity.mapRecordForResponse(row);
  return {
    ...mapped,
    shift_name: shift?.name || null,
    profile_photo_url: row.profile_photo_url,
    job_title: row.job_title,
    created_by_name: row.created_by_name,
    updated_by_name: row.updated_by_name,
    approved_by_name: row.approved_by_name,
    location_tracking_enabled: (await calc.loadSettings(pool))?.attendance_location_tracking === true,
  };
}

async function markAttendance(auth, user, data, req) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);
  if (!canManageOverride(auth)) {
    throw ApiError.forbidden('Attendance override requires attendance.manage permission');
  }
  await authz.assertCanModifyEmployee(auth, pool, Number(data.employeeId));

  const emp = await empRepo.findById(pool, data.employeeId);
  if (!emp) throw ApiError.notFound('Employee not found');

  const dateStr = data.date || todayStr();
  const existing = await repo.findByEmployeeAndDate(pool, data.employeeId, dateStr);
  req._punchCtx = await punchContext(pool, user.db_name, req);

  const record = await persistAttendance(pool, user, {
    employeeId: data.employeeId,
    date: dateStr,
    checkInTime: data.checkInTime ?? null,
    checkOutTime: data.checkOutTime ?? null,
    workMode: data.workMode,
    status: data.status,
    overtimeHours: data.overtimeHours,
    notes: data.notes,
    regularizationStatus: existing?.regularization_status || 'N/A',
    checkInIp: req._punchCtx.ip,
    checkOutIp: req._punchCtx.ip,
    checkInDevice: req._punchCtx.device,
    checkOutDevice: req._punchCtx.device,
    forceCheckIn: true,
    forceCheckOut: true,
  }, req, { isOverride: true });

  await audit.log(pool, {
    attendanceId: record.id,
    employeeId: data.employeeId,
    action: existing ? 'attendance.override.update' : 'attendance.override.create',
    oldValue: existing,
    newValue: record,
    performedBy: actorEmployeeId(user),
    ...audit.auditMeta(req),
  });

  const actorName = typeof actorEmployeeId === 'function' && user ? (user.name || user.email || 'Admin') : 'Admin';
  await notify.notifyOverride(pool, user.db_name, {
    employeeId: data.employeeId,
    date: dateStr,
    entityId: record.id,
    overriderName: actorName
  });

  return record;
}

const PUNCH_ALLOWED_STATUSES = new Set(['active', 'probation', 'notice period']);

async function assertActiveForPunch(pool, employeeId) {
  const { rows } = await pool.query(
    `SELECT employment_status, portal_enabled, onboarding_workflow_status,
            onboarding_completed_at
     FROM employees
     WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [employeeId],
  );
  if (!rows.length) throw ApiError.notFound('Employee not found');
  if (rows[0].portal_enabled === false) {
    throw ApiError.forbidden('Portal access is disabled for this employee');
  }

  let status = String(rows[0].employment_status || '').trim().toLowerCase();

  // Repair legacy rows: portal active but status still Onboarding after workflow completed
  if (status === 'onboarding') {
    const wf = String(rows[0].onboarding_workflow_status || '').trim().toLowerCase();
    if (rows[0].onboarding_completed_at || wf === 'onboarding_complete') {
      await pool.query(
        `UPDATE employees SET employment_status = 'Active', updated_at = NOW() WHERE id = $1`,
        [employeeId],
      );
      status = 'active';
    }
  }

  if (PUNCH_ALLOWED_STATUSES.has(status)) return;

  if (!status) {
    await pool.query(
      `UPDATE employees SET employment_status = 'Active', updated_at = NOW() WHERE id = $1`,
      [employeeId],
    );
    return;
  }

  if (status === 'onboarding') {
    throw ApiError.forbidden(
      'Check-in is not available until HR completes onboarding activation (employment status: Onboarding).',
    );
  }
  if (status === 'terminated' || status === 'resigned') {
    throw ApiError.forbidden(
      `Check-in is not available for employment status: ${rows[0].employment_status}.`,
    );
  }

  throw ApiError.forbidden(
    `Check-in is not available for employment status: ${rows[0].employment_status || 'Unknown'}.`,
  );
}

async function checkIn(auth, user, body, req) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);
  const employeeId = await resolveEmployeeId(pool, user, body.employeeId);
  if (employeeId) await assertActiveForPunch(pool, Number(employeeId));
  await authz.assertCanModifyEmployee(auth, pool, Number(employeeId));

  if (!canManageOverride(auth)) {
    if (body.date || body.checkInTime || body.checkOutTime) {
      throw ApiError.badRequest('Employees cannot set date or punch times manually');
    }
  }

  req._punchCtx = await punchContext(pool, user.db_name, req);
  const loc = locationFromBody(body, { attendance_location_tracking: req._punchCtx.locationTracking });
  const dateStr = canManageOverride(auth) && body.date ? body.date : todayStr();
  const time = canManageOverride(auth) && body.checkInTime ? body.checkInTime : nowTimeStr();

  const record = await persistAttendance(pool, user, {
    employeeId,
    date: dateStr,
    checkInTime: time,
    checkOutTime: null,
    workMode: body.workMode || 'In Office',
    checkInIp: req._punchCtx.ip,
    checkInDevice: req._punchCtx.device,
    checkInLatitude: loc.latitude,
    checkInLongitude: loc.longitude,
    checkInAddress: loc.address,
    forceCheckIn: true,
  }, req);

  await notify.notifyCheckIn(pool, user.db_name, {
    employeeId,
    time,
    date: dateStr,
    entityId: record.id,
  });

  if (record.status === 'Late') {
    await notify.notifyLateArrival(pool, user.db_name, {
      employeeId,
      time,
      date: dateStr,
      entityId: record.id,
    });
  }

  return record;
}

async function checkOut(auth, user, body, req) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);
  const employeeId = await resolveEmployeeId(pool, user, body.employeeId);
  if (employeeId) await assertActiveForPunch(pool, Number(employeeId));
  await authz.assertCanModifyEmployee(auth, pool, Number(employeeId));

  if (!canManageOverride(auth)) {
    if (body.date || body.checkInTime || body.checkOutTime) {
      throw ApiError.badRequest('Employees cannot set date or punch times manually');
    }
  }

  req._punchCtx = await punchContext(pool, user.db_name, req);
  const loc = locationFromBody(body, { attendance_location_tracking: req._punchCtx.locationTracking });
  const dateStr = canManageOverride(auth) && body.date ? body.date : todayStr();
  const existing = await repo.findByEmployeeAndDate(pool, employeeId, dateStr);
  const time = canManageOverride(auth) && body.checkOutTime ? body.checkOutTime : nowTimeStr();

  if (!existing?.check_in_time && !body.checkInTime) {
    throw ApiError.badRequest('Check-in is required before check-out');
  }

  const record = await persistAttendance(pool, user, {
    employeeId,
    date: dateStr,
    checkInTime: existing?.check_in_time,
    checkOutTime: time,
    workMode: body.workMode || existing?.work_mode || 'In Office',
    regularizationStatus: existing?.regularization_status,
    checkOutIp: req._punchCtx.ip,
    checkOutDevice: req._punchCtx.device,
    checkOutLatitude: loc.latitude,
    checkOutLongitude: loc.longitude,
    checkOutAddress: loc.address,
    forceCheckOut: true,
  }, req);

  await notify.notifyCheckOut(pool, user.db_name, {
    employeeId,
    time,
    date: dateStr,
    entityId: record.id,
  });

  // Overtime recorded → raise a manager approval request (non-blocking).
  if (Number(record.overtime_hours) > 0) {
    try {
      const flagged = await repo.markOvertimePending(pool, record.id);
      if (flagged) {
        await notify.notifyOtRequested(pool, user.db_name, {
          employeeId,
          date: dateStr,
          entityId: record.id,
          hours: record.overtime_hours,
        });
      }
    } catch (e) {
      logger.warn(`[attendance] overtime approval request failed for record ${record.id}`, e.message);
    }
  }

  return record;
}

async function submitRegularization(auth, user, body, req) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);

  const employeeId = body.employeeId || actorEmployeeId(user);
  if (!employeeId) throw ApiError.badRequest('employeeId required');
  await authz.assertCanModifyEmployee(auth, pool, Number(employeeId));

  const settings = await calc.loadSettings(pool);
  const who = settings?.who_can_submit_request || 'All employees';
  if (who === 'Managers only' && Number(employeeId) !== Number(actorEmployeeId(user))) {
    const emp = await authz.loadEmployee(pool, actorEmployeeId(user));
    if (!emp || !emp.reporting_manager_id) {
      throw ApiError.forbidden('Only managers can submit on behalf of others');
    }
  }

  const dateStr = body.date;
  if (!dateStr) throw ApiError.badRequest('date required');

  // Escalation: if the employee has no reporting manager, skip directly to Manager_Approved
  // so the Department Head becomes the first effective approver.
  const emp = await authz.loadEmployee(pool, Number(employeeId));
  const hasManager = !!(emp?.reporting_manager_id);
  const initialRegStatus = hasManager ? 'Pending' : 'Manager_Approved';

  const computed = await buildComputedRecord(pool, employeeId, dateStr, {
    checkInTime: body.checkInTime,
    checkOutTime: body.checkOutTime,
    workMode: body.workMode,
  }, body.workMode);

  // Build the active approval stage chain (column-based) from settings + the employee's
  // reporting manager / department. Stages with no possible approver are pruned.
  const targetEmp = await authz.loadEmployee(pool, Number(employeeId));
  const stages = workflow.buildStageChain(settings, targetEmp);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sanitized = integrity.sanitizeMetrics(
      { ...computed, status: 'Regularization Pending' },
      body.checkInTime,
      body.checkOutTime,
      initialRegStatus,
    );

    const record = await repo.upsert(pool, {
      employeeId,
      date: dateStr,
      checkInTime: body.checkInTime,
      checkOutTime: body.checkOutTime,
      workMode: body.workMode,
      status: sanitized.status,
      totalHours: sanitized.total_hours,
      workedHours: sanitized.worked_hours,
      breakHours: sanitized.break_hours,
      overtimeHours: sanitized.overtime_hours,
      lateMinutes: sanitized.late_minutes,
      earlyDepartureMinutes: sanitized.early_departure_minutes,
      isLate: sanitized.is_late,
      earlyDeparture: sanitized.early_departure,
      notes: normalizeNotes(body.notes),
      regularizationStatus: initialRegStatus,
      regularizationReason: body.reason,
      requestedBy: actorEmployeeId(user),
      currentApprovalLevel: hasManager ? 1 : 2,
      updatedBy: actorEmployeeId(user),
    }, client);

    await repo.initRegularizationStages(client, record.id, stages);
    await client.query('COMMIT');

    const full = await repo.findById(pool, record.id);
    const meta = audit.auditMeta(req);
    await audit.log(pool, {
      attendanceId: record.id,
      employeeId,
      action: 'attendance.regularization.submit',
      newValue: full,
      performedBy: actorEmployeeId(user),
      ...meta,
    });

    try {
      await notify.notifyRegSubmitted(pool, user.db_name, {
        employeeId,
        date: dateStr,
        entityId: record.id,
      });
    } catch (_) { /* non-blocking */ }

    return integrity.mapRecordForResponse(full);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function getPendingRegularizations(auth, user, query = {}) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);
  const limit = Math.min(100, parseInt(query.limit, 10) || 50);
  const offset = (Math.max(1, parseInt(query.page, 10) || 1) - 1) * limit;
  const records = await repo.getPendingRegularizations(pool, { limit, offset }, auth);
  return { records: mapRows(records), total: records.length };
}

// ─── Overtime approval ────────────────────────────────────────────────────────

async function getPendingOvertime(auth, user, query = {}) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);
  const limit = Math.min(100, parseInt(query.limit, 10) || 50);
  const offset = (Math.max(1, parseInt(query.page, 10) || 1) - 1) * limit;
  const records = await repo.getPendingOvertime(pool, { limit, offset }, auth);
  return { records, total: records.length };
}

/** Edit a Pending overtime entry (hours/reason). Approved/Rejected entries are locked. */
async function updateOvertime(auth, user, id, body) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);

  const record = await repo.findById(pool, id);
  if (!record) throw ApiError.notFound('Overtime record not found');
  if (record.overtime_status !== 'Pending') {
    throw ApiError.badRequest('Only pending overtime can be edited.');
  }
  await authz.assertCanModifyEmployee(auth, pool, Number(record.employee_id));

  const settings = await calc.loadSettings(pool);
  const patch = {};
  if (body.overtimeHours !== undefined) {
    const hours = Number(body.overtimeHours);
    if (!Number.isFinite(hours) || hours <= 0) {
      throw ApiError.badRequest('overtimeHours must be greater than 0');
    }
    const thresholdMinutes = Number(settings.overtime_minimum_threshold_minutes) || 0;
    if (hours * 60 < thresholdMinutes) {
      throw ApiError.badRequest(`Overtime must be at least the minimum threshold of ${thresholdMinutes} minute(s).`);
    }
    patch.overtimeHours = hours;
  }
  if (body.description !== undefined) {
    if (settings.overtime_require_reason !== false && !String(body.description || '').trim()) {
      throw ApiError.badRequest('A reason is required for overtime.');
    }
    patch.description = body.description;
  }
  if (Object.keys(patch).length === 0) throw ApiError.badRequest('Nothing to update');

  const updated = await repo.updateOvertimeFields(pool, id, patch);
  if (!updated) throw ApiError.badRequest('Overtime could not be updated (already processed?).');
  return updated;
}

/** Delete a Pending overtime entry. Approved/Rejected entries are locked. */
async function deleteOvertime(auth, user, id) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);

  const record = await repo.findById(pool, id);
  if (!record) throw ApiError.notFound('Overtime record not found');
  if (record.overtime_status !== 'Pending') {
    throw ApiError.badRequest('Only pending overtime can be deleted.');
  }
  await authz.assertCanModifyEmployee(auth, pool, Number(record.employee_id));

  const result = await repo.deleteOvertimeRecord(pool, id);
  return result || { id, removed: false };
}

/** All overtime records (history) for the Overtime Management page, scope-filtered. */
async function getOvertimeRecords(auth, user, query = {}) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);
  const limit = Math.min(200, parseInt(query.limit, 10) || 100);
  const offset = (Math.max(1, parseInt(query.page, 10) || 1) - 1) * limit;
  const records = await repo.getOvertimeRecords(
    pool,
    { status: query.status || '', search: query.search || '', limit, offset },
    auth,
  );
  return { records, total: records.length };
}

/**
 * Three-stage overtime approval workflow.
 *
 * Stage 1 (Pending)          → Reporting Manager (or Dept Head if no manager) → Manager_Approved
 * Stage 2 (Manager_Approved) → Department Head                                 → Dept_Approved
 * Stage 3 (Dept_Approved)    → HR / Admin                                      → Approved
 * Any stage with action='reject'                                                → Rejected
 */
async function processOvertime(auth, user, id, { action, reason }, req) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);

  const record = await repo.findById(pool, id);
  if (!record) throw ApiError.notFound('Attendance record not found');

  const actionableStatuses = ['Pending', 'Manager_Approved', 'Dept_Approved'];
  if (!actionableStatuses.includes(record.overtime_status)) {
    throw ApiError.badRequest('No pending overtime approval for this record');
  }

  // Segregation of duties — no self-approval at any stage.
  authz.assertNotSelfApproval(auth, record, 'overtime request');

  const emp = await authz.loadEmployee(pool, record.employee_id);
  if (!emp) throw ApiError.notFound('Employee not found');

  // Scope-based stage authorization.
  authz.assertCanActOnStage(auth, record.overtime_status, emp, action, 'overtime');

  const approverId = actorEmployeeId(user);

  // Determine stage label and next status.
  let stage, newStatus;
  if (record.overtime_status === 'Pending') {
    stage = 'manager';
    newStatus = action === 'approve' ? 'Manager_Approved' : 'Rejected';
  } else if (record.overtime_status === 'Manager_Approved') {
    stage = 'dept';
    newStatus = action === 'approve' ? 'Dept_Approved' : 'Rejected';
  } else {
    stage = 'hr';
    newStatus = action === 'approve' ? 'Approved' : 'Rejected';
  }

  const updated = await repo.updateOvertimeStatus(pool, id, {
    status:          newStatus,
    stage,
    actorId:         approverId,
    remarks:         action === 'approve' ? (reason || null) : null,
    rejectionReason: action === 'reject' ? (reason || null) : null,
    forwarded:       newStatus === 'Approved',
    currentStatus:   record.overtime_status,
  });
  if (!updated) throw ApiError.badRequest('Overtime update failed — record may have changed');

  const meta = audit.auditMeta(req);
  await audit.log(pool, {
    attendanceId: id,
    employeeId: record.employee_id,
    action: action === 'approve'
      ? `attendance.overtime.${stage}_approve`
      : `attendance.overtime.${stage}_reject`,
    oldValue: { overtime_status: record.overtime_status, overtime_hours: record.overtime_hours },
    newValue: updated,
    performedBy: approverId,
    ...meta,
  });

  try {
    if (newStatus === 'Approved') {
      await notify.notifyOtApproved(pool, user.db_name, {
        employeeId: record.employee_id, date: record.date,
        entityId: record.id, hours: record.overtime_hours,
      });
      await notify.notifyOtForwardedToDept(pool, user.db_name, {
        employeeId: record.employee_id, date: record.date,
        entityId: record.id, hours: record.overtime_hours,
      });
    } else if (newStatus === 'Manager_Approved') {
      // Notify Dept Head that it's now in their queue.
      await notify.notifyOtForwardedToDept(pool, user.db_name, {
        employeeId: record.employee_id, date: record.date,
        entityId: record.id, hours: record.overtime_hours,
      });
    } else if (newStatus === 'Rejected') {
      await notify.notifyOtRejected(pool, user.db_name, {
        employeeId: record.employee_id, date: record.date,
        entityId: record.id, hours: record.overtime_hours, reason,
      });
    }
  } catch (e) {
    logger.warn(`[attendance] overtime notification failed for record ${id}`, e.message);
  }

  return updated;
}

/**
 * Manually add an overtime entry for an employee (Add Overtime). Gated by the tenant's
 * overtime-eligibility setting, the configured minimum threshold, and the caller's data
 * scope. Only approvers may directly set Approved/Rejected; otherwise it lands as Pending.
 */
async function createOvertime(auth, user, body, req) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);

  const settings = await calc.loadSettings(pool);
  if (!settings?.overtime_eligibility) {
    throw ApiError.badRequest('Overtime is disabled. Enable it in Attendance settings first.');
  }

  // Default to the caller's own employee record (employee self-service). Managers may
  // pass another employeeId; assertCanModifyEmployee enforces scope + self-restriction,
  // so a self-scope employee can only ever add overtime for themselves.
  const employeeId = body.employeeId || actorEmployeeId(user);
  if (!employeeId) throw ApiError.badRequest('employeeId is required');
  await assertActiveForPunch(pool, Number(employeeId));
  await authz.assertCanModifyEmployee(auth, pool, Number(employeeId)); // enforces data scope

  const date = body.date;
  if (!date) throw ApiError.badRequest('date is required');

  if (settings.overtime_require_reason !== false && !String(body.description || '').trim()) {
    throw ApiError.badRequest('A reason is required for overtime.');
  }

  const hours = Number(body.overtimeHours);
  if (!Number.isFinite(hours) || hours <= 0) {
    throw ApiError.badRequest('overtimeHours must be greater than 0');
  }
  const thresholdMinutes = Number(settings.overtime_minimum_threshold_minutes) || 0;
  if (hours * 60 < thresholdMinutes) {
    throw ApiError.badRequest(
      `Overtime must be at least the minimum threshold of ${thresholdMinutes} minute(s).`,
    );
  }

  // Monthly cap (0 = unlimited): existing Pending+Approved OT this month (excluding this
  // date, which is being upserted) + the new hours must not exceed the configured cap.
  const maxPerMonth = Number(settings.overtime_max_per_month_hours) || 0;
  if (maxPerMonth > 0) {
    const [y, m] = String(date).split('-').map((x) => parseInt(x, 10));
    const existing = await repo.getMonthlyOvertimeHours(pool, Number(employeeId), y, m, date);
    if (existing + hours > maxPerMonth) {
      throw ApiError.badRequest(
        `This exceeds the monthly overtime cap of ${maxPerMonth} hour(s) ` +
        `(${existing} already recorded this month).`,
      );
    }
  }

  // Only approvers/managers may directly finalize; everyone else creates a Pending request.
  const canApprove = authz.canOverrideApproval(auth) || hasPermission(auth, P.ATTENDANCE_APPROVE);
  let status = String(body.status || 'Pending');
  if (!['Pending', 'Approved', 'Rejected'].includes(status)) status = 'Pending';
  if ((status === 'Approved' || status === 'Rejected') && !canApprove) status = 'Pending';
  // Segregation of duties: cannot self-approve.
  if (status === 'Approved' && Number(auth?.employeeId) === Number(employeeId)) status = 'Pending';

  // Escalation: if employee has no reporting manager, skip manager stage → Dept Head approves first.
  if (status === 'Pending') {
    const empRow = await authz.loadEmployee(pool, Number(employeeId));
    if (!empRow?.reporting_manager_id) status = 'Manager_Approved';
  }

  const approverId = actorEmployeeId(user);
  const record = await repo.upsertOvertime(pool, {
    employeeId,
    date,
    overtimeHours: hours,
    status,
    description: body.description,
    approvedBy: status === 'Approved' ? approverId : null,
    forwarded: status === 'Approved',
  });

  try {
    if (status === 'Approved') {
      await notify.notifyOtApproved(pool, user.db_name, { employeeId, date, entityId: record.id, hours });
      await notify.notifyOtForwardedToDept(pool, user.db_name, { employeeId, date, entityId: record.id, hours });
    } else if (status === 'Rejected') {
      await notify.notifyOtRejected(pool, user.db_name, { employeeId, date, entityId: record.id, hours, reason: body.description });
    } else {
      await notify.notifyOtRequested(pool, user.db_name, { employeeId, date, entityId: record.id, hours });
    }
  } catch (e) {
    logger.warn(`[attendance] overtime notification failed for record ${record.id}`, e.message);
  }

  try {
    const meta = audit.auditMeta(req);
    await audit.log(pool, {
      attendanceId: record.id,
      employeeId,
      action: 'attendance.overtime.create',
      oldValue: null,
      newValue: record,
      performedBy: approverId,
      ...meta,
    });
  } catch (auditErr) {
    logger.warn('[attendance] overtime audit log failed', { err: auditErr.message });
  }

  return record;
}

/**
 * Column-based three-stage regularization approval.
 *
 * Stage 1 (Pending)          → Reporting Manager (or Dept Head if no manager) → Manager_Approved
 * Stage 2 (Manager_Approved) → Department Head                                 → Dept_Approved
 * Stage 3 (Dept_Approved)    → HR / Admin                                      → Approved
 * Any stage with action='reject'                                                → Rejected
 */
async function regularize(auth, user, id, { action, reason }, req) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const record = await repo.findById(pool, id, client);
    if (!record) throw ApiError.notFound('Attendance record not found');

    const actionableStatuses = ['Pending', 'Manager_Approved', 'Dept_Approved'];
    if (!actionableStatuses.includes(record.regularization_status)) {
      throw ApiError.badRequest('Record is not pending regularization');
    }

    let stage = record.reg_current_stage;
    if (!stage || stage === 'done') {
      // Legacy / pre-staged-workflow record: migration 102 added the stage
      // columns (reg_current_stage, *_approval_status) without backfilling
      // requests that were already Pending, leaving them with a NULL stage.
      // Initialize the stage chain on the fly — same logic as submit — so the
      // request becomes actionable instead of being permanently stuck.
      const repairSettings = await calc.loadSettings(pool);
      const repairEmp = await authz.loadEmployee(pool, record.employee_id);
      const repairStages = workflow.buildStageChain(repairSettings, repairEmp);
      await repo.initRegularizationStages(client, record.id, repairStages);
      const repaired = await repo.findById(pool, record.id, client);
      if (repaired) Object.assign(record, repaired);
      stage = record.reg_current_stage;
    }
    if (!stage || stage === 'done') {
      throw ApiError.badRequest('Regularization has no pending stage to act on');
    }
    // No self-approval + per-stage hierarchy (manager = reporting manager,
    // department = dept head, hr = HR rights; admin/manage may override).
    await authz.assertCanActOnStage(auth, pool, record, stage, action);

    // Recompute the active chain to know the next stage after this one.
    const regSettings = await calc.loadSettings(pool);
    const regEmp = await authz.loadEmployee(pool, record.employee_id);
    const chain = workflow.buildStageChain(regSettings, regEmp);

    const approverId = actorEmployeeId(user);
    let regStatus;      // overall regularization_status
    let nextStage;      // reg_current_stage after this action
    let attStatus;      // attendance.status
    let stageStatus;    // this stage's column status

    if (action === 'reject') {
      stageStatus = 'Rejected';
      regStatus = 'Rejected';
      nextStage = 'done';
      attStatus = 'Regularization Rejected';
    } else { // approve
      stageStatus = 'Approved';
      const idx = chain.indexOf(stage);
      const next = idx >= 0 ? chain[idx + 1] : undefined;
      if (next) {
        regStatus = 'Pending';
        nextStage = next;
        attStatus = 'Regularization Pending';
      } else {
        regStatus = 'Approved';
        nextStage = 'done';
        attStatus = 'Regularization Approved';
        try {
          integrity.assertApprovedHasApprover(regStatus, approverId);
        } catch (e) {
          throw ApiError.badRequest(e.message);
        }
      }
    }

    const sanitized = integrity.sanitizeMetrics(
      {
        status: attStatus,
        worked_hours: record.worked_hours,
        total_hours: record.total_hours,
        overtime_hours: record.overtime_hours,
        is_late: record.is_late,
        paid_day: record.paid_day,
      },
      record.check_in_time,
      record.check_out_time,
      newRegStatus,
    );

    const updated = await repo.applyRegularizationDecision(client, id, {
      stage,
      stageStatus,
      actorId: approverId,
      regularizationStatus: regStatus,
      nextStage,
      attendanceStatus: sanitized.status,
      remarks: reason,
    });

    // Keep derived attendance metrics consistent with the sanitized status.
    await client.query(
      `UPDATE attendance SET overtime_hours = $1, is_late = $2, paid_day = $3, updated_by = $4 WHERE id = $5`,
      [sanitized.overtime_hours, sanitized.is_late, sanitized.paid_day, approverId, id],
    );

    await client.query('COMMIT');

    const meta = audit.auditMeta(req);
    await audit.log(pool, {
      attendanceId: id,
      employeeId: record.employee_id,
      action: action === 'approve'
        ? `attendance.regularization.${stage}_approve`
        : `attendance.regularization.${stage}_reject`,
      oldValue: { regularization_status: record.regularization_status },
      newValue: updated,
      performedBy: approverId,
      ...meta,
    });

    if (action === 'approve' && newRegStatus === 'Approved') {
      await notify.notifyRegApproved(pool, user.db_name, {
        employeeId: record.employee_id,
        date: record.date,
        entityId: record.id,
      });
    } else if (action === 'reject') {
      await notify.notifyRegRejected(pool, user.db_name, {
        employeeId: record.employee_id,
        date: record.date,
        entityId: record.id,
        reason: reason || 'Not specified',
      });
    }

    const finalRow = await repo.findById(pool, id);
    return integrity.mapRecordForResponse(finalRow);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function getPayrollSummary(auth, user, query) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);
  const employeeId = Number(query.employeeId);
  if (!employeeId) throw ApiError.badRequest('employeeId required');
  await authz.assertCanViewEmployee(auth, pool, employeeId);

  const now = new Date();
  const year = parseInt(query.year, 10) || now.getFullYear();
  const month = parseInt(query.month, 10) || now.getMonth() + 1;

  const summary = await repo.getPayrollSummary(pool, employeeId, year, month);
  return { employeeId, year, month, ...summary };
}

async function getMyToday(auth, user) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);
  const employeeId = await resolveEmployeeId(pool, user);
  const dateStr = todayStr();
  if (!employeeId) {
    // No linked employee profile — return an empty day rather than erroring so the
    // portal renders cleanly.
    return {
      date: dateStr,
      punchStatus: 'Not Checked In',
      record: null,
      isLate: false,
      overtimeHours: 0,
      workedHours: 0,
      status: 'Not Checked In',
      locationTrackingEnabled: false,
    };
  }
  await authz.assertCanViewEmployee(auth, pool, Number(employeeId));
  const record = await repo.findByEmployeeAndDate(pool, employeeId, dateStr);
  let punchStatus = 'Not Checked In';
  if (record?.check_in_time && !record?.check_out_time) punchStatus = 'Checked In';
  if (record?.check_out_time) punchStatus = 'Checked Out';

  const mapped = record ? integrity.mapRecordForResponse(record) : null;
  const settings = await calc.loadSettings(pool);
  const { rows: empRows } = await pool.query(
    `SELECT full_name, profile_image_url FROM employees WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [employeeId],
  );
  return {
    date: dateStr,
    punchStatus,
    record: mapped,
    isLate: mapped?.is_late || false,
    overtimeHours: mapped?.overtime_hours || 0,
    workedHours: mapped?.worked_hours || mapped?.total_hours || 0,
    status: mapped?.display_status || mapped?.status || null,
    locationTrackingEnabled: settings?.attendance_location_tracking === true,
    employeeName: empRows[0]?.full_name || null,
    profileImageUrl: empRows[0]?.profile_image_url || null,
  };
}

async function getDashboard(auth, user, query = {}) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);
  const date = query.date || todayStr();
  const widgets = await reportsEngine.getDashboard(pool, date, auth);
  return { date, widgets };
}

async function getReport(auth, user, query) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);
  const reportType = query.reportType || 'employee';
  if (!reportsEngine.REPORT_TYPES.includes(reportType)) {
    throw ApiError.badRequest(`Invalid reportType. Use: ${reportsEngine.REPORT_TYPES.join(', ')}`);
  }
  const scoped = reportsEngine.buildFilters(query, auth);
  return reportsEngine.runReport(pool, reportType, scoped, query);
}

async function getRegularizationHistory(auth, user, query) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);
  return reportsEngine.getRegularizationHistory(pool, query, auth);
}

async function exportReport(auth, user, query, format, req) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);
  const report = await getReport(auth, user, query);
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const branding = await tenantSettingsService.getAdminSettings(user.db_name, baseUrl);
  const generatedBy = user?.fullName || user?.email || 'System';
  const filterParts = Object.entries(query)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`);
  const filtersSummary = filterParts.length ? filterParts.join(' | ') : 'none';

  if (format === 'excel') {
    const wb = await exportEngine.buildExcel(
      branding,
      report.reportType,
      report.rows,
      filtersSummary,
    );
    const buffer = await wb.xlsx.writeBuffer();
    return { buffer, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: `attendance-${report.reportType}.xlsx` };
  }

  const buffer = await exportEngine.buildPdf(
    branding,
    report.reportType,
    report.rows,
    filtersSummary,
    generatedBy,
  );
  return { buffer, contentType: 'application/pdf', filename: `attendance-${report.reportType}.pdf` };
}

module.exports = {
  getAttendance,
  listAttendance,
  getRecordDetail,
  markAttendance,
  checkIn,
  checkOut,
  submitRegularization,
  getPendingRegularizations,
  regularize,
  getPendingOvertime,
  getOvertimeRecords,
  processOvertime,
  createOvertime,
  updateOvertime,
  deleteOvertime,
  getPayrollSummary,
  getMyToday,
  getDashboard,
  getReport,
  getRegularizationHistory,
  exportReport,
  buildComputedRecord,
  ensureMigrated,
  canManageOverride,
  mapRows,
  normalizeNotes,
};
