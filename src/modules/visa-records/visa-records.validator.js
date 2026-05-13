'use strict';

const Joi = require('joi');

const idParam = Joi.object({
  id: Joi.number().integer().positive().required(),
});

const listingQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  search: Joi.string().allow('').max(200).default(''),
  department: Joi.string().allow('').max(255).default(''),
  location: Joi.string().allow('').max(255).default(''),
  visaType: Joi.alternatives().try(Joi.string().allow(''), Joi.number()).optional().allow(''),
  expiryWindow: Joi.string()
    .valid('all', '30', '60', '90', 'expired', '')
    .default('all'),
  sortBy: Joi.string()
    .valid('visa_expiry_date', 'passport_expiry_date', 'full_name', 'created_at', 'emp_id')
    .default('visa_expiry_date'),
  sortOrder: Joi.string().valid('asc', 'desc', 'ASC', 'DESC').default('asc'),
});

const exportQuery = listingQuery.keys({
  type: Joi.string().valid('pdf', 'excel').required(),
});

const dateStr = Joi.alternatives().try(
  Joi.date(),
  Joi.string().pattern(/^\d{4}-\d{2}-\d{2}/),
);

const baseFields = {
  employee_id: Joi.number().integer().positive().required(),
  nationality: Joi.string().trim().max(100).required(),
  passport_number: Joi.string().trim().max(50).required(),
  passport_issue_date: dateStr.required(),
  passport_expiry_date: dateStr.required(),
  country_of_issue: Joi.string().trim().max(100).required(),
  visa_type_id: Joi.number().integer().positive().required(),
  visa_number: Joi.string().trim().max(80).required(),
  visa_issue_date: dateStr.required(),
  visa_expiry_date: dateStr.required(),
  issued_by: Joi.string().trim().allow('', null).max(150).optional(),
  sponsoring_entity: Joi.string().trim().allow('', null).max(200).optional(),
  emirates_id_number: Joi.string().trim().allow('', null).max(50).optional(),
  emirates_id_expiry: dateStr.allow(null, '').optional(),
};

function dateOrderCheck(data, helpers) {
  const pi = new Date(data.passport_issue_date);
  const pe = new Date(data.passport_expiry_date);
  if (!(pe > pi)) {
    return helpers.error('any.custom', { message: 'passport_expiry_date must be after passport_issue_date' });
  }
  const vi = new Date(data.visa_issue_date);
  const ve = new Date(data.visa_expiry_date);
  if (!(ve > vi)) {
    return helpers.error('any.custom', { message: 'visa_expiry_date must be after visa_issue_date' });
  }
  return data;
}

const createBody = Joi.object(baseFields).custom(dateOrderCheck);

const updateBody = Joi.object({
  nationality: Joi.string().trim().max(100).optional(),
  passport_number: Joi.string().trim().max(50).optional(),
  passport_issue_date: dateStr.optional(),
  passport_expiry_date: dateStr.optional(),
  country_of_issue: Joi.string().trim().max(100).optional(),
  visa_type_id: Joi.number().integer().positive().optional(),
  visa_number: Joi.string().trim().max(80).optional(),
  visa_issue_date: dateStr.optional(),
  visa_expiry_date: dateStr.optional(),
  issued_by: Joi.string().trim().allow('', null).max(150).optional(),
  sponsoring_entity: Joi.string().trim().allow('', null).max(200).optional(),
  emirates_id_number: Joi.string().trim().allow('', null).max(50).optional(),
  emirates_id_expiry: dateStr.allow(null, '').optional(),
})
  .custom((data, helpers) => {
    const hasP =
      data.passport_issue_date !== undefined && data.passport_expiry_date !== undefined;
    if (hasP) {
      const pi = new Date(data.passport_issue_date);
      const pe = new Date(data.passport_expiry_date);
      if (!(pe > pi)) {
        return helpers.error('any.custom', {
          message: 'passport_expiry_date must be after passport_issue_date',
        });
      }
    }
    const hasV = data.visa_issue_date !== undefined && data.visa_expiry_date !== undefined;
    if (hasV) {
      const vi = new Date(data.visa_issue_date);
      const ve = new Date(data.visa_expiry_date);
      if (!(ve > vi)) {
        return helpers.error('any.custom', { message: 'visa_expiry_date must be after visa_issue_date' });
      }
    }
    return data;
  });

module.exports = {
  idParam,
  listingQuery,
  exportQuery,
  createBody,
  updateBody,
};
