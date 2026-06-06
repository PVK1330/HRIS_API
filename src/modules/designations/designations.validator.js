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
  department_id: Joi.alternatives().try(Joi.number().integer().positive(), Joi.string().allow('')).optional(),
  departmentId: Joi.alternatives().try(Joi.number().integer().positive(), Joi.string().allow('')).optional(),
  department_name: Joi.string().allow('').max(200).optional(),
  departmentName: Joi.string().allow('').max(200).optional(),
  grade: Joi.string().allow('').max(50).optional(),
  sortBy: Joi.string()
    .valid('created_at', 'updated_at', 'name', 'grade', 'department_name')
    .default('created_at'),
  sortOrder: Joi.string().valid('asc', 'desc', 'ASC', 'DESC').default('desc'),
});

const exportQuery = listingQuery.keys({
  type: Joi.string().valid('pdf', 'excel').required(),
});

const createBody = Joi.object({
  name: Joi.string().trim().min(2).max(150).required(),
  department_id: Joi.number().integer().positive().optional(),
  departmentId: Joi.number().integer().positive().optional(),
  description: Joi.string().trim().max(500).allow('', null).optional(),
  grade: Joi.string().trim().max(20).allow('', null).optional(),
  status: Joi.string().valid('active', 'inactive', 'Active', 'Inactive').optional(),
  is_active: Joi.boolean().optional(),
  isActive: Joi.boolean().optional(),
}).custom((val, helpers) => {
  const dep = val.department_id ?? val.departmentId;
  if (!dep) return helpers.error('any.custom', { message: 'department_id is required' });
  return { ...val, department_id: dep };
});

const updateBody = Joi.object({
  name: Joi.string().trim().min(2).max(150).optional(),
  department_id: Joi.number().integer().positive().optional(),
  departmentId: Joi.number().integer().positive().optional(),
  description: Joi.string().trim().max(500).allow('', null).optional(),
  grade: Joi.string().trim().max(20).allow('', null).optional(),
  status: Joi.string().valid('active', 'inactive', 'Active', 'Inactive').optional(),
  is_active: Joi.boolean().optional(),
  isActive: Joi.boolean().optional(),
});

const deptNameParam = Joi.object({
  deptName: Joi.string().min(1).max(255).required(),
});

const deptIdParam = Joi.object({
  deptId: Joi.number().integer().positive().required(),
});

module.exports = {
  idParam,
  listingQuery,
  exportQuery,
  createBody,
  updateBody,
  deptNameParam,
  deptIdParam,
};
