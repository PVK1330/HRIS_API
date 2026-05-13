'use strict';

const Joi = require('joi');

const listingQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  search: Joi.string().allow('').max(300).default(''),
  department: Joi.string().allow('').max(255).default(''),
  status: Joi.string().allow('').max(80).default(''),
  workMode: Joi.string().allow('').max(80).default(''),
  jobTitle: Joi.string().allow('').max(255).default(''),
  workLocation: Joi.string().allow('').max(255).default(''),
  joinDateFrom: Joi.alternatives().try(Joi.string().allow('').max(32), Joi.date()).optional(),
  joinDateTo: Joi.alternatives().try(Joi.string().allow('').max(32), Joi.date()).optional(),
  sortBy: Joi.string()
    .valid('created_at', 'join_date', 'full_name', 'employment_status', 'job_title', 'work_email', 'emp_id')
    .default('created_at'),
  sortOrder: Joi.string().valid('asc', 'desc', 'ASC', 'DESC').default('desc'),
});

const exportQuery = listingQuery.keys({
  type: Joi.string().valid('pdf', 'excel').required(),
});

const idParam = Joi.object({
  id: Joi.number().integer().positive().required(),
});

module.exports = {
  listingQuery,
  exportQuery,
  idParam,
};
