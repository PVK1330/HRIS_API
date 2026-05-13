'use strict';

const Joi = require('joi');

const idParam = Joi.object({
  id: Joi.number().integer().positive().required(),
});

const listingQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(50),
  search: Joi.string().allow('').max(200).default(''),
  status: Joi.string().valid('active', 'inactive', 'all', 'Active', 'Inactive', 'All').default('all'),
  sortBy: Joi.string().valid('name', 'created_at', 'status').default('name'),
  sortOrder: Joi.string().valid('asc', 'desc', 'ASC', 'DESC').default('asc'),
});

const createBody = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  description: Joi.string().trim().allow('', null).max(300).optional(),
  status: Joi.string().valid('active', 'inactive', 'Active', 'Inactive').optional(),
  is_active: Joi.boolean().optional(),
});

const updateBody = Joi.object({
  name: Joi.string().trim().min(2).max(100).optional(),
  description: Joi.string().trim().allow('', null).max(300).optional(),
  status: Joi.string().valid('active', 'inactive', 'Active', 'Inactive').optional(),
  is_active: Joi.boolean().optional(),
});

module.exports = {
  idParam,
  listingQuery,
  createBody,
  updateBody,
};
