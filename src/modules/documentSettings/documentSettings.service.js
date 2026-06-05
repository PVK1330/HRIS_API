'use strict';

const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const repository = require('./documentSettings.repository');

const VALID_MANDATORY = ['Mandatory', 'Optional'];
const VALID_WHO_UPLOAD = ['Employee', 'HR', 'Both'];
const VALID_VISIBILITY = ['HR only', 'Manager + HR', 'All', 'Employee (own only)'];

const SNAKE_KEYS = [
  'name',
  'is_required',
  'mandatory_or_optional',
  'who_must_upload',
  'expiry_tracking',
  'reminder_before_expiry_days',
  'hr_approval_required',
  'visibility',
  'sort_order',
  'is_active',
  'applies_to_roles',
];

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    isRequired: row.is_required,
    mandatoryOrOptional: row.mandatory_or_optional,
    whoMustUpload: row.who_must_upload,
    expiryTracking: row.expiry_tracking,
    reminderBeforeExpiryDays: row.reminder_before_expiry_days,
    hrApprovalRequired: row.hr_approval_required,
    visibility: row.visibility,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    appliesToRoles: Array.isArray(row.applies_to_roles) ? row.applies_to_roles : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mergeDocumentBody(body) {
  if (!body || typeof body !== 'object') return {};
  const merged = { ...body };

  if (body.isRequired !== undefined) merged.is_required = body.isRequired;
  if (body.mandatoryOrOptional !== undefined) {
    merged.mandatory_or_optional = body.mandatoryOrOptional;
  }
  if (body.whoMustUpload !== undefined) merged.who_must_upload = body.whoMustUpload;
  if (body.expiryTracking !== undefined) merged.expiry_tracking = body.expiryTracking;
  if (body.reminderBeforeExpiryDays !== undefined) {
    merged.reminder_before_expiry_days = body.reminderBeforeExpiryDays;
  }
  if (body.hrApprovalRequired !== undefined) {
    merged.hr_approval_required = body.hrApprovalRequired;
  }
  if (body.sortOrder !== undefined) merged.sort_order = body.sortOrder;
  if (body.isActive !== undefined) merged.is_active = body.isActive;
  if (body.appliesToRoles !== undefined) {
    const arr = Array.isArray(body.appliesToRoles) ? body.appliesToRoles.map((x) => String(x)) : [];
    merged.applies_to_roles = JSON.stringify(arr); // jsonb column
  }

  return merged;
}

function snakePatchFromMerged(merged) {
  const patch = {};
  for (const k of SNAKE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(merged, k)) {
      patch[k] = merged[k];
    }
  }
  return patch;
}

function assertEnum(value, valid, label) {
  if (value === undefined || value === null) return;
  if (!valid.includes(String(value))) {
    throw new ApiError(400, `Invalid ${label}`);
  }
}

function validateNameForCreate(raw) {
  const n = String(raw || '').trim();
  if (n.length < 2 || n.length > 100) {
    throw new ApiError(400, 'Name is required and must be 2–100 characters');
  }
  return n;
}

function validateNameForUpdate(patch) {
  if (patch.name === undefined || patch.name === null) return;
  const n = String(patch.name).trim();
  if (n.length < 2 || n.length > 100) {
    throw new ApiError(400, 'Name must be 2–100 characters');
  }
  patch.name = n;
}

function validateOptionalFields(patch) {
  assertEnum(patch.mandatory_or_optional, VALID_MANDATORY, 'mandatory_or_optional');
  assertEnum(patch.who_must_upload, VALID_WHO_UPLOAD, 'who_must_upload');
  assertEnum(patch.visibility, VALID_VISIBILITY, 'visibility');

  if (patch.reminder_before_expiry_days !== undefined && patch.reminder_before_expiry_days !== null) {
    const n = Number(patch.reminder_before_expiry_days);
    if (!Number.isInteger(n) || n < 1 || n > 365) {
      throw new ApiError(
        400,
        'reminder_before_expiry_days must be an integer from 1 to 365'
      );
    }
  }

  for (const k of ['is_required', 'expiry_tracking', 'hr_approval_required', 'is_active']) {
    if (patch[k] !== undefined && patch[k] !== null && typeof patch[k] !== 'boolean') {
      throw new ApiError(400, `${k} must be a boolean`);
    }
  }

  if (patch.sort_order !== undefined && patch.sort_order !== null) {
    const n = Number(patch.sort_order);
    if (!Number.isInteger(n) || n < 0) {
      throw new ApiError(400, 'sort_order must be a non-negative integer');
    }
  }

  validateNameForUpdate(patch);
}

async function getAllDocumentTypes(dbName) {
  const pool = getTenantPool(dbName);
  const rows = await repository.getAllDocumentTypes(pool);
  return rows.map(mapRow);
}

async function getDocumentTypeById(dbName, id) {
  const pool = getTenantPool(dbName);
  const row = await repository.getDocumentTypeById(pool, id);
  if (!row) {
    throw new ApiError(404, 'Document type not found');
  }
  return mapRow(row);
}

async function createDocumentType(dbName, body) {
  const merged = mergeDocumentBody(body);
  const name = validateNameForCreate(merged.name);

  const pool = getTenantPool(dbName);
  const dup = await repository.findByNameCaseInsensitive(pool, name, null);
  if (dup) {
    throw new ApiError(409, 'Document type already exists');
  }

  const fullSnake = snakePatchFromMerged(merged);
  validateOptionalFields(fullSnake);

  const patch = { ...fullSnake };
  delete patch.name;

  const sortOrder =
    merged.sort_order !== undefined && merged.sort_order !== null
      ? Number(merged.sort_order)
      : await repository.getNextSortOrder(pool);

  if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    throw new ApiError(400, 'sort_order must be a non-negative integer');
  }

  const insertFields = { ...patch, name, sort_order: sortOrder };
  Object.keys(insertFields).forEach((k) => {
    if (insertFields[k] === undefined) delete insertFields[k];
  });

  const row = await repository.createDocumentType(pool, insertFields);
  if (!row) {
    throw new ApiError(500, 'Failed to create document type');
  }
  return mapRow(row);
}

async function updateDocumentType(dbName, id, body) {
  const pool = getTenantPool(dbName);
  const existing = await repository.getDocumentTypeById(pool, id);
  if (!existing) {
    throw new ApiError(404, 'Document type not found');
  }

  const merged = mergeDocumentBody(body);
  const patch = snakePatchFromMerged(merged);
  if (Object.keys(patch).length === 0) {
    return mapRow(existing);
  }

  validateOptionalFields(patch);

  if (patch.name !== undefined) {
    const dup = await repository.findByNameCaseInsensitive(pool, patch.name, id);
    if (dup) {
      throw new ApiError(409, 'Document type already exists');
    }
  }

  const row = await repository.updateDocumentType(pool, id, patch);
  if (!row) {
    throw new ApiError(404, 'Document type not found');
  }
  return mapRow(row);
}

async function deleteDocumentType(dbName, id) {
  const pool = getTenantPool(dbName);
  const existing = await repository.getDocumentTypeById(pool, id);
  if (!existing) {
    throw new ApiError(404, 'Document type not found');
  }

  const del = await repository.deleteDocumentType(pool, id);
  if (!del) {
    throw new ApiError(404, 'Document type not found');
  }
  return { deleted: true, id: del.id };
}

module.exports = {
  VALID_MANDATORY,
  VALID_WHO_UPLOAD,
  VALID_VISIBILITY,
  mergeDocumentBody,
  getAllDocumentTypes,
  getDocumentTypeById,
  createDocumentType,
  updateDocumentType,
  deleteDocumentType,
};
