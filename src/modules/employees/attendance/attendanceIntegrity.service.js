'use strict';

const PRESENT_LIKE = new Set([
  'Present',
  'Late',
  'Remote',
  'Work From Home',
  'Field Duty',
  'Half Day',
]);

const TERMINAL_STATUSES = new Set([
  'On Leave',
  'Holiday',
  'Weekend',
  'Absent',
  'Regularization Rejected',
]);

/**
 * Present requires check-in, or approved regularization with at least check-in time.
 */
function mayShowAsPresent({ checkInTime, regularizationStatus }) {
  const hasIn = Boolean(checkInTime);
  if (hasIn) return true;
  if (regularizationStatus === 'Approved' && hasIn) return true;
  return false;
}

/**
 * Derive canonical display/storage status from punch + regularization state.
 */
function deriveStatus({
  status,
  checkInTime,
  checkOutTime,
  regularizationStatus,
  workedHours = 0,
  overtimeHours = 0,
  isLate = false,
}) {
  const reg = regularizationStatus || 'N/A';
  const hasIn = Boolean(checkInTime);
  const hasOut = Boolean(checkOutTime);
  const hours = Number(workedHours) || 0;
  const ot = Number(overtimeHours) || 0;
  let base = status || 'Absent';

  if (TERMINAL_STATUSES.has(base)) return base;

  if (reg === 'Pending') return 'Regularization Pending';

  if (!hasIn && !hasOut) {
    if (reg === 'Approved') return 'Missing Check In';
    return base === 'Absent' ? 'Absent' : 'Missing Check In';
  }

  if (!hasIn) return 'Missing Check In';
  if (!hasOut) return 'Missing Check Out';

  if (isLate && !hasIn) return 'Missing Check In';

  if (PRESENT_LIKE.has(base) && !mayShowAsPresent({ checkInTime, regularizationStatus: reg })) {
    return 'Missing Check In';
  }

  if (ot > 0 && hours <= 0) {
    /* caller zeros OT in sanitizeMetrics */
  }

  if (PRESENT_LIKE.has(base) && hours <= 0 && hasIn && hasOut) {
    return 'Half Day';
  }

  if (base === 'Regularization Approved' && hasIn) {
    return hasOut ? 'Present' : 'Missing Check Out';
  }

  return base;
}

function sanitizeMetrics(computed, checkInTime, checkOutTime, regularizationStatus) {
  let {
    status,
    worked_hours: workedHours,
    total_hours: totalHours,
    overtime_hours: overtimeHours,
    is_late: isLate,
  } = computed;

  const hasIn = Boolean(checkInTime);
  const hasOut = Boolean(checkOutTime);
  let wh = Number(workedHours) || 0;
  let ot = Number(overtimeHours) || 0;

  if (!hasIn || !hasOut) {
    if (regularizationStatus !== 'Approved') {
      ot = 0;
    }
  }

  if (ot > 0 && wh <= 0) ot = 0;
  if (isLate && !hasIn) isLate = false;

  status = deriveStatus({
    status,
    checkInTime,
    checkOutTime,
    regularizationStatus,
    workedHours: wh,
    overtimeHours: ot,
    isLate,
  });

  const paidPresent = (PRESENT_LIKE.has(status) && mayShowAsPresent({
    checkInTime,
    regularizationStatus,
  }))
    || status === 'Regularization Approved'
    || (regularizationStatus === 'Approved' && hasIn);

  return {
    ...computed,
    status,
    worked_hours: wh,
    total_hours: wh,
    overtime_hours: ot,
    is_late: isLate && hasIn,
    paid_day: computed.paid_day !== false && status !== 'Absent' && !String(status).startsWith('Missing'),
  };
}

function mapRecordForResponse(row) {
  if (!row) return null;
  const displayStatus = deriveStatus({
    status: row.status,
    checkInTime: row.check_in_time,
    checkOutTime: row.check_out_time,
    regularizationStatus: row.regularization_status,
    workedHours: row.worked_hours ?? row.total_hours,
    overtimeHours: row.overtime_hours,
    isLate: row.is_late,
  });
  return {
    ...row,
    display_status: displayStatus,
    status: displayStatus,
  };
}

function assertApprovedHasApprover(regularizationStatus, approvedBy) {
  if (regularizationStatus === 'Approved' && !approvedBy) {
    throw new Error('Approved regularization requires approver');
  }
}

module.exports = {
  PRESENT_LIKE,
  mayShowAsPresent,
  deriveStatus,
  sanitizeMetrics,
  mapRecordForResponse,
  assertApprovedHasApprover,
};
