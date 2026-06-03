'use strict';

async function log(pool, {
  attendanceId,
  employeeId,
  action,
  oldValue,
  newValue,
  performedBy,
  ipAddress,
  deviceInfo,
}) {
  await pool.query(
    `INSERT INTO attendance_audit_logs
       (attendance_id, employee_id, action, old_value, new_value,
        performed_by, ip_address, device_info)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8)`,
    [
      attendanceId || null,
      employeeId || null,
      action,
      oldValue ? JSON.stringify(oldValue) : null,
      newValue ? JSON.stringify(newValue) : null,
      performedBy || null,
      ipAddress || null,
      deviceInfo || null,
    ],
  );
}

function auditMeta(req) {
  return {
    ipAddress: req?.ip || req?.headers?.['x-forwarded-for'] || null,
    deviceInfo: req?.headers?.['user-agent'] || null,
  };
}

module.exports = { log, auditMeta };
