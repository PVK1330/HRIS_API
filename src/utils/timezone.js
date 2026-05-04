// src/utils/timezone.js
const moment = require('moment-timezone');

/**
 * List of supported timezones
 */
const SUPPORTED_TIMEZONES = [
  { value: 'UTC', label: 'UTC (Coordinated Universal Time)', offset: '+00:00' },
  { value: 'Asia/Kolkata', label: 'India (IST)', offset: '+05:30' },
  { value: 'America/New_York', label: 'Eastern Time (US & Canada)', offset: '-05:00' },
  { value: 'America/Chicago', label: 'Central Time (US & Canada)', offset: '-06:00' },
  { value: 'America/Denver', label: 'Mountain Time (US & Canada)', offset: '-07:00' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (US & Canada)', offset: '-08:00' },
  { value: 'Europe/London', label: 'London (GMT/BST)', offset: '+00:00' },
  { value: 'Europe/Paris', label: 'Central European Time', offset: '+01:00' },
  { value: 'Europe/Berlin', label: 'Berlin (CET/CEST)', offset: '+01:00' },
  { value: 'Asia/Dubai', label: 'Dubai (GST)', offset: '+04:00' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)', offset: '+09:00' },
  { value: 'Asia/Singapore', label: 'Singapore (SGT)', offset: '+08:00' },
  { value: 'Australia/Sydney', label: 'Sydney (AEST/AEDT)', offset: '+11:00' },
  { value: 'Pacific/Auckland', label: 'Auckland (NZST/NZDT)', offset: '+13:00' },
];

/**
 * Get timezone by value
 * @param {string} timezone - Timezone identifier
 * @returns {object|null} Timezone object or null
 */
function getTimezone(timezone) {
  return SUPPORTED_TIMEZONES.find(tz => tz.value === timezone) || null;
}

/**
 * Convert UTC datetime to tenant timezone
 * @param {Date|string} utcDate - UTC datetime
 * @param {string} timezone - Target timezone
 * @param {string} format - Output format (default: YYYY-MM-DD HH:mm:ss)
 * @returns {string} Formatted datetime in tenant timezone
 */
function toTenantTime(utcDate, timezone = 'UTC', format = 'YYYY-MM-DD HH:mm:ss') {
  if (!utcDate) return null;
  return moment.utc(utcDate).tz(timezone).format(format);
}

/**
 * Convert tenant timezone datetime to UTC
 * @param {string} localDate - Local datetime in tenant timezone
 * @param {string} timezone - Source timezone
 * @returns {Date} UTC datetime
 */
function toUtc(localDate, timezone = 'UTC') {
  if (!localDate) return null;
  return moment.tz(localDate, timezone).utc().toDate();
}

/**
 * Get current datetime in tenant timezone
 * @param {string} timezone - Tenant timezone
 * @param {string} format - Output format
 * @returns {string} Current datetime in tenant timezone
 */
function nowInTenantTime(timezone = 'UTC', format = 'YYYY-MM-DD HH:mm:ss') {
  return moment().tz(timezone).format(format);
}

/**
 * Get current date in tenant timezone
 * @param {string} timezone - Tenant timezone
 * @returns {string} Current date in tenant timezone (YYYY-MM-DD)
 */
function todayInTenantTime(timezone = 'UTC') {
  return moment().tz(timezone).format('YYYY-MM-DD');
}

/**
 * Get start of day in tenant timezone (UTC)
 * @param {string} timezone - Tenant timezone
 * @returns {Date} Start of day in UTC
 */
function startOfDayInTenantTime(timezone = 'UTC') {
  return moment().tz(timezone).startOf('day').utc().toDate();
}

/**
 * Get end of day in tenant timezone (UTC)
 * @param {string} timezone - Tenant timezone
 * @returns {Date} End of day in UTC
 */
function endOfDayInTenantTime(timezone = 'UTC') {
  return moment().tz(timezone).endOf('day').utc().toDate();
}

/**
 * Check if a date is within business hours in tenant timezone
 * @param {Date} date - Date to check
 * @param {string} timezone - Tenant timezone
 * @param {object} businessHours - Business hours config { start: '09:00', end: '18:00' }
 * @returns {boolean} True if within business hours
 */
function isBusinessHours(date, timezone = 'UTC', businessHours = { start: '09:00', end: '18:00' }) {
  const localTime = moment(date).tz(timezone);
  const hour = localTime.hour();
  const minute = localTime.minute();
  
  const [startHour, startMin] = businessHours.start.split(':').map(Number);
  const [endHour, endMin] = businessHours.end.split(':').map(Number);
  
  const currentMinutes = hour * 60 + minute;
  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;
  
  return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
}

/**
 * Format date according to tenant's date format
 * @param {Date|string} date - Date to format
 * @param {string} timezone - Tenant timezone
 * @param {string} dateFormat - Date format (DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD)
 * @returns {string} Formatted date
 */
function formatDate(date, timezone = 'UTC', dateFormat = 'DD/MM/YYYY') {
  if (!date) return null;
  return moment.utc(date).tz(timezone).format(dateFormat);
}

/**
 * Format time according to tenant's time format
 * @param {Date|string} date - Date to format
 * @param {string} timezone - Tenant timezone
 * @param {string} timeFormat - Time format (12h, 24h)
 * @returns {string} Formatted time
 */
function formatTime(date, timezone = 'UTC', timeFormat = '24h') {
  if (!date) return null;
  const format = timeFormat === '12h' ? 'hh:mm A' : 'HH:mm';
  return moment.utc(date).tz(timezone).format(format);
}

/**
 * Format datetime according to tenant's preferences
 * @param {Date|string} date - Date to format
 * @param {string} timezone - Tenant timezone
 * @param {string} dateFormat - Date format
 * @param {string} timeFormat - Time format
 * @returns {string} Formatted datetime
 */
function formatDateTime(date, timezone = 'UTC', dateFormat = 'DD/MM/YYYY', timeFormat = '24h') {
  if (!date) return null;
  const timeFmt = timeFormat === '12h' ? 'hh:mm A' : 'HH:mm';
  return moment.utc(date).tz(timezone).format(`${dateFormat} ${timeFmt}`);
}

/**
 * Get timezone offset string
 * @param {string} timezone - Timezone identifier
 * @returns {string} Offset string (e.g., +05:30)
 */
function getTimezoneOffset(timezone) {
  const offset = moment.tz(timezone).format('Z');
  return offset;
}

/**
 * Validate timezone identifier
 * @param {string} timezone - Timezone identifier
 * @returns {boolean} True if valid
 */
function isValidTimezone(timezone) {
  return SUPPORTED_TIMEZONES.some(tz => tz.value === timezone);
}

module.exports = {
  SUPPORTED_TIMEZONES,
  getTimezone,
  toTenantTime,
  toUtc,
  nowInTenantTime,
  todayInTenantTime,
  startOfDayInTenantTime,
  endOfDayInTenantTime,
  isBusinessHours,
  formatDate,
  formatTime,
  formatDateTime,
  getTimezoneOffset,
  isValidTimezone,
};
