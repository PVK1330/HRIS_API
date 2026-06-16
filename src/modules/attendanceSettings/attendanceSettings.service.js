'use strict';

const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const { ensureMigrated } = require('../../utils/tenantMigration');
const repository = require('./attendanceSettings.repository');
const settingsAuth = require('./attendanceSettingsAuth.service');
const settingsAudit = require('./attendanceSettingsAudit.service');
const {
  EARLY_DEPARTURE_RULES,
  WHO_CAN_SUBMIT,
  APPROVERS,
  OVERTIME_CALC_RULES,
  OVERTIME_APPROVAL,
  OVERTIME_APPROVERS,
} = require('./attendanceSettings.options');

const TIME_RE = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;

const CAMEL_TO_SNAKE = {
  workStartTime: 'work_start_time',
  workEndTime: 'work_end_time',
  breakDurationMinutes: 'break_duration_minutes',
  totalRequiredHours: 'total_required_hours',
  autoCalculateHours: 'auto_calculate_hours',
  minHoursForPresent: 'min_hours_for_present',
  tenMinuteBuffer: 'ten_minute_buffer',
  lateMarkAutoCalculation: 'late_mark_auto_calculation',
  graceDaysPerMonth: 'grace_days_per_month',
  earlyDepartureRule: 'early_departure_rule',
  whoCanSubmitRequest: 'who_can_submit_request',
  autoRejectionAfterDays: 'auto_rejection_after_days',
  overtimeEligibility: 'overtime_eligibility',
  overtimeCalculationRule: 'overtime_calculation_rule',
  overtimeApprovalWorkflow: 'overtime_approval_workflow',
  overtimeMinimumThresholdMinutes: 'overtime_minimum_threshold_minutes',
  overtimeMaxPerMonthHours: 'overtime_max_per_month_hours',
  overtimeApprover: 'overtime_approver',
  approvalWorkflowType: 'approval_workflow_type',
  weekendMode: 'weekend_mode',
  customWeekOffDays: 'custom_week_off_days',
  ukHolidayRegion: 'uk_holiday_region',
  shiftTypeDefault: 'shift_type_default',
  overtimeCustomMultiplier: 'overtime_custom_multiplier',
};

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
  'overtime_minimum_threshold_minutes',
  'overtime_max_per_month_hours',
  'overtime_approver',
  'overtime_require_reason',
  'approval_workflow_type',
  'weekend_mode',
  'custom_week_off_days',
  'uk_holiday_region',
  'shift_type_default',
  'shift_allow_employee_view',
  'shift_change_request_enabled',
  'regularization_allow_self',
  'regularization_max_per_month',
  'regularization_auto_approve_enabled',
  'regularization_auto_approve_after_days',
  'work_week_days',
  'grace_period_minutes',
  'half_day_threshold_hours',
  'biometric_sync_enabled',
  'wfh_marking_allowed',
  'overtime_custom_multiplier',
  'attendance_location_tracking',
  'present_status_code',
  'half_day_min_hours',
  'half_day_max_hours',
  'half_day_status_code',
  'absent_below_hours',
  'absent_status_code',
  'auto_mark_absent',
  'enable_late_mark',
  'late_mark_status_code',
  'penalty_3_lates_result',
  'penalty_6_lates_result',
  'late_mark_penalties',
]);

function formatHm(v) {
  if (v == null || v === '') return '';
  const s = typeof v === 'string' ? v : String(v);
  return s.length >= 5 ? s.slice(0, 5) : s;
}

function timeToMinutes(hm) {
  const s = formatHm(hm);
  const [h, m] = s.split(':').map((x) => parseInt(x, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return NaN;
  return h * 60 + m;
}

const DEFAULT_PENALTIES = [
  { count: 3, result: 'Half Day' },
  { count: 6, result: '1 Leave Deduction' },
];

function parseLateMarkPenalties(row) {
  // Prefer the new JSONB column
  if (row.late_mark_penalties) {
    try {
      const parsed = typeof row.late_mark_penalties === 'string'
        ? JSON.parse(row.late_mark_penalties)
        : row.late_mark_penalties;
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch { /* fall through */ }
  }
  // Fall back to legacy fixed columns
  return [
    { count: 3, result: row.penalty_3_lates_result || 'Half Day' },
    { count: 6, result: row.penalty_6_lates_result || '1 Leave Deduction' },
  ];
}

function mapToResponse(row) {
  if (!row) return null;
  return {
    id: row.id,
    workHours: {
      startTime: formatHm(row.work_start_time),
      endTime: formatHm(row.work_end_time),
      breakDurationMinutes: row.break_duration_minutes,
      totalRequiredHours: parseFloat(row.total_required_hours),
      autoCalculateHours: row.auto_calculate_hours,
    },
    attendanceRules: {
      minHoursForPresent: parseFloat(row.min_hours_for_present),
      tenMinuteBuffer: row.ten_minute_buffer,
      lateMarkAutoCalculation: row.late_mark_auto_calculation,
      graceDaysPerMonth: row.grace_days_per_month,
      earlyDepartureRule: row.early_departure_rule,
    },
    regularizationSettings: {
      whoCanSubmitRequest: row.who_can_submit_request,
      approver: row.approver,
      autoRejectionAfterDays: row.auto_rejection_after_days,
      approvalWorkflowType: row.approval_workflow_type,
      allowSelf: row.regularization_allow_self !== false,
      maxPerMonth: row.regularization_max_per_month ?? 3,
      autoApproveEnabled: row.regularization_auto_approve_enabled === true,
      autoApproveAfterDays: row.regularization_auto_approve_after_days ?? 3,
    },
    shiftSettings: {
      defaultShift: row.shift_type_default || 'General',
      allowEmployeeView: row.shift_allow_employee_view !== false,
      changeRequestEnabled: row.shift_change_request_enabled === true,
    },
    generalSettings: {
      workWeekDays: row.work_week_days || 'Mon,Tue,Wed,Thu,Fri',
      gracePeriodMinutes: row.grace_period_minutes ?? 10,
      halfDayThresholdHours: row.half_day_threshold_hours != null
        ? parseFloat(row.half_day_threshold_hours)
        : 4,
      biometricSyncEnabled: row.biometric_sync_enabled === true,
      wfhMarkingAllowed: row.wfh_marking_allowed !== false,
    },
    generalAttendance: {
      workWeekDays: row.work_week_days || 'Mon,Tue,Wed,Thu,Fri',
    },
    presentRules: {
      fullDayPresentHours: parseFloat(row.total_required_hours) || 8,
      minHoursForPresent: parseFloat(row.min_hours_for_present) || 8,
      presentStatusCode: row.present_status_code || 'P',
    },
    halfDayRules: {
      halfDayMinHours: row.half_day_min_hours != null ? parseFloat(row.half_day_min_hours) : 4,
      halfDayMaxHours: row.half_day_max_hours != null ? parseFloat(row.half_day_max_hours) : 7.98,
      halfDayStatusCode: row.half_day_status_code || 'HD',
    },
    absentRules: {
      absentBelowHours: row.absent_below_hours != null ? parseFloat(row.absent_below_hours) : 4,
      absentStatusCode: row.absent_status_code || 'A',
      autoMarkAbsent: row.auto_mark_absent !== false,
    },
    lateMarkRules: {
      gracePeriodMinutes: row.grace_period_minutes ?? 10,
      enableLateMark: row.enable_late_mark !== false,
      lateMarkStatusCode: row.late_mark_status_code || 'L',
      penalties: parseLateMarkPenalties(row),
    },
    weekendSettings: {
      weekendMode: row.weekend_mode,
      customWeekOffDays: row.custom_week_off_days,
    },
    holidaySettings: {
      ukHolidayRegion: row.uk_holiday_region,
    },
    shiftDefaults: {
      shiftTypeDefault: row.shift_type_default,
    },
    overtimeSettings: {
      overtimeEligibility: row.overtime_eligibility,
      calculationRule: row.overtime_calculation_rule,
      customMultiplier: row.overtime_custom_multiplier != null
        ? parseFloat(row.overtime_custom_multiplier)
        : 1,
      approvalWorkflow: row.overtime_approval_workflow,
      minimumThresholdMinutes: row.overtime_minimum_threshold_minutes != null
        ? parseInt(row.overtime_minimum_threshold_minutes, 10)
        : 30,
      maxPerMonthHours: row.overtime_max_per_month_hours != null
        ? parseFloat(row.overtime_max_per_month_hours)
        : 0,
      approver: row.overtime_approver || 'HR Department',
      payMultiplier: row.overtime_custom_multiplier != null
        ? parseFloat(row.overtime_custom_multiplier)
        : 1.5,
      requireReason: row.overtime_require_reason !== false,
    },
    locationTracking: {
      enabled: row.attendance_location_tracking === true,
    },
    updatedAt: row.updated_at,
  };
}

/**
 * Flatten nested / camelCase attendance payload onto snake_case keys for validators + PATCH.
 */
function mergeFlatAttendanceFields(body) {
  const patch = {};
  if (!body || typeof body !== 'object') {
    return patch;
  }

  const wh = body.workHours;
  const ar = body.attendanceRules;
  const rs = body.regularizationSettings;
  const os = body.overtimeSettings;
  const ss = body.shiftSettings;
  const gs = body.generalSettings;

  if (wh && typeof wh === 'object') {
    if (wh.startTime !== undefined) patch.work_start_time = wh.startTime;
    if (wh.endTime !== undefined) patch.work_end_time = wh.endTime;
    if (wh.breakDurationMinutes !== undefined) patch.break_duration_minutes = wh.breakDurationMinutes;
    if (wh.totalRequiredHours !== undefined) patch.total_required_hours = wh.totalRequiredHours;
    if (wh.autoCalculateHours !== undefined) patch.auto_calculate_hours = wh.autoCalculateHours;
  }
  if (ar && typeof ar === 'object') {
    if (ar.minHoursForPresent !== undefined) patch.min_hours_for_present = ar.minHoursForPresent;
    if (ar.tenMinuteBuffer !== undefined) patch.ten_minute_buffer = ar.tenMinuteBuffer;
    if (ar.lateMarkAutoCalculation !== undefined) {
      patch.late_mark_auto_calculation = ar.lateMarkAutoCalculation;
    }
    if (ar.graceDaysPerMonth !== undefined) patch.grace_days_per_month = ar.graceDaysPerMonth;
    if (ar.earlyDepartureRule !== undefined) patch.early_departure_rule = ar.earlyDepartureRule;
  }
  if (rs && typeof rs === 'object') {
    if (rs.whoCanSubmitRequest !== undefined) patch.who_can_submit_request = rs.whoCanSubmitRequest;
    if (rs.approver !== undefined) patch.approver = rs.approver;
    if (rs.autoRejectionAfterDays !== undefined) {
      patch.auto_rejection_after_days = rs.autoRejectionAfterDays;
    }
    if (rs.allowSelf !== undefined) patch.regularization_allow_self = rs.allowSelf;
    if (rs.maxPerMonth !== undefined) patch.regularization_max_per_month = rs.maxPerMonth;
    if (rs.autoApproveEnabled !== undefined) {
      patch.regularization_auto_approve_enabled = rs.autoApproveEnabled;
    }
    if (rs.autoApproveAfterDays !== undefined) {
      patch.regularization_auto_approve_after_days = rs.autoApproveAfterDays;
    }
  }
  if (os && typeof os === 'object') {
    if (os.overtimeEligibility !== undefined) patch.overtime_eligibility = os.overtimeEligibility;
    if (os.calculationRule !== undefined) patch.overtime_calculation_rule = os.calculationRule;
    if (os.customMultiplier !== undefined) patch.overtime_custom_multiplier = os.customMultiplier;
    if (os.approvalWorkflow !== undefined) {
      patch.overtime_approval_workflow = os.approvalWorkflow;
    }
    if (os.minimumThresholdMinutes !== undefined) {
      patch.overtime_minimum_threshold_minutes = os.minimumThresholdMinutes;
    }
    if (os.maxPerMonthHours !== undefined) {
      patch.overtime_max_per_month_hours = os.maxPerMonthHours;
    }
    if (os.approver !== undefined) patch.overtime_approver = os.approver;
    if (os.payMultiplier !== undefined) patch.overtime_custom_multiplier = os.payMultiplier;
    if (os.requireReason !== undefined) patch.overtime_require_reason = os.requireReason;
  }
  if (ss && typeof ss === 'object') {
    if (ss.defaultShift !== undefined) patch.shift_type_default = ss.defaultShift;
    if (ss.allowEmployeeView !== undefined) patch.shift_allow_employee_view = ss.allowEmployeeView;
    if (ss.changeRequestEnabled !== undefined) {
      patch.shift_change_request_enabled = ss.changeRequestEnabled;
    }
  }
  if (gs && typeof gs === 'object') {
    if (gs.workWeekDays !== undefined) patch.work_week_days = gs.workWeekDays;
    if (gs.gracePeriodMinutes !== undefined) patch.grace_period_minutes = gs.gracePeriodMinutes;
    if (gs.halfDayThresholdHours !== undefined) {
      patch.half_day_threshold_hours = gs.halfDayThresholdHours;
    }
    if (gs.biometricSyncEnabled !== undefined) patch.biometric_sync_enabled = gs.biometricSyncEnabled;
    if (gs.wfhMarkingAllowed !== undefined) patch.wfh_marking_allowed = gs.wfhMarkingAllowed;
  }

  // New section-based payload from the Attendance Settings UI
  const ga = body.generalAttendance;
  const pr = body.presentRules;
  const hd = body.halfDayRules;
  const ab = body.absentRules;
  const lm = body.lateMarkRules;

  if (ga && typeof ga === 'object') {
    if (ga.workWeekDays !== undefined) patch.work_week_days = ga.workWeekDays;
  }
  if (pr && typeof pr === 'object') {
    if (pr.fullDayPresentHours !== undefined) patch.total_required_hours = pr.fullDayPresentHours;
    if (pr.minHoursForPresent !== undefined) patch.min_hours_for_present = pr.minHoursForPresent;
    if (pr.presentStatusCode !== undefined) patch.present_status_code = pr.presentStatusCode;
  }
  if (hd && typeof hd === 'object') {
    if (hd.halfDayMinHours !== undefined) {
      patch.half_day_min_hours = hd.halfDayMinHours;
      patch.half_day_threshold_hours = hd.halfDayMinHours; // keep legacy column in sync
    }
    if (hd.halfDayMaxHours !== undefined) patch.half_day_max_hours = hd.halfDayMaxHours;
    if (hd.halfDayStatusCode !== undefined) patch.half_day_status_code = hd.halfDayStatusCode;
  }
  if (ab && typeof ab === 'object') {
    if (ab.absentBelowHours !== undefined) patch.absent_below_hours = ab.absentBelowHours;
    if (ab.absentStatusCode !== undefined) patch.absent_status_code = ab.absentStatusCode;
    if (ab.autoMarkAbsent !== undefined) patch.auto_mark_absent = ab.autoMarkAbsent;
  }
  if (lm && typeof lm === 'object') {
    if (lm.gracePeriodMinutes !== undefined) patch.grace_period_minutes = lm.gracePeriodMinutes;
    if (lm.enableLateMark !== undefined) {
      patch.enable_late_mark = lm.enableLateMark;
      patch.late_mark_auto_calculation = lm.enableLateMark; // keep legacy column in sync
    }
    if (lm.lateMarkStatusCode !== undefined) patch.late_mark_status_code = lm.lateMarkStatusCode;
    if (lm.penalties !== undefined && Array.isArray(lm.penalties)) {
      patch.late_mark_penalties = lm.penalties;
      // keep legacy columns in sync with first two tiers
      const t1 = lm.penalties.find((p) => p.count === 3);
      const t2 = lm.penalties.find((p) => p.count === 6);
      if (t1) patch.penalty_3_lates_result = t1.result;
      if (t2) patch.penalty_6_lates_result = t2.result;
    }
    if (lm.penalty3LatesResult !== undefined) patch.penalty_3_lates_result = lm.penalty3LatesResult;
    if (lm.penalty6LatesResult !== undefined) patch.penalty_6_lates_result = lm.penalty6LatesResult;
  }

  for (const [camel, snake] of Object.entries(CAMEL_TO_SNAKE)) {
    if (Object.prototype.hasOwnProperty.call(body, camel)) {
      patch[snake] = body[camel];
    }
  }

  for (const key of COLUMN_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      patch[key] = body[key];
    }
  }

  return { ...body, ...patch };
}

function extractPatch(body) {
  const patch = {};
  if (!body || typeof body !== 'object') return patch;
  for (const key of COLUMN_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      patch[key] = body[key];
    }
  }
  return patch;
}

function validateEnums(patch) {
  const earlySet = new Set(EARLY_DEPARTURE_RULES);
  const whoSet = new Set(WHO_CAN_SUBMIT);
  const approverSet = new Set(APPROVERS);
  const calcSet = new Set(OVERTIME_CALC_RULES);
  const apprSet = new Set(OVERTIME_APPROVAL);
  const otApproverSet = new Set(OVERTIME_APPROVERS);

  if (patch.early_departure_rule !== undefined && patch.early_departure_rule !== null) {
    if (!earlySet.has(String(patch.early_departure_rule))) {
      throw new ApiError(400, 'Invalid early_departure_rule');
    }
  }
  if (patch.who_can_submit_request !== undefined && patch.who_can_submit_request !== null) {
    if (!whoSet.has(String(patch.who_can_submit_request))) {
      throw new ApiError(400, 'Invalid who_can_submit_request');
    }
  }
  if (patch.approver !== undefined && patch.approver !== null) {
    if (!approverSet.has(String(patch.approver))) {
      throw new ApiError(400, 'Invalid approver');
    }
  }
  if (patch.overtime_calculation_rule !== undefined && patch.overtime_calculation_rule !== null) {
    if (!calcSet.has(String(patch.overtime_calculation_rule))) {
      throw new ApiError(400, 'Invalid overtime_calculation_rule');
    }
  }
  if (
    patch.overtime_approval_workflow !== undefined &&
    patch.overtime_approval_workflow !== null
  ) {
    if (!apprSet.has(String(patch.overtime_approval_workflow))) {
      throw new ApiError(400, 'Invalid overtime_approval_workflow');
    }
  }
  if (patch.overtime_approver !== undefined && patch.overtime_approver !== null) {
    if (!otApproverSet.has(String(patch.overtime_approver))) {
      throw new ApiError(400, 'Invalid overtime_approver');
    }
  }
}

function validateTimesAndRanges(patch) {
  const checkTime = (v, label) => {
    if (v === undefined || v === null || v === '') return;
    const s = formatHm(v);
    if (!TIME_RE.test(s)) {
      throw new ApiError(400, `Invalid ${label}`);
    }
  };

  checkTime(patch.work_start_time, 'work_start_time');
  checkTime(patch.work_end_time, 'work_end_time');

  if (patch.break_duration_minutes !== undefined && patch.break_duration_minutes !== null) {
    const n = Number(patch.break_duration_minutes);
    if (!Number.isInteger(n) || n < 0 || n > 120) {
      throw new ApiError(400, 'break_duration_minutes must be an integer from 0 to 120');
    }
  }

  if (patch.total_required_hours !== undefined && patch.total_required_hours !== null) {
    const n = parseFloat(patch.total_required_hours);
    if (Number.isNaN(n) || n < 1 || n > 24) {
      throw new ApiError(400, 'total_required_hours must be between 1 and 24');
    }
  }

  if (patch.min_hours_for_present !== undefined && patch.min_hours_for_present !== null) {
    const n = parseFloat(patch.min_hours_for_present);
    if (Number.isNaN(n) || n < 1 || n > 24) {
      throw new ApiError(400, 'min_hours_for_present must be between 1 and 24');
    }
  }

  if (patch.grace_days_per_month !== undefined && patch.grace_days_per_month !== null) {
    const n = Number(patch.grace_days_per_month);
    if (!Number.isInteger(n) || n < 0 || n > 31) {
      throw new ApiError(400, 'grace_days_per_month must be an integer from 0 to 31');
    }
  }

  if (
    patch.overtime_minimum_threshold_minutes !== undefined &&
    patch.overtime_minimum_threshold_minutes !== null
  ) {
    const n = Number(patch.overtime_minimum_threshold_minutes);
    if (!Number.isInteger(n) || n < 0 || n > 720) {
      throw new ApiError(400, 'overtime_minimum_threshold_minutes must be an integer from 0 to 720');
    }
  }

  if (
    patch.overtime_max_per_month_hours !== undefined &&
    patch.overtime_max_per_month_hours !== null
  ) {
    const n = parseFloat(patch.overtime_max_per_month_hours);
    if (Number.isNaN(n) || n < 0 || n > 744) {
      throw new ApiError(400, 'overtime_max_per_month_hours must be between 0 and 744');
    }
  }

  if (
    patch.auto_rejection_after_days !== undefined &&
    patch.auto_rejection_after_days !== null
  ) {
    const n = Number(patch.auto_rejection_after_days);
    if (!Number.isInteger(n) || n < 1 || n > 30) {
      throw new ApiError(400, 'auto_rejection_after_days must be an integer from 1 to 30');
    }
  }

  const intRange = (key, min, max) => {
    if (patch[key] === undefined || patch[key] === null) return;
    const n = Number(patch[key]);
    if (!Number.isInteger(n) || n < min || n > max) {
      throw new ApiError(400, `${key} must be an integer from ${min} to ${max}`);
    }
  };
  const floatRange = (key, min, max) => {
    if (patch[key] === undefined || patch[key] === null) return;
    const n = parseFloat(patch[key]);
    if (Number.isNaN(n) || n < min || n > max) {
      throw new ApiError(400, `${key} must be between ${min} and ${max}`);
    }
  };

  intRange('regularization_max_per_month', 0, 31);
  intRange('regularization_auto_approve_after_days', 0, 30);
  intRange('grace_period_minutes', 0, 120);
  floatRange('half_day_threshold_hours', 0, 24);
  floatRange('half_day_min_hours', 0, 24);
  floatRange('half_day_max_hours', 0, 24);
  floatRange('absent_below_hours', 0, 24);
  floatRange('overtime_custom_multiplier', 1, 10);
}

function validateCrossField(existingRow, patch) {
  const start =
    patch.work_start_time !== undefined
      ? patch.work_start_time
      : existingRow.work_start_time;
  const end =
    patch.work_end_time !== undefined ? patch.work_end_time : existingRow.work_end_time;

  if (start != null && end != null && formatHm(start) && formatHm(end)) {
    const sm = timeToMinutes(start);
    const em = timeToMinutes(end);
    if (!Number.isNaN(sm) && !Number.isNaN(em) && em <= sm) {
      throw new ApiError(400, 'End time must be after start time');
    }
  }

  const total =
    patch.total_required_hours !== undefined
      ? parseFloat(patch.total_required_hours)
      : parseFloat(existingRow.total_required_hours);
  const minH =
    patch.min_hours_for_present !== undefined
      ? parseFloat(patch.min_hours_for_present)
      : parseFloat(existingRow.min_hours_for_present);

  if (
    patch.min_hours_for_present !== undefined ||
    patch.total_required_hours !== undefined
  ) {
    if (!Number.isNaN(total) && !Number.isNaN(minH) && minH > total) {
      throw new ApiError(400, 'Min hours for present cannot exceed total required hours');
    }
  }
}

async function getAttendanceSettings(dbName, auth, req = null) {
  settingsAuth.assertCanViewSettings(auth);

  await ensureMigrated(dbName);
  const pool = getTenantPool(dbName);
  let row = await repository.getSettings(pool);
  if (!row) {
    row = await repository.seedDefault(pool);
  }
  if (!row) {
    throw ApiError.notFound('Attendance settings not found');
  }

  const data = mapToResponse(row);
  const ctx = req ? settingsAudit.auditContextFromReq(req) : {};
  await settingsAudit.logView(pool, ctx);
  return data;
}

async function updateAttendanceSettings(dbName, body, auth, req = null) {
  settingsAuth.assertCanManageSettings(auth);

  await ensureMigrated(dbName);
  const pool = getTenantPool(dbName);
  let existingRow = await repository.getSettings(pool);
  if (!existingRow) {
    existingRow = await repository.seedDefault(pool);
  }
  if (!existingRow) {
    throw ApiError.notFound('Attendance settings not found');
  }

  const flat = mergeFlatAttendanceFields(body || {});
  const patch = extractPatch(flat);

  if (Object.keys(patch).length === 0) {
    return mapToResponse(existingRow);
  }

  validateEnums(patch);
  validateTimesAndRanges(patch);
  validateCrossField(existingRow, patch);

  const oldValue = mapToResponse(existingRow);
  const updated = await repository.updateSettings(pool, patch);
  if (!updated) {
    throw ApiError.notFound('Attendance settings not found');
  }
  const newValue = mapToResponse(updated);

  const ctx = req ? settingsAudit.auditContextFromReq(req) : {};
  await settingsAudit.logUpdate(pool, {
    oldValue,
    newValue,
    ...ctx,
  });

  return newValue;
}

module.exports = {
  getAttendanceSettings,
  updateAttendanceSettings,
  mergeFlatAttendanceFields,
  EARLY_DEPARTURE_RULES,
  WHO_CAN_SUBMIT,
  APPROVERS,
  OVERTIME_CALC_RULES,
  OVERTIME_APPROVAL,
  OVERTIME_APPROVERS,
  TIME_RE,
};
