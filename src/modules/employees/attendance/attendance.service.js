'use strict';

const { getTenantPool } = require('../../../config/db');
const ApiError = require('../../../utils/ApiError');
const { runTenantMigrations } = require('../../tenant/tenant.service');
const empRepo = require('../employees.repository');
const repo = require('./attendance.repository');
const authz = require('./attendanceAuth.service');
const calc = require('./attendanceCalculation.service');
const graceEngine = require('./attendanceGrace.service');
const audit = require('./attendanceAudit.service');
const approval = require('./attendanceApproval.service');
const notify = require('./attendanceNotifications.service');
const reportsEngine = require('./attendanceReports.service');
const exportEngine = require('./attendanceExport.service');
const tenantSettingsService = require('../../tenantSettings/tenantSettings.service');
const integrity = require('./attendanceIntegrity.service');
const { hasPermission } = require('../../../services/authz.service');
const { P } = require('../../../constants/permissions');

const _cache = new Map();
async function ensureMigrated(dbName) {
  if (_cache.has(dbName)) return _cache.get(dbName);
  const p = runTenantMigrations(dbName).catch((err) => {
    _cache.delete(dbName);
    throw ApiError.internal('Database setup failed.');
  });
  _cache.set(dbName, p);
  return p;
}

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
  const employeeId = body.employeeId || actorEmployeeId(user);
  if (!employeeId) throw ApiError.badRequest('Employee profile required');
  await assertActiveForPunch(pool, Number(employeeId));
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

  await notify.notifyEmployee(pool, user.db_name, {
    employeeId,
    type: notify.TYPES.CHECK_IN,
    title: 'Check-in recorded',
    message: `You checked in at ${time}`,
    entityId: record.id,
  });

  if (record.status === 'Late') {
    await notify.notifyEmployee(pool, user.db_name, {
      employeeId,
      type: notify.TYPES.LATE,
      title: 'Late arrival',
      message: `Late check-in recorded at ${time}`,
      entityId: record.id,
    });
  }

  return record;
}

async function checkOut(auth, user, body, req) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);
  const employeeId = body.employeeId || actorEmployeeId(user);
  if (!employeeId) throw ApiError.badRequest('Employee profile required');
  await assertActiveForPunch(pool, Number(employeeId));
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

  await notify.notifyEmployee(pool, user.db_name, {
    employeeId,
    type: notify.TYPES.CHECK_OUT,
    title: 'Check-out recorded',
    message: `You checked out at ${time}`,
    entityId: record.id,
  });

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

  const computed = await buildComputedRecord(pool, employeeId, dateStr, {
    checkInTime: body.checkInTime,
    checkOutTime: body.checkOutTime,
    workMode: body.workMode,
  }, body.workMode);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sanitized = integrity.sanitizeMetrics(
      {
        ...computed,
        status: 'Regularization Pending',
      },
      body.checkInTime,
      body.checkOutTime,
      'Pending',
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
      regularizationStatus: 'Pending',
      regularizationReason: body.reason,
      requestedBy: actorEmployeeId(user),
      currentApprovalLevel: 1,
      updatedBy: actorEmployeeId(user),
    }, client);

    await approval.createSteps(client, record.id, settings);
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

    await notify.notifyEmployee(pool, user.db_name, {
      employeeId,
      type: notify.TYPES.REG_SUBMITTED,
      title: 'Regularization submitted',
      message: `Your request for ${dateStr} is pending approval`,
      entityId: record.id,
    });
    await notify.notifyManagersForRegularization(pool, user.db_name, full);

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

async function regularize(auth, user, id, { action, reason }, req) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const record = await repo.findById(pool, id, client);
    if (!record) throw ApiError.notFound('Attendance record not found');
    if (record.regularization_status !== 'Pending') {
      throw ApiError.badRequest('Record is not pending regularization');
    }

    const pendingStep = await approval.getPendingStep(client, id);
    await authz.assertCanActOnPendingStep(auth, pool, record, pendingStep, action);

    const result = await approval.advanceOrComplete(
      client,
      id,
      actorEmployeeId(user),
      reason,
      action,
    );

    const regStatus = result.finalStatus;
    let attStatus = record.status;
    if (regStatus === 'Approved') {
      attStatus = 'Regularization Approved';
    } else if (regStatus === 'Rejected') {
      attStatus = 'Regularization Rejected';
    } else if (regStatus === 'Pending') {
      attStatus = 'Regularization Pending';
    }

    const approverId = actorEmployeeId(user);
    if (regStatus === 'Approved') {
      try {
        integrity.assertApprovedHasApprover(regStatus, approverId);
      } catch (e) {
        throw ApiError.badRequest(e.message);
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
      regStatus,
    );

    const updated = await repo.updateRegularization(client, id, {
      status: regStatus,
      approvedBy: approverId,
      remarks: reason,
      attendanceStatus: sanitized.status,
      currentApprovalLevel: result.currentLevel ?? record.current_approval_level,
    });

    await client.query(
      `UPDATE attendance SET status = $1, overtime_hours = $2, is_late = $3, paid_day = $4, updated_by = $5 WHERE id = $6`,
      [sanitized.status, sanitized.overtime_hours, sanitized.is_late, sanitized.paid_day, approverId, id],
    );

    await client.query('COMMIT');

    const meta = audit.auditMeta(req);
    await audit.log(pool, {
      attendanceId: id,
      employeeId: record.employee_id,
      action: action === 'approve' ? 'attendance.regularization.approve' : 'attendance.regularization.reject',
      oldValue: record,
      newValue: updated,
      performedBy: actorEmployeeId(user),
      ...meta,
    });

    const type = action === 'approve' ? notify.TYPES.REG_APPROVED : notify.TYPES.REG_REJECTED;
    await notify.notifyEmployee(pool, user.db_name, {
      employeeId: record.employee_id,
      type,
      title: `Regularization ${regStatus.toLowerCase()}`,
      message: `Your attendance regularization for ${record.date} was ${regStatus.toLowerCase()}`,
      entityId: id,
    });

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
  const employeeId = actorEmployeeId(user);
  if (!employeeId) throw ApiError.badRequest('Employee profile required');
  await authz.assertCanViewEmployee(auth, pool, Number(employeeId));

  const dateStr = todayStr();
  const record = await repo.findByEmployeeAndDate(pool, employeeId, dateStr);
  let punchStatus = 'Not Checked In';
  if (record?.check_in_time && !record?.check_out_time) punchStatus = 'Checked In';
  if (record?.check_out_time) punchStatus = 'Checked Out';

  const mapped = record ? integrity.mapRecordForResponse(record) : null;
  const settings = await calc.loadSettings(pool);
  return {
    date: dateStr,
    punchStatus,
    record: mapped,
    isLate: mapped?.is_late || false,
    overtimeHours: mapped?.overtime_hours || 0,
    workedHours: mapped?.worked_hours || mapped?.total_hours || 0,
    status: mapped?.display_status || mapped?.status || null,
    locationTrackingEnabled: settings?.attendance_location_tracking === true,
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
