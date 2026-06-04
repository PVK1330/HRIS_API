'use strict';

const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const repository = require('./leaveSettings.repository');

const VALID_PAID_UNPAID = ['Paid', 'Unpaid'];
const VALID_ACCRUAL = ['Monthly', 'Yearly', 'None'];
const VALID_LOP_RULES = ['No LOP', 'Full LOP', 'Half LOP'];
const BASE_APPROVER_OPTIONS = ['Manager', 'HR', 'HR Manager', 'Direct Manager'];

const SNAKE_KEYS = [
  'name',
  'code',
  'paid_or_unpaid',
  'annual_entitlement_days',
  'entitlement_label',
  'accrual',
  'carry_forward_allowed',
  'max_carry_forward_days',
  'notice_period_required',
  'gender_restriction',
  'loss_of_pay_rule',
  'document_required',
  'auto_approval',
  'approver',
  'is_active',
  'sort_order',
];

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    paidOrUnpaid: row.paid_or_unpaid,
    annualEntitlementDays: row.annual_entitlement_days,
    entitlementLabel: row.entitlement_label,
    accrual: row.accrual,
    carryForwardAllowed: row.carry_forward_allowed,
    maxCarryForwardDays: row.max_carry_forward_days,
    noticePeriodRequired: row.notice_period_required,
    genderRestriction: row.gender_restriction,
    lossOfPayRule: row.loss_of_pay_rule,
    documentRequired: row.document_required,
    autoApproval: row.auto_approval,
    approver: row.approver,
    isActive: row.is_active,
    isCustom: row.is_custom,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mergeLeaveBody(body) {
  if (!body || typeof body !== 'object') return {};
  const merged = { ...body };

  if (body.code !== undefined) merged.code = body.code;
  if (body.paidOrUnpaid !== undefined) merged.paid_or_unpaid = body.paidOrUnpaid;
  if (body.annualEntitlementDays !== undefined) {
    merged.annual_entitlement_days = body.annualEntitlementDays;
  }
  if (body.entitlementLabel !== undefined) merged.entitlement_label = body.entitlementLabel;
  if (body.carryForwardAllowed !== undefined) merged.carry_forward_allowed = body.carryForwardAllowed;
  if (body.maxCarryForwardDays !== undefined) {
    merged.max_carry_forward_days = body.maxCarryForwardDays;
  }
  if (body.noticePeriodRequired !== undefined) {
    merged.notice_period_required = body.noticePeriodRequired;
  }
  if (body.genderRestriction !== undefined) merged.gender_restriction = body.genderRestriction;
  if (body.lossOfPayRule !== undefined) merged.loss_of_pay_rule = body.lossOfPayRule;
  if (body.documentRequired !== undefined) merged.document_required = body.documentRequired;
  if (body.autoApproval !== undefined) merged.auto_approval = body.autoApproval;
  if (body.isActive !== undefined) merged.is_active = body.isActive;
  if (body.sortOrder !== undefined) merged.sort_order = body.sortOrder;

  delete merged.isCustom;
  delete merged.is_custom;

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

async function buildApproverOptions(pool) {
  const roles = await repository.getRoles(pool);
  const roleNames = roles.map((r) => r.name).filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const opt of [...BASE_APPROVER_OPTIONS, ...roleNames]) {
    if (seen.has(opt)) continue;
    seen.add(opt);
    out.push(opt);
  }
  return out;
}

function assertEnum(value, valid, label) {
  if (value === undefined || value === null) return;
  if (!valid.includes(String(value))) {
    throw new ApiError(400, `Invalid ${label}`);
  }
}

function validateNameCreate(raw) {
  const n = String(raw || '').trim();
  if (n.length < 2 || n.length > 100) {
    throw new ApiError(400, 'Name is required and must be 2–100 characters');
  }
  return n;
}

function validateNameUpdate(patch) {
  if (patch.name === undefined || patch.name === null) return;
  const n = String(patch.name).trim();
  if (n.length < 2 || n.length > 100) {
    throw new ApiError(400, 'Name must be 2–100 characters');
  }
  patch.name = n;
}

function validateNonNegInt(value, field) {
  if (value === undefined || value === null) return;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new ApiError(400, `${field} must be a non-negative integer`);
  }
}

function validateOptionalEntitlementLabel(patch) {
  if (patch.entitlement_label === undefined || patch.entitlement_label === null) return;
  const s = String(patch.entitlement_label).trim();
  if (s.length > 30) {
    throw new ApiError(400, 'entitlement_label must be at most 30 characters');
  }
  patch.entitlement_label = s.length ? s : null;
}

function validateApproverOptional(value, approverOptions) {
  if (value === undefined || value === null) return;
  const s = String(value).trim();
  if (!approverOptions.includes(s)) {
    throw new ApiError(400, 'Invalid approver');
  }
}

function validateBooleanOptional(patch, key) {
  if (patch[key] === undefined || patch[key] === null) return;
  if (typeof patch[key] !== 'boolean') {
    throw new ApiError(400, `${key} must be a boolean`);
  }
}

async function getAllLeaveTypes(dbName) {
  const pool = getTenantPool(dbName);
  const rows = await repository.getAllLeaveTypes(pool);
  const approverOptions = await buildApproverOptions(pool);
  return {
    leaveTypes: rows.map(mapRow),
    approverOptions,
    meta: { total: rows.length },
  };
}

async function getLeaveTypeById(dbName, id) {
  const pool = getTenantPool(dbName);
  const row = await repository.getLeaveTypeById(pool, id);
  if (!row) {
    throw new ApiError(404, 'Leave type not found');
  }
  const approverOptions = await buildApproverOptions(pool);
  return {
    leaveType: mapRow(row),
    approverOptions,
  };
}

async function createLeaveType(dbName, body) {
  const pool = getTenantPool(dbName);
  const merged = mergeLeaveBody(body);
  const approverOptions = await buildApproverOptions(pool);

  const name = validateNameCreate(merged.name);
  const dup = await repository.getLeaveTypeByName(pool, name, null);
  if (dup) {
    throw new ApiError(409, 'Leave type already exists');
  }

  assertEnum(merged.paid_or_unpaid, VALID_PAID_UNPAID, 'paid_or_unpaid');
  assertEnum(merged.accrual, VALID_ACCRUAL, 'accrual');
  assertEnum(merged.loss_of_pay_rule, VALID_LOP_RULES, 'loss_of_pay_rule');

  validateNonNegInt(merged.annual_entitlement_days, 'annual_entitlement_days');
  validateNonNegInt(merged.max_carry_forward_days, 'max_carry_forward_days');

  validateBooleanOptional(merged, 'document_required');
  validateBooleanOptional(merged, 'auto_approval');
  validateBooleanOptional(merged, 'is_active');

  validateOptionalEntitlementLabel(merged);
  validateApproverOptional(merged.approver, approverOptions);

  const sortOrder = await repository.getNextSortOrder(pool);

  const insert = {
    name,
    code: merged.code || null,
    paid_or_unpaid: merged.paid_or_unpaid ?? 'Paid',
    annual_entitlement_days:
      merged.annual_entitlement_days !== undefined && merged.annual_entitlement_days !== null
        ? parseInt(merged.annual_entitlement_days, 10)
        : 0,
    entitlement_label:
      merged.entitlement_label !== undefined && merged.entitlement_label !== null
        ? merged.entitlement_label
        : null,
    accrual: merged.accrual ?? 'Monthly',
    carry_forward_allowed: merged.carry_forward_allowed ?? true,
    max_carry_forward_days:
      merged.max_carry_forward_days !== undefined && merged.max_carry_forward_days !== null
        ? parseInt(merged.max_carry_forward_days, 10)
        : 0,
    notice_period_required:
      merged.notice_period_required !== undefined && merged.notice_period_required !== null
        ? parseInt(merged.notice_period_required, 10)
        : 0,
    gender_restriction: merged.gender_restriction ?? 'Both',
    loss_of_pay_rule: merged.loss_of_pay_rule ?? 'No LOP',
    document_required: merged.document_required ?? false,
    auto_approval: merged.auto_approval ?? false,
    approver: merged.approver != null && merged.approver !== '' ? String(merged.approver).trim() : 'Manager',
    is_active: merged.is_active !== undefined && merged.is_active !== null ? merged.is_active : true,
    is_custom: true,
    sort_order: sortOrder,
  };

  validateApproverOptional(insert.approver, approverOptions);

  const created = await repository.createLeaveType(pool, insert);
  return { leaveType: mapRow(created) };
}

async function updateLeaveType(dbName, id, body) {
  const pool = getTenantPool(dbName);
  const existing = await repository.getLeaveTypeById(pool, id);
  if (!existing) {
    throw new ApiError(404, 'Leave type not found');
  }

  const merged = mergeLeaveBody(body);
  const patch = snakePatchFromMerged(merged);
  validateNameUpdate(patch);

  if (patch.name !== undefined) {
    const dup = await repository.getLeaveTypeByName(pool, patch.name, id);
    if (dup) {
      throw new ApiError(409, 'Leave type already exists');
    }
  }

  const approverOptions = await buildApproverOptions(pool);

  assertEnum(patch.paid_or_unpaid, VALID_PAID_UNPAID, 'paid_or_unpaid');
  assertEnum(patch.accrual, VALID_ACCRUAL, 'accrual');
  assertEnum(patch.loss_of_pay_rule, VALID_LOP_RULES, 'loss_of_pay_rule');

  validateNonNegInt(patch.annual_entitlement_days, 'annual_entitlement_days');
  validateNonNegInt(patch.max_carry_forward_days, 'max_carry_forward_days');

  validateBooleanOptional(patch, 'document_required');
  validateBooleanOptional(patch, 'auto_approval');
  validateBooleanOptional(patch, 'is_active');

  validateOptionalEntitlementLabel(patch);
  validateApproverOptional(patch.approver, approverOptions);

  if (patch.annual_entitlement_days !== undefined && patch.annual_entitlement_days !== null) {
    patch.annual_entitlement_days = parseInt(patch.annual_entitlement_days, 10);
  }
  if (patch.max_carry_forward_days !== undefined && patch.max_carry_forward_days !== null) {
    patch.max_carry_forward_days = parseInt(patch.max_carry_forward_days, 10);
  }
  if (patch.notice_period_required !== undefined && patch.notice_period_required !== null) {
    patch.notice_period_required = parseInt(patch.notice_period_required, 10);
  }

  const updated = await repository.updateLeaveType(pool, id, patch);
  return { leaveType: mapRow(updated) };
}

async function deleteLeaveType(dbName, id) {
  const pool = getTenantPool(dbName);
  const row = await repository.getLeaveTypeById(pool, id);
  if (!row) {
    throw new ApiError(404, 'Leave type not found');
  }
  if (!row.is_custom) {
    throw new ApiError(403, 'Default leave types cannot be deleted');
  }
  const deleted = await repository.deleteLeaveType(pool, id);
  if (!deleted) {
    throw new ApiError(403, 'Default leave types cannot be deleted');
  }
  return { deleted: true, id };
}

module.exports = {
  VALID_PAID_UNPAID,
  VALID_ACCRUAL,
  VALID_LOP_RULES,
  BASE_APPROVER_OPTIONS,
  mergeLeaveBody,
  getAllLeaveTypes,
  getLeaveTypeById,
  createLeaveType,
  updateLeaveType,
  deleteLeaveType,
};
