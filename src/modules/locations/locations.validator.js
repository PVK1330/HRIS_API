'use strict';

const Joi = require('joi');

const idParam = Joi.object({
  id: Joi.number().integer().positive().required(),
});

const listingQuery = Joi.object({
  search: Joi.string().allow('').max(200).optional(),
  status: Joi.string().valid('active', 'inactive', 'all').optional(),
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(500).optional(),
});

const createBody = Joi.object({
  name: Joi.string().trim().min(1).max(255).required(),
  code: Joi.string().trim().max(50).allow('', null).optional(),
  address: Joi.string().trim().max(500).allow('', null).optional(),
  city: Joi.string().trim().max(100).allow('', null).optional(),
  state: Joi.string().trim().max(100).allow('', null).optional(),
  country: Joi.string().trim().max(100).allow('', null).optional(),
  latitude: Joi.number().min(-90).max(90).allow(null).optional(),
  longitude: Joi.number().min(-180).max(180).allow(null).optional(),
  radiusMeters: Joi.number().integer().min(10).max(100000).optional(),
  timezone: Joi.string().max(64).optional(),
  status: Joi.string().valid('active', 'inactive').optional(),
  description: Joi.string().max(1000).allow('', null).optional(),
});

const updateBody = createBody;

module.exports = { idParam, listingQuery, createBody, updateBody };
