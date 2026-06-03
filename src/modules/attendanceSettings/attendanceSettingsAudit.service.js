'use strict';

const audit = require('../employees/attendance/attendanceAudit.service');

async function logView(pool, { performedBy, ipAddress, deviceInfo }) {
  await audit.log(pool, {
    action: 'attendance.settings.view',
    performedBy: performedBy || null,
    ipAddress: ipAddress || null,
    deviceInfo: deviceInfo || null,
    newValue: { accessed_at: new Date().toISOString() },
  });
}

async function logUpdate(pool, {
  oldValue,
  newValue,
  performedBy,
  ipAddress,
  deviceInfo,
}) {
  await audit.log(pool, {
    action: 'attendance.settings.update',
    oldValue,
    newValue,
    performedBy: performedBy || null,
    ipAddress: ipAddress || null,
    deviceInfo: deviceInfo || null,
  });
}

function auditContextFromReq(req) {
  const meta = audit.auditMeta(req);
  return {
    performedBy: req?.auth?.employeeId || req?.user?.employeeId || null,
    ...meta,
  };
}

module.exports = {
  logView,
  logUpdate,
  auditContextFromReq,
};
