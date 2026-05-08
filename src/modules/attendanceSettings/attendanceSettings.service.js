'use strict';

const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const repository = require('./attendanceSettings.repository');
const {
  EARLY_DEPARTURE_RULES,
  WHO_CAN_SUBMIT,
  APPROVERS,
  OVERTIME_CALC_RULES,
  OVERTIME_APPROVAL,
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
    },
    overtimeSettings: {
      overtimeEligibility: row.overtime_eligibility,
      calculationRule: row.overtime_calculation_rule,
      approvalWorkflow: row.overtime_approval_workflow,
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
  }
  if (os && typeof os === 'object') {
    if (os.overtimeEligibility !== undefined) patch.overtime_eligibility = os.overtimeEligibility;
    if (os.calculationRule !== undefined) patch.overtime_calculation_rule = os.calculationRule;
    if (os.approvalWorkflow !== undefined) {
      patch.overtime_approval_workflow = os.approvalWorkflow;
    }
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
    patch.auto_rejection_after_days !== undefined &&
    patch.auto_rejection_after_days !== null
  ) {
    const n = Number(patch.auto_rejection_after_days);
    if (!Number.isInteger(n) || n < 1 || n > 30) {
      throw new ApiError(400, 'auto_rejection_after_days must be an integer from 1 to 30');
    }
  }
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

async function getAttendanceSettings(dbName) {
  const pool = getTenantPool(dbName);
  let row = await repository.getSettings(pool);
  if (!row) {
    row = await repository.seedDefault(pool);
  }
  if (!row) {
    throw ApiError.notFound('Attendance settings not found');
  }
  return mapToResponse(row);
}

async function updateAttendanceSettings(dbName, body) {
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

  const updated = await repository.updateSettings(pool, patch);
  if (!updated) {
    throw ApiError.notFound('Attendance settings not found');
  }
  return mapToResponse(updated);
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
  TIME_RE,
};
