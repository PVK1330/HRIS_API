'use strict';

const fs = require('fs');
const path = require('path');

const { getTenantPool } = require('../../config/db');
const env = require('../../config/env');
const ApiError = require('../../utils/ApiError');
const repository = require('./tenantSettings.repository');

const VALID_TIMEZONES = [
  'UTC',
  'UTC+05:30 - India (IST)',
  'UTC+04:00 - UAE (GST)',
  'UTC-05:00 - Eastern (EST)',
  'UTC-06:00 - Central (CST)',
  'UTC-07:00 - Mountain (MST)',
  'UTC-08:00 - Pacific (PST)',
  'UTC+00:00 - London (GMT)',
  'UTC+01:00 - Paris (CET)',
  'UTC+08:00 - Singapore (SGT)',
  'UTC+09:00 - Tokyo (JST)',
  'UTC+03:00 - Riyadh (AST)',
  'UTC+03:00 - Kuwait',
  'UTC+05:00 - Pakistan (PKT)',
  'UTC+06:00 - Bangladesh (BST)',
];

const VALID_WORK_CALENDARS = ['Standard 9-6', 'Flexible', '24x7', 'Custom'];

const VALID_FINANCIAL_YEAR_STARTS = ['January 1', 'April 1', 'July 1', 'October 1'];

const VALID_PROBATION_PERIODS = ['1 month', '2 months', '3 months', '6 months', '12 months'];

const VALID_NOTICE_PERIODS = ['15 days', '30 days', '45 days', '60 days', '90 days'];

const VALID_WORKING_DAY_CODES = new Set(['M', 'T', 'W', 'T2', 'F', 'S', 'S2']);

const CAMEL_TO_SNAKE = {
  companyName: 'company_name',
  logoUrl: 'logo_url',
  contactDetails: 'contact_details',
  financialYearStart: 'financial_year_start',
  workingDays: 'working_days',
  defaultWorkCalendar: 'default_work_calendar',
  regionalHolidaysEnabled: 'regional_holidays_enabled',
  multipleCalendarsEnabled: 'multiple_calendars_enabled',
  defaultProbationPeriod: 'default_probation_period',
  defaultNoticePeriod: 'default_notice_period',
  autoAssignPolicies: 'auto_assign_policies',
  locations: 'locations',
};

function mapToResponse(row) {
  if (!row) return null;
  return {
    id: row.id,
    companyName: row.company_name,
    logoUrl: row.logo_url,
    address: row.address,
    contactDetails: row.contact_details,
    country: row.country,
    timezone: row.timezone,
    financialYearStart: row.financial_year_start,
    workingDays: row.working_days,
    defaultWorkCalendar: row.default_work_calendar,
    regionalHolidaysEnabled: row.regional_holidays_enabled,
    multipleCalendarsEnabled: row.multiple_calendars_enabled,
    defaultProbationPeriod: row.default_probation_period,
    defaultNoticePeriod: row.default_notice_period,
    autoAssignPolicies: row.auto_assign_policies,
    locations: row.locations || [],
    updatedAt: row.updated_at,
  };
}

function normalizeBaseUrl(baseUrl) {
  if (!baseUrl || typeof baseUrl !== 'string') return '';
  return baseUrl.replace(/\/+$/, '');
}

function toAbsoluteAssetUrl(relativeOrAbsolute, baseUrl) {
  if (relativeOrAbsolute == null || relativeOrAbsolute === '') return null;
  const s = String(relativeOrAbsolute).trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return s.startsWith('/') ? s : `/${s}`;
  return `${base}${s.startsWith('/') ? s : `/${s}`}`;
}

function enrichLogoUrlField(mapped, baseUrl) {
  if (!mapped || !mapped.logoUrl) return mapped;
  return { ...mapped, logoUrl: toAbsoluteAssetUrl(mapped.logoUrl, baseUrl) };
}

function resolveUploadDiskPath(publicPath) {
  if (!publicPath || typeof publicPath !== 'string') return null;
  const trimmed = publicPath.trim();
  if (!trimmed.startsWith('/uploads/')) return null;
  const rel = trimmed.replace(/^\/uploads\/?/, '');
  return path.join(path.resolve(env.UPLOAD.dir), rel);
}

function mapBodyToFields(body) {
  const fields = {};
  if (!body || typeof body !== 'object') return fields;

  for (const [camel, snake] of Object.entries(CAMEL_TO_SNAKE)) {
    if (Object.prototype.hasOwnProperty.call(body, camel)) {
      fields[snake] = body[camel];
    }
  }

  const passthrough = [
    'address',
    'country',
    'timezone',
    'company_name',
    'logo_url',
    'contact_details',
    'financial_year_start',
    'working_days',
    'default_work_calendar',
    'regional_holidays_enabled',
    'multiple_calendars_enabled',
    'default_probation_period',
    'default_notice_period',
    'auto_assign_policies',
    'locations',
  ];

  for (const key of passthrough) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      fields[key] = body[key];
    }
  }

  return fields;
}

function validatePartialUpdate(body) {
  if (!body || typeof body !== 'object') return;

  const tzSet = new Set(VALID_TIMEZONES);
  const fySet = new Set(VALID_FINANCIAL_YEAR_STARTS);
  const calSet = new Set(VALID_WORK_CALENDARS);
  const probSet = new Set(VALID_PROBATION_PERIODS);
  const noticeSet = new Set(VALID_NOTICE_PERIODS);

  if (Object.prototype.hasOwnProperty.call(body, 'timezone')) {
    const v = body.timezone;
    if (v !== undefined && v !== null && !tzSet.has(String(v))) {
      throw new ApiError(400, 'Invalid timezone');
    }
  }

  const fy =
    body.financialYearStart !== undefined ? body.financialYearStart : body.financial_year_start;
  if (fy !== undefined && fy !== null && !fySet.has(String(fy))) {
    throw new ApiError(400, 'Invalid financial year start');
  }

  const dwc =
    body.defaultWorkCalendar !== undefined ? body.defaultWorkCalendar : body.default_work_calendar;
  if (dwc !== undefined && dwc !== null && !calSet.has(String(dwc))) {
    throw new ApiError(400, 'Invalid default work calendar');
  }

  const dp =
    body.defaultProbationPeriod !== undefined
      ? body.defaultProbationPeriod
      : body.default_probation_period;
  if (dp !== undefined && dp !== null && !probSet.has(String(dp))) {
    throw new ApiError(400, 'Invalid default probation period');
  }

  const dn =
    body.defaultNoticePeriod !== undefined
      ? body.defaultNoticePeriod
      : body.default_notice_period;
  if (dn !== undefined && dn !== null && !noticeSet.has(String(dn))) {
    throw new ApiError(400, 'Invalid default notice period');
  }

  const cn = body.companyName !== undefined ? body.companyName : body.company_name;
  if (cn !== undefined && cn !== null && String(cn).length > 255) {
    throw new ApiError(400, 'company_name must be at most 255 characters');
  }

  const cd =
    body.contactDetails !== undefined ? body.contactDetails : body.contact_details;
  if (cd !== undefined && cd !== null && String(cd).length > 100) {
    throw new ApiError(400, 'contact_details must be at most 100 characters');
  }

  const wd = body.workingDays !== undefined ? body.workingDays : body.working_days;
  if (wd !== undefined && wd !== null) {
    if (!Array.isArray(wd)) {
      throw new ApiError(400, 'working_days must be an array');
    }
    if (wd.length < 1 || wd.length > 7) {
      throw new ApiError(400, 'working_days must contain between 1 and 7 entries');
    }
    for (const item of wd) {
      if (!VALID_WORKING_DAY_CODES.has(String(item))) {
        throw new ApiError(400, 'Invalid working_days entry');
      }
    }
  }
}

async function getAdminSettings(dbName, baseUrl) {
  const pool = getTenantPool(dbName);
  let row = await repository.getSettings(pool);
  if (!row) {
    row = await repository.seedDefaultSettings(pool);
  }
  if (!row) {
    throw ApiError.notFound('Tenant admin settings not found');
  }
  return enrichLogoUrlField(mapToResponse(row), baseUrl);
}

async function updateAdminSettings(dbName, body, baseUrl) {
  validatePartialUpdate(body || {});
  const fields = mapBodyToFields(body || {});
  const pool = getTenantPool(dbName);
  const updated = await repository.updateSettings(pool, fields);
  if (!updated) {
    throw ApiError.notFound('Tenant admin settings not found');
  }
  return enrichLogoUrlField(mapToResponse(updated), baseUrl);
}

async function getTenantLogo(dbName, baseUrl) {
  const pool = getTenantPool(dbName);
  let row = await repository.getSettings(pool);
  if (!row) {
    row = await repository.seedDefaultSettings(pool);
  }
  if (!row) {
    throw ApiError.notFound('Tenant admin settings not found');
  }
  const rel = row.logo_url ? String(row.logo_url).trim() : '';
  const logoUrl = rel ? toAbsoluteAssetUrl(rel, baseUrl) : null;
  return { logoUrl, hasLogo: !!rel };
}

async function uploadLogo(dbName, file, baseUrl) {
  const pool = getTenantPool(dbName);
  const existingUrl = await repository.getExistingLogoUrl(pool);

  if (existingUrl) {
    const diskPath = resolveUploadDiskPath(existingUrl);
    if (diskPath && fs.existsSync(diskPath)) {
      fs.unlink(diskPath, () => {});
    }
  }

  const relativePath = file.location || `/uploads/tenant-logos/${file.filename}`;
  const updated = await repository.updateLogoUrl(pool, relativePath);
  if (!updated) {
    throw ApiError.notFound('Tenant admin settings not found');
  }
  const logoUrl = toAbsoluteAssetUrl(updated.logo_url, baseUrl);
  return { logoUrl, hasLogo: true };
}

module.exports = {
  getAdminSettings,
  updateAdminSettings,
  getTenantLogo,
  uploadLogo,
  VALID_TIMEZONES,
  VALID_WORK_CALENDARS,
  VALID_FINANCIAL_YEAR_STARTS,
  VALID_PROBATION_PERIODS,
  VALID_NOTICE_PERIODS,
};
