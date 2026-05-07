'use strict';

const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const repository = require('./assetSettings.repository');
const {
  VALID_ASSIGNING_RULES,
  VALID_RETURN_RULES,
  VALID_LOST_DAMAGED_POLICIES,
  VALID_APPROVAL_WORKFLOWS,
} = require('./assetSettings.options');

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

const RULE_KEYS = new Set([
  'assigning_rule',
  'return_rule',
  'lost_damaged_policy',
  'approval_workflow',
]);

function mapCategory(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  };
}

function mapRulesToResponse(row) {
  if (!row) return null;
  return {
    id: row.id,
    assigningRule: row.assigning_rule,
    returnRule: row.return_rule,
    lostDamagedPolicy: row.lost_damaged_policy,
    approvalWorkflow: row.approval_workflow,
    updatedAt: row.updated_at,
  };
}

function mergeFlatRulesBody(body) {
  const patch = {};
  if (!body || typeof body !== 'object') return patch;

  if (body.assigningRule !== undefined) patch.assigning_rule = body.assigningRule;
  if (body.returnRule !== undefined) patch.return_rule = body.returnRule;
  if (body.lostDamagedPolicy !== undefined) patch.lost_damaged_policy = body.lostDamagedPolicy;
  if (body.approvalWorkflow !== undefined) patch.approval_workflow = body.approvalWorkflow;

  if (body.assigning_rule !== undefined) patch.assigning_rule = body.assigning_rule;
  if (body.return_rule !== undefined) patch.return_rule = body.return_rule;
  if (body.lost_damaged_policy !== undefined) {
    patch.lost_damaged_policy = body.lost_damaged_policy;
  }
  if (body.approval_workflow !== undefined) patch.approval_workflow = body.approval_workflow;

  return { ...body, ...patch };
}

function extractRulesPatch(body) {
  const patch = {};
  if (!body || typeof body !== 'object') return patch;
  for (const key of RULE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      patch[key] = body[key];
    }
  }
  return patch;
}

function validateRulesEnums(patch) {
  const a = new Set(VALID_ASSIGNING_RULES);
  const r = new Set(VALID_RETURN_RULES);
  const l = new Set(VALID_LOST_DAMAGED_POLICIES);
  const w = new Set(VALID_APPROVAL_WORKFLOWS);

  if (patch.assigning_rule !== undefined && patch.assigning_rule !== null) {
    if (!a.has(String(patch.assigning_rule))) {
      throw new ApiError(400, 'Invalid assigning_rule');
    }
  }
  if (patch.return_rule !== undefined && patch.return_rule !== null) {
    if (!r.has(String(patch.return_rule))) {
      throw new ApiError(400, 'Invalid return_rule');
    }
  }
  if (patch.lost_damaged_policy !== undefined && patch.lost_damaged_policy !== null) {
    if (!l.has(String(patch.lost_damaged_policy))) {
      throw new ApiError(400, 'Invalid lost_damaged_policy');
    }
  }
  if (patch.approval_workflow !== undefined && patch.approval_workflow !== null) {
    if (!w.has(String(patch.approval_workflow))) {
      throw new ApiError(400, 'Invalid approval_workflow');
    }
  }
}

async function getCategories(dbName) {
  const pool = getTenantPool(dbName);
  const rows = await repository.getAllCategories(pool);
  return rows.map(mapCategory);
}

async function createCategory(dbName, body) {
  const pool = getTenantPool(dbName);
  const name = String(body.name || '').trim();

  const dup = await repository.findCategoryByNameLower(pool, name);
  if (dup) {
    throw new ApiError(409, 'Category name already exists');
  }

  let color =
    body.color != null && String(body.color).trim() !== ''
      ? String(body.color).trim()
      : '#6366f1';
  if (!HEX_COLOR_RE.test(color)) {
    throw new ApiError(400, 'Invalid color');
  }

  const icon =
    body.icon != null && String(body.icon).trim() !== ''
      ? String(body.icon).trim().slice(0, 50)
      : 'box';

  const sortOrder =
    body.sortOrder !== undefined && body.sortOrder !== null
      ? Number(body.sortOrder)
      : body.sort_order !== undefined && body.sort_order !== null
        ? Number(body.sort_order)
        : 0;

  if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    throw new ApiError(400, 'Invalid sort_order');
  }

  const row = await repository.createCategory(pool, {
    name,
    icon,
    color,
    sortOrder,
  });

  return mapCategory(row);
}

function buildCategoryUpdatePatch(body) {
  const patch = {};

  if (body.name !== undefined) {
    patch.name = String(body.name).trim();
    if (patch.name.length < 2 || patch.name.length > 100) {
      throw new ApiError(400, 'Invalid name');
    }
  }

  if (body.icon !== undefined) {
    patch.icon =
      body.icon === null || body.icon === ''
        ? 'box'
        : String(body.icon).trim().slice(0, 50);
  }

  if (body.color !== undefined && body.color !== null && String(body.color).trim() !== '') {
    const c = String(body.color).trim();
    if (!HEX_COLOR_RE.test(c)) {
      throw new ApiError(400, 'Invalid color');
    }
    patch.color = c;
  }

  if (body.sortOrder !== undefined || body.sort_order !== undefined) {
    const v =
      body.sortOrder !== undefined ? body.sortOrder : body.sort_order;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) {
      throw new ApiError(400, 'Invalid sort_order');
    }
    patch.sort_order = n;
  }

  if (body.isActive !== undefined) {
    patch.is_active = Boolean(body.isActive);
  } else if (body.is_active !== undefined) {
    patch.is_active = Boolean(body.is_active);
  }

  return patch;
}

async function updateCategory(dbName, id, body) {
  const pool = getTenantPool(dbName);
  const existing = await repository.getCategoryById(pool, id);
  if (!existing) {
    throw new ApiError(404, 'Category not found');
  }

  const patch = buildCategoryUpdatePatch(body || {});
  if (Object.keys(patch).length === 0) {
    return mapCategory(existing);
  }

  if (patch.name !== undefined) {
    const dup = await repository.findCategoryByNameLowerExcludingId(pool, patch.name, id);
    if (dup) {
      throw new ApiError(409, 'Category name already exists');
    }
  }

  const row = await repository.updateCategory(pool, id, patch);
  if (!row) {
    throw new ApiError(404, 'Category not found');
  }
  return mapCategory(row);
}

async function deleteCategory(dbName, id) {
  const pool = getTenantPool(dbName);
  const existing = await repository.getCategoryById(pool, id);
  if (!existing) {
    throw new ApiError(404, 'Category not found');
  }

  const deleted = await repository.deleteCategory(pool, id);
  if (!deleted) {
    throw new ApiError(404, 'Category not found');
  }

  return { deleted: true, id };
}

async function getAssetRules(dbName) {
  const pool = getTenantPool(dbName);
  let row = await repository.getRules(pool);
  if (!row) {
    row = await repository.seedDefaultRules(pool);
  }
  if (!row) {
    throw ApiError.notFound('Asset rules not found');
  }
  return mapRulesToResponse(row);
}

async function updateAssetRules(dbName, body) {
  const pool = getTenantPool(dbName);
  let existingRow = await repository.getRules(pool);
  if (!existingRow) {
    existingRow = await repository.seedDefaultRules(pool);
  }
  if (!existingRow) {
    throw ApiError.notFound('Asset rules not found');
  }

  const flat = mergeFlatRulesBody(body || {});
  const patch = extractRulesPatch(flat);

  if (Object.keys(patch).length === 0) {
    return mapRulesToResponse(existingRow);
  }

  validateRulesEnums(patch);

  const updated = await repository.updateRules(pool, patch);
  if (!updated) {
    throw ApiError.notFound('Asset rules not found');
  }
  return mapRulesToResponse(updated);
}

module.exports = {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getAssetRules,
  updateAssetRules,
  mergeFlatRulesBody,
  VALID_ASSIGNING_RULES,
  VALID_RETURN_RULES,
  VALID_LOST_DAMAGED_POLICIES,
  VALID_APPROVAL_WORKFLOWS,
};
