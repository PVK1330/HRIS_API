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
});

const updateClearanceBody = Joi.object({
  department: Joi.string().trim().min(1).max(100).optional(),
  task_name: Joi.string().trim().min(2).max(255).optional(),
  sort_order: Joi.number().integer().min(0).optional(),
  is_active: Joi.boolean().optional(),
  isActive: Joi.boolean().optional(),
});

module.exports = {
  idParam,
  listingQuery,
  createBody,
  updateBody,
  createClearanceBody,
  updateClearanceBody,
};
