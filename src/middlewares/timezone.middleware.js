'use strict';

const { toTenantTime, nowInTenantTime, todayInTenantTime } = require('../utils/timezone');

/**
 * Attach tenant timezone configuration to request
 * This middleware should run after tenantResolver
 */
function timezoneMiddleware(req, res, next) {
  // Get timezone from tenant (set by tenantResolver)
  const timezone = req.tenant?.timezone || 'UTC';
  const dateFormat = req.tenant?.dateFormat || 'DD/MM/YYYY';
  const timeFormat = req.tenant?.timeFormat || '24h';

  // Attach timezone helpers to request
  req.timezone = {
    timezone,
    dateFormat,
    timeFormat,
    
    // Helper functions
    toTenantTime: (date, format) => toTenantTime(date, timezone, format),
    now: (format) => nowInTenantTime(timezone, format),
    today: () => todayInTenantTime(timezone),
  };

  // Also attach to response locals for use in templates if needed
  res.locals.timezone = req.timezone;

  next();
}

/**
 * Add timezone-aware response formatter
 * Transforms UTC timestamps in response data to tenant timezone
 */
function timezoneResponseFormatter(req, res, next) {
  const originalJson = res.json;

  res.json = function(data) {
    if (!req.timezone || !data) {
      return originalJson.call(this, data);
    }

    // Recursively transform timestamps in response data
    const transformed = transformTimestamps(data, req.timezone);
    return originalJson.call(this, transformed);
  };

  next();
}

/**
 * Recursively transform timestamps in data object
 * @param {*} data - Data to transform
 * @param {object} timezoneConfig - Timezone configuration
 * @returns {*} Transformed data
 */
function transformTimestamps(data, timezoneConfig) {
  if (data === null || data === undefined) {
    return data;
  }

  // Handle arrays
  if (Array.isArray(data)) {
    return data.map(item => transformTimestamps(item, timezoneConfig));
  }

  // Handle objects
  if (typeof data === 'object') {
    const transformed = {};
    for (const [key, value] of Object.entries(data)) {
      // Check if key is a timestamp field
      if (isTimestampField(key) && value) {
        transformed[key] = toTenantTime(
          value,
          timezoneConfig.timezone,
          `${timezoneConfig.dateFormat} ${timezoneConfig.timeFormat === '12h' ? 'hh:mm A' : 'HH:mm'}`
        );
      } else if (isDateField(key) && value) {
        transformed[key] = toTenantTime(value, timezoneConfig.timezone, timezoneConfig.dateFormat);
      } else if (isTimeField(key) && value) {
        transformed[key] = toTenantTime(value, timezoneConfig.timezone, timezoneConfig.timeFormat === '12h' ? 'hh:mm A' : 'HH:mm');
      } else {
        transformed[key] = transformTimestamps(value, timezoneConfig);
      }
    }
    return transformed;
  }

  return data;
}

/**
 * Check if field name indicates a timestamp
 */
function isTimestampField(key) {
  const timestampFields = [
    'created_at', 'updated_at', 'deleted_at',
    'createdAt', 'updatedAt', 'deletedAt',
    'check_in_time', 'check_out_time',
    'checkInTime', 'checkOutTime',
    'approved_at', 'actioned_at', 'completed_at',
    'approvedAt', 'actionedAt', 'completedAt',
    'exit_interview_date', 'return_date',
    'exitInterviewDate', 'returnDate',
  ];
  return timestampFields.includes(key);
}

/**
 * Check if field name indicates a date
 */
function isDateField(key) {
  const dateFields = [
    'date', 'from_date', 'to_date', 'due_date',
    'date_of_birth', 'join_date', 'probation_end_date',
    'passport_expiry', 'visa_expiry_date', 'emirates_id_expiry',
    'issue_date', 'expiry_date', 'effective_date', 'review_date',
    'last_working_day', 'expense_date',
  ];
  return dateFields.includes(key);
}

/**
 * Check if field name indicates a time
 */
function isTimeField(key) {
  const timeFields = [
    'time', 'check_in', 'check_out',
  ];
  return timeFields.includes(key);
}

module.exports = {
  timezoneMiddleware,
  timezoneResponseFormatter,
};
