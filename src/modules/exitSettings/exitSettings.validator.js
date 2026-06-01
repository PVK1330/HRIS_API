'use strict';

const Joi = require('joi');

const idParam = Joi.object({
  id: Joi.number().integer().positive().required(),
});

const listingQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  search: Joi.string().allow('').max(200).default(''),
  status: Joi.string().valid('active', 'inactive', 'all', 'Active', 'Inactive', 'All').default('all'),
  sortBy: Joi.string()
    .valid('created_at', 'updated_at', 'name', 'sort_order')
    .default('sort_order'),
  sortOrder: Joi.string().valid('asc', 'desc', 'ASC', 'DESC').default('asc'),
});

const createBody = Joi.object({
  name: Joi.string().trim().min(2).max(150).required(),
  description: Joi.string().trim().max(500).allow('', null).optional(),
  is_active: Joi.boolean().optional().default(true),
  isActive: Joi.boolean().optional(),
  sort_order: Joi.number().integer().min(0).optional().default(0),
});

const updateBody = Joi.object({
  name: Joi.string().trim().min(2).max(150).optional(),
  description: Joi.string().trim().max(500).allow('', null).optional(),
  is_active: Joi.boolean().optional(),
  isActive: Joi.boolean().optional(),
  sort_order: Joi.number().integer().min(0).optional(),
});

const createClearanceBody = Joi.object({
  department: Joi.string().trim().min(1).max(100).required(),
  task_name: Joi.string().trim().min(2).max(255).required(),
  sort_order: Joi.number().integer().min(0).optional().default(0),
  is_active: Joi.boolean().optional().default(true),
  isActive: Joi.boolean().optional(),
  sla_hours: Joi.number().integer().min(0).optional().default(0),
});

const updateClearanceBody = Joi.object({
  department: Joi.string().trim().min(1).max(100).optional(),
  task_name: Joi.string().trim().min(2).max(255).optional(),
  sort_order: Joi.number().integer().min(0).optional(),
  is_active: Joi.boolean().optional(),
  isActive: Joi.boolean().optional(),
  sla_hours: Joi.number().integer().min(0).optional(),
});

const pipelineStageItem = Joi.object({
  stage_key: Joi.string().trim().max(50).required(),
  label: Joi.string().trim().min(1).max(100).required(),
  step_order: Joi.number().integer().min(1).optional(),
  is_active: Joi.boolean().optional(),
  department_id: Joi.number().integer().positive().allow(null).optional(),
  department_ids: Joi.array().items(Joi.number().integer().positive()).optional(),
});

const saveOrgWorkflowBody = Joi.object({
  steps: Joi.array()
    .items(
      Joi.object({
        department_id: Joi.number().integer().positive().required(),
        step_order: Joi.number().integer().min(1).optional(),
        is_mandatory: Joi.boolean().default(true),
        remarks: Joi.string().trim().max(2000).allow('', null).optional(),
      }),
    )
    .min(1)
    .required(),
});

const savePipelineStagesBody = Joi.object({
  stages: Joi.array().items(pipelineStageItem).min(1).required(),
});

const saveExitWorkflowConfigBody = Joi.object({
  pipeline_stages: Joi.array().items(pipelineStageItem).min(1).optional(),
  department_steps: Joi.array()
    .items(
      Joi.object({
        department_id: Joi.number().integer().positive().required(),
        step_order: Joi.number().integer().min(1).optional(),
        is_mandatory: Joi.boolean().default(true),
        remarks: Joi.string().trim().max(2000).allow('', null).optional(),
      }),
    )
    .min(1)
    .optional(),
});

module.exports = {
  idParam,
  listingQuery,
  createBody,
  updateBody,
  createClearanceBody,
  updateClearanceBody,
  saveOrgWorkflowBody,
  savePipelineStagesBody,
  saveExitWorkflowConfigBody,
};
