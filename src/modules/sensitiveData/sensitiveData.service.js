'use strict';

const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const repository = require('./sensitiveData.repository');

const VISIBILITY_OPTIONS_DOC = ['HR only', 'Manager + HR', 'All', 'Employee (own only)'];

const VISIBILITY_OPTIONS_VISA = [
  'Full Access',
  'Limited Access',
  'Hidden',
  'Own info only',
];

const NOTES_VISIBILITY_OPTIONS = ['HR only', 'Manager + HR', 'All'];

const FALLBACK_VISA_ROLES = ['HR Admin', 'HR Executive', 'Manager', 'Employee'];

const SALARY_FIELD_MAP = {
  salaryBreakup: 'salary_breakup_visibility',
  ctc: 'ctc_visibility',
  payslips: 'payslips_visibility',
  revisions: 'revisions_visibility',
  payrollReports: 'payroll_reports_visibility',
};

const DOC_FIELD_MAP = {
  passportCopy: 'passport_copy_visibility',
  visaCopy: 'visa_copy_visibility',
  nationalId: 'national_id_visibility',
  medicalDocuments: 'medical_documents_visibility',
  performanceIssues: 'performance_issues_visibility',
};

function dedupePreserve(items) {
  const seen = new Set();
  const out = [];
  for (const x of items) {
    if (x == null || String(x).trim() === '') continue;
    const key = String(x);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function buildSalaryVisibilityOptions(roleRows) {
  const roleNames = Array.isArray(roleRows) ? roleRows.map((r) => r.name).filter(Boolean) : [];
  const payrollExtras = ['HR Admin + Payroll Team', 'HR Admin + Manager'];
  const roleOnly = roleNames.map((n) => `${n} only`);

  if (!roleNames.length) {
    return dedupePreserve(['HR Admin only', ...payrollExtras, 'Employee (own only)']);
  }

  return dedupePreserve([
    'HR Admin only',
    ...roleOnly,
    'Employee (own only)',
    ...payrollExtras,
  ]);
}

function mapToResponse(row) {
  if (!row) return null;
  let visa = row.visa_nationality_visibility;
  if (typeof visa === 'string') {
    try {
      visa = JSON.parse(visa);
    } catch {
      visa = {};
    }
  }
  if (!visa || typeof visa !== 'object') visa = {};

  return {
    salaryDataVisibility: {
      salaryBreakup: row.salary_breakup_visibility,
      ctc: row.ctc_visibility,
      payslips: row.payslips_visibility,
      revisions: row.revisions_visibility,
      payrollReports: row.payroll_reports_visibility,
    },
    visaNationalityVisibility: visa,
    documentVisibility: {
      passportCopy: row.passport_copy_visibility,
      visaCopy: row.visa_copy_visibility,
      nationalId: row.national_id_visibility,
      medicalDocuments: row.medical_documents_visibility,
      performanceIssues: row.performance_issues_visibility,
    },
    notesVisibility: row.notes_visibility,
    updatedAt: row.updated_at,
  };
}

function mergeSensitiveBody(body) {
  if (!body || typeof body !== 'object') return {};

  const merged = { ...body };

  const sd = body.salaryDataVisibility;
  if (sd && typeof sd === 'object') {
    if (sd.salaryBreakup !== undefined) merged.salary_breakup_visibility = sd.salaryBreakup;
    if (sd.ctc !== undefined) merged.ctc_visibility = sd.ctc;
    if (sd.payslips !== undefined) merged.payslips_visibility = sd.payslips;
    if (sd.revisions !== undefined) merged.revisions_visibility = sd.revisions;
    if (sd.payrollReports !== undefined) merged.payroll_reports_visibility = sd.payrollReports;
  }

  const dv = body.documentVisibility;
  if (dv && typeof dv === 'object') {
    if (dv.passportCopy !== undefined) merged.passport_copy_visibility = dv.passportCopy;
    if (dv.visaCopy !== undefined) merged.visa_copy_visibility = dv.visaCopy;
    if (dv.nationalId !== undefined) merged.national_id_visibility = dv.nationalId;
    if (dv.medicalDocuments !== undefined) {
      merged.medical_documents_visibility = dv.medicalDocuments;
    }
    if (dv.performanceIssues !== undefined) {
      merged.performance_issues_visibility = dv.performanceIssues;
    }
  }

  if (body.visaNationalityVisibility !== undefined) {
    merged.visa_nationality_visibility = body.visaNationalityVisibility;
  }
  if (body.notesVisibility !== undefined) merged.notes_visibility = body.notesVisibility;

  return merged;
}

function isPlainObject(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

function assertInSet(value, allowed, label) {
  if (value === undefined || value === null) return;
  if (!allowed.includes(String(value))) {
    throw new ApiError(400, `Invalid ${label}`);
  }
}

function validateVisaObject(obj) {
  if (!isPlainObject(obj)) {
    throw new ApiError(400, 'visaNationalityVisibility must be an object');
  }
  const allowed = new Set(VISIBILITY_OPTIONS_VISA);
  for (const v of Object.values(obj)) {
    if (!allowed.has(String(v))) {
      throw new ApiError(400, 'Invalid visa / nationality visibility level');
    }
  }
}

async function getSensitiveDataSettings(dbName) {
  const pool = getTenantPool(dbName);
  let row = await repository.getSettings(pool);
  if (!row) {
    row = await repository.seedDefault(pool);
  }

  const roleRows = await repository.getRoles(pool);
  const salaryVisibilityOptions = buildSalaryVisibilityOptions(roleRows);
  const roleNames = roleRows.map((r) => r.name);

  return {
    salaryVisibilityOptions,
    visaVisibilityOptions: VISIBILITY_OPTIONS_VISA,
    documentVisibilityOptions: VISIBILITY_OPTIONS_DOC,
    notesVisibilityOptions: NOTES_VISIBILITY_OPTIONS,
    roles: roleNames,
    settings: mapToResponse(row),
  };
}

async function updateSensitiveDataSettings(dbName, body) {
  const flat = mergeSensitiveBody(body || {});

  const pool = getTenantPool(dbName);
  const roleRows = await repository.getRoles(pool);
  const salaryValidity = new Set(buildSalaryVisibilityOptions(roleRows));

  const patch = {};
  for (const camel of Object.keys(SALARY_FIELD_MAP)) {
    const snake = SALARY_FIELD_MAP[camel];
    if (Object.prototype.hasOwnProperty.call(flat, snake)) {
      const v = flat[snake];
      if (v != null && !salaryValidity.has(String(v))) {
        throw new ApiError(400, `Invalid salary visibility: ${snake}`);
      }
      patch[snake] = v;
    }
  }

  for (const camel of Object.keys(DOC_FIELD_MAP)) {
    const snake = DOC_FIELD_MAP[camel];
    if (Object.prototype.hasOwnProperty.call(flat, snake)) {
      const v = flat[snake];
      assertInSet(v, VISIBILITY_OPTIONS_DOC, snake);
      patch[snake] = v;
    }
  }

  if (Object.prototype.hasOwnProperty.call(flat, 'notes_visibility')) {
    assertInSet(flat.notes_visibility, NOTES_VISIBILITY_OPTIONS, 'notes_visibility');
    patch.notes_visibility = flat.notes_visibility;
  }

  if (Object.prototype.hasOwnProperty.call(flat, 'visa_nationality_visibility')) {
    let v = flat.visa_nationality_visibility;
    if (typeof v === 'string') {
      try {
        v = JSON.parse(v);
      } catch {
        throw new ApiError(400, 'visaNationalityVisibility must be a JSON object');
      }
    }
    validateVisaObject(v);
    patch.visa_nationality_visibility = v;
  }

  let row = await repository.updateSettings(pool, patch);
  if (!row) {
    await repository.seedDefault(pool);
    row = await repository.updateSettings(pool, patch);
  }
  if (!row) {
    throw new ApiError(500, 'Failed to update sensitive data settings');
  }

  const updated = mapToResponse(row);
  const salaryVisibilityOptions = buildSalaryVisibilityOptions(roleRows);
  const roleNames = roleRows.map((r) => r.name);

  return {
    settings: updated,
    salaryVisibilityOptions,
    visaVisibilityOptions: VISIBILITY_OPTIONS_VISA,
    documentVisibilityOptions: VISIBILITY_OPTIONS_DOC,
    notesVisibilityOptions: NOTES_VISIBILITY_OPTIONS,
    roles: roleNames,
    message: 'Sensitive data settings updated',
  };
}

module.exports = {
  VISIBILITY_OPTIONS_DOC,
  VISIBILITY_OPTIONS_VISA,
  NOTES_VISIBILITY_OPTIONS,
  mergeSensitiveBody,
  getSensitiveDataSettings,
  updateSensitiveDataSettings,
  FALLBACK_VISA_ROLES,
};
