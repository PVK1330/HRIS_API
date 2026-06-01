'use strict';

const Joi = require('joi');

const workflowIdParam = Joi.object({
  workflowId: Joi.number().integer().positive().required(),
});

const checklistItem = Joi.object({
  item_type: Joi.string().valid('TASK', 'ASSET_RETURN', 'INTERVIEW', 'SETTLEMENT', 'DOCUMENT').default('TASK'),
  label: Joi.string().trim().min(1).max(200).required(),
  description: Joi.string().trim().max(2000).allow('', null).optional(),
  is_mandatory: Joi.boolean().default(true),
  requires_proof: Joi.boolean().default(false),
  assigned_role_id: Joi.number().integer().positive().allow(null).optional(),
  config: Joi.object().optional(),
  sort_order: Joi.number().integer().min(0).optional(),
});

const stage = Joi.object({
  name: Joi.string().trim().min(1).max(160).required(),
  stage_order: Joi.number().integer().min(1).max(6).optional(),
  approval_mode: Joi.string().valid('ANY', 'ALL', 'QUORUM', 'SEQUENTIAL').default('ANY'),
  quorum_count: Joi.number().integer().min(1).allow(null).optional(),
  block_until_checklist_complete: Joi.boolean().default(false),
  sla_hours: Joi.number().integer().min(0).allow(null).optional(),
  escalation_enabled: Joi.boolean().default(false),
  escalation_after_hours: Joi.number().integer().min(0).allow(null).optional(),
  escalation_to_role_id: Joi.number().integer().positive().allow(null).optional(),
  escalation_to_user_id: Joi.number().integer().positive().allow(null).optional(),
  escalation_action: Joi.string().valid('NOTIFY', 'REASSIGN').default('NOTIFY'),
  allow_future_visibility: Joi.boolean().default(false),
  allow_previous_edit: Joi.boolean().default(false),
  mandatory_comment: Joi.boolean().default(false),
  department_ids: Joi.array().items(Joi.number().integer().positive()).default([]),
  role_ids: Joi.array().items(Joi.number().integer().positive()).default([]),
  user_ids: Joi.array().items(Joi.number().integer().positive()).default([]),
  checklist_items: Joi.array().items(checklistItem).default([]),
});

const createWorkflowBody = Joi.object({
  name: Joi.string().trim().min(1).max(160).required(),
  description: Joi.string().trim().max(2000).allow('', null).optional(),
  exit_type: Joi.string().valid('resignation', 'termination').allow(null).optional(),
  is_active: Joi.boolean().default(true),
  is_default: Joi.boolean().default(false),
  stages: Joi.array().items(stage).min(1).max(6).required(),
});

const updateWorkflowBody = Joi.object({
  name: Joi.string().trim().min(1).max(160).optional(),
  description: Joi.string().trim().max(2000).allow('', null).optional(),
  exit_type: Joi.string().valid('resignation', 'termination').allow(null).optional(),
  is_active: Joi.boolean().optional(),
  is_default: Joi.boolean().optional(),
});

module.exports = {
  workflowIdParam,
  createWorkflowBody,
  updateWorkflowBody,
};
