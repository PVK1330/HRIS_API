'use strict';

const Joi = require('joi');

const alphanumericCode = Joi.string()
  .max(20)
  .pattern(/^[a-zA-Z0-9_-]*$/)
  .messages({ 'string.pattern.base': 'code must be alphanumeric' });

const idParam = Joi.object({
  id: Joi.number().integer().positive().required(),
});

const listingQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(1000).default(10),
  search: Joi.string().allow('').max(200).default(''),
  status: Joi.string().valid('active', 'inactive', 'all', 'Active', 'Inactive', 'All').default('all'),
  parent_id: Joi.alternatives().try(Joi.number().integer().positive(), Joi.string().allow('')).optional(),
  sortBy: Joi.string()
    .valid('created_at', 'updated_at', 'name', 'code', 'status')
    .default('created_at'),
  sortOrder: Joi.string().valid('asc', 'desc', 'ASC', 'DESC').default('desc'),
});

const exportQuery = listingQuery.keys({
  type: Joi.string().valid('pdf', 'excel').required(),
});

const filterOptionsQuery = Joi.object({}).unknown(true);

// Head-of-Department picker: searchable + paginated, with an optional role filter.
const managersQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(1000).default(50),
  search: Joi.string().allow('').max(200).optional(),
  q: Joi.string().allow('').max(200).optional(),
  role: Joi.string().allow('').max(150).optional(),
  roleId: Joi.alternatives().try(Joi.number().integer().positive(), Joi.string().allow('')).optional(),
  role_id: Joi.alternatives().try(Joi.number().integer().positive(), Joi.string().allow('')).optional(),
});

// Soft delete: optional explicit confirmation to archive a department that still
// has employees assigned.
const deleteQuery = Joi.object({
  force: Joi.alternatives().try(Joi.boolean(), Joi.string().valid('true', 'false')).optional(),
});

const createBody = Joi.object({
  name: Joi.string().trim().min(2).max(150).required(),
  code: alphanumericCode.optional().allow('', null),
  description: Joi.string().trim().max(500).allow('', null),
  parent_id: Joi.number().integer().positive().allow(null).optional(),
  manager_id: Joi.number().integer().positive().allow(null).optional(),
  managerId: Joi.number().integer().positive().allow(null).optional(),
  manager_emp_id: Joi.string().trim().max(50).allow('', null).optional(),
  status: Joi.string().valid('active', 'inactive', 'Active', 'Inactive').optional(),
  is_active: Joi.boolean().optional(),
  isActive: Joi.boolean().optional(),
});

const updateBody = createBody.fork(['name'], (s) => s.optional());

module.exports = {
  idParam,
  listingQuery,
  exportQuery,
  filterOptionsQuery,
  managersQuery,
  deleteQuery,
  createBody,
  updateBody,
};
