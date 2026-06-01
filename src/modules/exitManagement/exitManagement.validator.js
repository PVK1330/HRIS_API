'use strict';

const Joi = require('joi');

const idParam = Joi.object({
  id: Joi.number().integer().positive().required(),
});

const stageParams = Joi.object({
  id: Joi.number().integer().positive().required(),
  stageId: Joi.number().integer().positive().required(),
});

const checklistItemParams = Joi.object({
  id: Joi.number().integer().positive().required(),
  stageId: Joi.number().integer().positive().required(),
  itemId: Joi.number().integer().positive().required(),
});

const listingQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  search: Joi.string().allow('').max(200).default(''),
  status: Joi.string()
    .valid('all', 'DRAFT', 'SUBMITTED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED', 'WITHDRAWN', 'CANCELLED')
    .default('all'),
  exit_type: Joi.string().valid('all', 'resignation', 'termination').default('all'),
  employee_id: Joi.number().integer().positive().optional(),
});

const createRequestBody = Joi.object({
  employee_id: Joi.number().integer().positive().optional(),
  exit_type: Joi.string().valid('resignation', 'termination').default('resignation'),
  termination_type_id: Joi.number().integer().positive().allow(null).optional(),
  exit_reason: Joi.string().trim().max(2000).allow('', null).optional(),
  reason_detail: Joi.string().trim().max(2000).allow('', null).optional(),
  notice_date: Joi.date().iso().allow(null).optional(),
  resignation_date: Joi.date().iso().allow(null).optional(),
  last_working_day: Joi.date().iso().allow(null).optional(),
  notice_period_days: Joi.number().integer().min(0).allow(null).optional(),
  is_voluntary: Joi.boolean().optional(),
});

const approveBody = Joi.object({
  comments: Joi.string().trim().max(2000).allow('', null).optional(),
});

const rejectBody = Joi.object({
  rejection_reason: Joi.string().trim().min(1).max(2000).required(),
});

const sendBackBody = Joi.object({
  target_stage_id: Joi.number().integer().positive().allow(null).optional(),
  comments: Joi.string().trim().min(1).max(2000).required(),
});

const reassignBody = Joi.object({
  department_id: Joi.number().integer().positive().required(),
  comments: Joi.string().trim().max(2000).allow('', null).optional(),
});

const escalateBody = Joi.object({
  comments: Joi.string().trim().max(2000).allow('', null).optional(),
});

const commentBody = Joi.object({
  comments: Joi.string().trim().min(1).max(2000).required(),
});

const withdrawBody = Joi.object({
  withdrawal_reason: Joi.string().trim().max(2000).allow('', null).optional(),
});

const createChecklistBody = Joi.object({
  item_type: Joi.string().valid('TASK', 'ASSET_RETURN', 'INTERVIEW', 'SETTLEMENT', 'DOCUMENT').default('TASK'),
  label: Joi.string().trim().min(1).max(200).required(),
  is_mandatory: Joi.boolean().default(true),
  assigned_to: Joi.number().integer().positive().allow(null).optional(),
  due_date: Joi.date().iso().allow(null).optional(),
  notes: Joi.string().trim().max(2000).allow('', null).optional(),
  data: Joi.object().optional(),
});

const updateChecklistBody = Joi.object({
  label: Joi.string().trim().min(1).max(200).optional(),
  status: Joi.string().valid('PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED', 'NA').optional(),
  assigned_to: Joi.number().integer().positive().allow(null).optional(),
  due_date: Joi.date().iso().allow(null).optional(),
  notes: Joi.string().trim().max(2000).allow('', null).optional(),
  data: Joi.object().optional(),
});

module.exports = {
  idParam,
  stageParams,
  checklistItemParams,
  listingQuery,
  createRequestBody,
  approveBody,
  rejectBody,
  sendBackBody,
  reassignBody,
  escalateBody,
  commentBody,
  withdrawBody,
  createChecklistBody,
  updateChecklistBody,
};
